//! Windows service process and its local control protocol.
//!
//! The pipe deliberately accepts intent (selected node and account proof),
//! never a process path, command line, raw Xray config, route or shell script.
//! The service owns backend entitlement checks, Xray, TUN routes and cleanup;
//! the unprivileged Tauri process can send only validated connection intent.

use crate::vpn_broker::{PeerIdentity, Request, Response, MAX_MESSAGE_BYTES, PIPE_NAME};

pub const SERVICE_NAME: &str = "ByMeVPNVpn";

#[cfg(windows)]
mod windows_service_host {
    use super::*;
    use std::{
        collections::VecDeque,
        ffi::OsString,
        mem::size_of,
        ptr::null_mut,
        sync::{
            atomic::{AtomicBool, Ordering},
            Arc, Mutex,
        },
        thread,
        time::{Duration, Instant},
    };
    use windows_service::{
        define_windows_service,
        service::{
            ServiceControl, ServiceControlAccept, ServiceExitCode, ServiceState, ServiceStatus,
            ServiceType, SessionChangeReason,
        },
        service_control_handler::{self, ServiceControlHandlerResult},
    };
    use windows_sys::Win32::{
        Foundation::{CloseHandle, GetLastError, LocalFree, HANDLE, INVALID_HANDLE_VALUE},
        Security::Authorization::{
            ConvertSidToStringSidW, ConvertStringSecurityDescriptorToSecurityDescriptorW,
            SDDL_REVISION_1,
        },
        Security::{GetTokenInformation, RevertToSelf, TokenSessionId, TokenUser, TOKEN_QUERY},
        System::{
            Pipes::{
                ConnectNamedPipe, CreateNamedPipeW, GetNamedPipeClientSessionId,
                ImpersonateNamedPipeClient, PeekNamedPipe, PIPE_NOWAIT, PIPE_READMODE_BYTE,
                PIPE_REJECT_REMOTE_CLIENTS, PIPE_TYPE_BYTE,
            },
            Threading::{GetCurrentThread, OpenThreadToken},
        },
    };

    const ERROR_PIPE_CONNECTED: u32 = 535;
    const ERROR_PIPE_LISTENING: u32 = 536;
    const PIPE_BUFFER_BYTES: u32 = MAX_MESSAGE_BYTES as u32;
    const PIPE_POLL_INTERVAL: Duration = Duration::from_millis(25);
    const PIPE_READ_TIMEOUT: Duration = Duration::from_secs(10);

    define_windows_service!(ffi_service_main, service_main);

    pub fn run_service() -> windows_service::Result<()> {
        windows_service::service_dispatcher::start(SERVICE_NAME, ffi_service_main)
    }

    fn service_main(_arguments: Vec<OsString>) {
        if let Err(error) = run_service_inner() {
            eprintln!("ByMeVPN VPN service stopped: {error}");
        }
    }

    fn run_service_inner() -> windows_service::Result<()> {
        let stopping = Arc::new(AtomicBool::new(false));
        let stop_signal = stopping.clone();
        let logoffs = Arc::new(Mutex::new(VecDeque::new()));
        let logoff_queue = logoffs.clone();
        let status =
            service_control_handler::register(SERVICE_NAME, move |control| match control {
                ServiceControl::Interrogate => ServiceControlHandlerResult::NoError,
                ServiceControl::Stop | ServiceControl::Shutdown => {
                    stop_signal.store(true, Ordering::SeqCst);
                    ServiceControlHandlerResult::NoError
                }
                ServiceControl::SessionChange(change)
                    if change.reason == SessionChangeReason::SessionLogoff =>
                {
                    if let Ok(mut pending) = logoff_queue.lock() {
                        pending.push_back(change.notification.session_id);
                    }
                    ServiceControlHandlerResult::NoError
                }
                _ => ServiceControlHandlerResult::NotImplemented,
            })?;
        if let Err(error) =
            tauri::async_runtime::block_on(crate::vpn_service_engine::recover_stale_network_state())
        {
            eprintln!("ByMeVPN startup network recovery required: {error}");
        }
        status.set_service_status(ServiceStatus {
            service_type: ServiceType::OWN_PROCESS,
            current_state: ServiceState::Running,
            controls_accepted: ServiceControlAccept::STOP
                | ServiceControlAccept::SHUTDOWN
                | ServiceControlAccept::SESSION_CHANGE,
            exit_code: ServiceExitCode::Win32(0),
            checkpoint: 0,
            wait_hint: Duration::default(),
            process_id: None,
        })?;

        let watchdog_stopping = stopping.clone();
        let watchdog = thread::Builder::new()
            .name("ByMeVPN service watchdog".into())
            .spawn(move || {
                while !watchdog_stopping.load(Ordering::SeqCst) {
                    tauri::async_runtime::block_on(crate::vpn_service_engine::watchdog());
                    for _ in 0..20 {
                        if watchdog_stopping.load(Ordering::SeqCst) {
                            break;
                        }
                        thread::sleep(Duration::from_millis(100));
                    }
                }
            })
            .map_err(windows_service::Error::Winapi)?;
        let result = serve_pipe(&stopping, &logoffs);
        stopping.store(true, Ordering::SeqCst);
        let stop_pending_result = status.set_service_status(ServiceStatus {
            service_type: ServiceType::OWN_PROCESS,
            current_state: ServiceState::StopPending,
            controls_accepted: ServiceControlAccept::empty(),
            exit_code: ServiceExitCode::Win32(0),
            checkpoint: 1,
            wait_hint: Duration::from_secs(30),
            process_id: None,
        });
        let _ = watchdog.join();
        let shutdown = tauri::async_runtime::block_on(crate::vpn_service_engine::shutdown());
        let result = result.and(shutdown.map_err(|error| error.to_string()));
        let status_result = status.set_service_status(ServiceStatus {
            service_type: ServiceType::OWN_PROCESS,
            current_state: ServiceState::Stopped,
            controls_accepted: ServiceControlAccept::empty(),
            exit_code: ServiceExitCode::Win32(if result.is_ok() { 0 } else { 1 }),
            checkpoint: 0,
            wait_hint: Duration::default(),
            process_id: None,
        });
        stop_pending_result?;
        result.map_err(|error| windows_service::Error::Winapi(std::io::Error::other(error)))?;
        status_result
    }

    struct SecurityDescriptor(*mut core::ffi::c_void);

    impl Drop for SecurityDescriptor {
        fn drop(&mut self) {
            if !self.0.is_null() {
                // SAFETY: The descriptor was allocated by ConvertStringSecurityDescriptor...
                unsafe { LocalFree(self.0 as _) };
            }
        }
    }

    struct Pipe(HANDLE);

    impl Drop for Pipe {
        fn drop(&mut self) {
            if !self.0.is_null() && self.0 != INVALID_HANDLE_VALUE {
                // SAFETY: Pipe owns this valid handle exclusively.
                unsafe { CloseHandle(self.0) };
            }
        }
    }

    fn create_pipe() -> Result<Pipe, String> {
        let name: Vec<u16> = PIPE_NAME.encode_utf16().chain(Some(0)).collect();
        // Allow System and administrators full control; interactive users get
        // only read/write. The caller is still impersonated and session-checked.
        let sddl: Vec<u16> = "D:P(A;;GA;;;SY)(A;;GA;;;BA)(A;;GRGW;;;IU)"
            .encode_utf16()
            .chain(Some(0))
            .collect();
        let mut descriptor = null_mut();
        // SAFETY: SDDL and output pointer are valid for this call.
        if unsafe {
            ConvertStringSecurityDescriptorToSecurityDescriptorW(
                sddl.as_ptr(),
                SDDL_REVISION_1,
                &mut descriptor,
                null_mut(),
            )
        } == 0
        {
            return Err(format!(
                "Named-pipe ACL creation failed: {}",
                std::io::Error::last_os_error()
            ));
        }
        let descriptor = SecurityDescriptor(descriptor);
        // SAFETY: SECURITY_ATTRIBUTES refers to the allocated descriptor and
        // remains alive until CreateNamedPipeW has copied the security data.
        let security = windows_sys::Win32::Security::SECURITY_ATTRIBUTES {
            nLength: size_of::<windows_sys::Win32::Security::SECURITY_ATTRIBUTES>() as u32,
            lpSecurityDescriptor: descriptor.0,
            bInheritHandle: 0,
        };
        // SAFETY: All parameters are fixed and the SDDL DACL excludes remote
        // pipe clients. FIRST_PIPE_INSTANCE also prevents pipe squatting.
        let handle = unsafe {
            CreateNamedPipeW(
                name.as_ptr(),
                windows_sys::Win32::Storage::FileSystem::PIPE_ACCESS_DUPLEX
                    | windows_sys::Win32::Storage::FileSystem::FILE_FLAG_FIRST_PIPE_INSTANCE,
                PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_NOWAIT | PIPE_REJECT_REMOTE_CLIENTS,
                1,
                PIPE_BUFFER_BYTES,
                PIPE_BUFFER_BYTES,
                0,
                &security,
            )
        };
        if handle == INVALID_HANDLE_VALUE {
            Err(format!(
                "Named-pipe creation failed: {}",
                std::io::Error::last_os_error()
            ))
        } else {
            Ok(Pipe(handle))
        }
    }

    fn process_session_logoffs(logoffs: &Mutex<VecDeque<u32>>) {
        loop {
            let session_id = logoffs
                .lock()
                .ok()
                .and_then(|mut pending| pending.pop_front());
            let Some(session_id) = session_id else {
                return;
            };
            if let Err(error) = tauri::async_runtime::block_on(
                crate::vpn_service_engine::disconnect_session(session_id),
            ) {
                eprintln!("ByMeVPN logoff cleanup failed: {error}");
            }
        }
    }

    fn connect_pipe(
        pipe: &Pipe,
        stopping: &AtomicBool,
        logoffs: &Mutex<VecDeque<u32>>,
    ) -> Result<bool, String> {
        loop {
            if stopping.load(Ordering::SeqCst) {
                return Ok(false);
            }
            process_session_logoffs(logoffs);
            // The first connection call is intentionally nonblocking so SCM
            // stop can be observed without a stuck ConnectNamedPipe call.
            // SAFETY: Valid pipe handle; no overlapped I/O was requested.
            if unsafe { ConnectNamedPipe(pipe.0, null_mut()) } != 0 {
                return Ok(true);
            }
            let error = unsafe { GetLastError() };
            if error == ERROR_PIPE_CONNECTED {
                return Ok(true);
            }
            if error != ERROR_PIPE_LISTENING {
                return Err(format!(
                    "Named-pipe connection failed: {}",
                    std::io::Error::last_os_error()
                ));
            }
            thread::sleep(PIPE_POLL_INTERVAL);
        }
    }

    fn authenticated_peer(pipe: &Pipe) -> Result<PeerIdentity, String> {
        let mut session_id = 0;
        // SAFETY: Output points to a writable DWORD and pipe is connected.
        if unsafe { GetNamedPipeClientSessionId(pipe.0, &mut session_id) } == 0 || session_id == 0 {
            return Err("Named-pipe caller is not in an interactive Windows session.".into());
        }
        // SAFETY: The impersonation token is attached to this thread only and
        // is always reverted before request processing returns.
        if unsafe { ImpersonateNamedPipeClient(pipe.0) } == 0 {
            return Err("Named-pipe caller impersonation failed.".into());
        }
        let identity = query_impersonated_user();
        let reverted = unsafe { RevertToSelf() } != 0;
        if !reverted {
            return Err("Named-pipe caller impersonation could not be reverted.".into());
        }
        identity.and_then(|(sid, token_session)| {
            if token_session == session_id {
                Ok(PeerIdentity {
                    user_sid: sid,
                    session_id,
                })
            } else {
                Err("Named-pipe caller session changed during authentication.".into())
            }
        })
    }

    fn query_impersonated_user() -> Result<(String, u32), String> {
        let mut token: HANDLE = null_mut();
        // SAFETY: Current thread is impersonating a connected named-pipe peer.
        if unsafe { OpenThreadToken(GetCurrentThread(), TOKEN_QUERY, 1, &mut token) } == 0 {
            return Err("Named-pipe caller token is unavailable.".into());
        }
        struct Token(HANDLE);
        impl Drop for Token {
            fn drop(&mut self) {
                unsafe { CloseHandle(self.0) };
            }
        }
        let _token = Token(token);

        let mut sid_buffer = vec![0u8; 4096];
        let mut returned = 0;
        // SAFETY: Buffer is writable and large enough for TOKEN_USER.
        if unsafe {
            GetTokenInformation(
                token,
                TokenUser,
                sid_buffer.as_mut_ptr().cast(),
                sid_buffer.len() as u32,
                &mut returned,
            )
        } == 0
        {
            return Err("Named-pipe caller SID could not be read.".into());
        }
        let token_user = sid_buffer
            .as_ptr()
            .cast::<windows_sys::Win32::Security::TOKEN_USER>();
        // SAFETY: GetTokenInformation populated the buffer with TOKEN_USER.
        let user_sid = unsafe { (*token_user).User.Sid };
        let mut sid_string = null_mut();
        // SAFETY: user_sid is owned by the still-open token handle.
        if unsafe { ConvertSidToStringSidW(user_sid, &mut sid_string) } == 0 {
            return Err("Named-pipe caller SID could not be formatted.".into());
        }
        let mut length = 0usize;
        // SAFETY: ConvertSidToStringSidW returned a NUL-terminated string.
        unsafe {
            while *sid_string.add(length) != 0 {
                length += 1;
            }
        }
        let sid =
            String::from_utf16_lossy(unsafe { std::slice::from_raw_parts(sid_string, length) });
        unsafe { LocalFree(sid_string as _) };

        let mut token_session = 0u32;
        // SAFETY: TOKEN_SESSION_ID writes one DWORD to token_session.
        if unsafe {
            GetTokenInformation(
                token,
                TokenSessionId,
                (&mut token_session as *mut u32).cast(),
                size_of::<u32>() as u32,
                &mut returned,
            )
        } == 0
            || token_session == 0
        {
            return Err("Named-pipe caller token is not interactive.".into());
        }
        Ok((sid, token_session))
    }

    fn read_exact_bounded(pipe: &Pipe, output: &mut [u8]) -> Result<(), String> {
        let deadline = Instant::now() + PIPE_READ_TIMEOUT;
        let mut offset = 0;
        while offset < output.len() {
            if Instant::now() >= deadline {
                return Err("Named-pipe request timed out.".into());
            }
            let mut available = 0u32;
            // SAFETY: Pipe is valid, and the byte-count output is writable.
            if unsafe {
                PeekNamedPipe(
                    pipe.0,
                    null_mut(),
                    0,
                    null_mut(),
                    &mut available,
                    null_mut(),
                )
            } == 0
            {
                return Err("Named-pipe client disconnected.".into());
            }
            if available == 0 {
                thread::sleep(PIPE_POLL_INTERVAL);
                continue;
            }
            let request = (output.len() - offset).min(available as usize) as u32;
            let mut read = 0u32;
            // SAFETY: The output slice has at least request writable bytes.
            if unsafe {
                windows_sys::Win32::Storage::FileSystem::ReadFile(
                    pipe.0,
                    output[offset..].as_mut_ptr(),
                    request,
                    &mut read,
                    null_mut(),
                )
            } == 0
                || read == 0
            {
                return Err("Named-pipe request could not be read.".into());
            }
            offset += read as usize;
        }
        Ok(())
    }

    fn write_all(pipe: &Pipe, bytes: &[u8]) -> Result<(), String> {
        let mut offset = 0;
        while offset < bytes.len() {
            let count = (bytes.len() - offset).min(PIPE_BUFFER_BYTES as usize) as u32;
            let mut written = 0u32;
            // SAFETY: Slice is readable for count bytes, and written is valid.
            if unsafe {
                windows_sys::Win32::Storage::FileSystem::WriteFile(
                    pipe.0,
                    bytes[offset..].as_ptr(),
                    count,
                    &mut written,
                    null_mut(),
                )
            } == 0
                || written == 0
            {
                return Err("Named-pipe response could not be written.".into());
            }
            offset += written as usize;
        }
        Ok(())
    }

    fn read_request(pipe: &Pipe) -> Result<Request, String> {
        let mut length = [0u8; 4];
        read_exact_bounded(pipe, &mut length)?;
        let length = u32::from_le_bytes(length) as usize;
        if length == 0 || length > MAX_MESSAGE_BYTES {
            return Err("Named-pipe request size is invalid.".into());
        }
        let mut data = vec![0u8; length];
        read_exact_bounded(pipe, &mut data)?;
        serde_json::from_slice(&data).map_err(|_| "Named-pipe request format is invalid.".into())
    }

    fn write_response(pipe: &Pipe, response: &Response) -> Result<(), String> {
        let data = serde_json::to_vec(response).map_err(|_| "Response serialization failed.")?;
        let length: u32 = data
            .len()
            .try_into()
            .map_err(|_| "Response size is invalid.")?;
        write_all(pipe, &length.to_le_bytes())?;
        write_all(pipe, &data)
    }

    pub(super) fn validate_intent(request: &Request) -> bool {
        match request {
            Request::Connect {
                access_token,
                refresh_token,
                install_id,
                node_code,
                bypass_ru: _,
                ad_block,
                dns_mode,
                ..
            } => {
                !access_token.is_empty()
                    && access_token.len() <= 16 * 1024
                    && !refresh_token.is_empty()
                    && refresh_token.len() <= 16 * 1024
                    && uuid::Uuid::parse_str(install_id).is_ok()
                    && (node_code == "auto"
                        || (!node_code.is_empty()
                            && node_code.len() <= 128
                            && node_code
                                .chars()
                                .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-'))))
                    && matches!(ad_block.as_str(), "none" | "basic" | "recommended")
                    && matches!(dns_mode.as_str(), "cloudflare" | "adguard" | "google")
            }
            Request::Disconnect
            | Request::Status { .. }
            | Request::Diagnostics
            | Request::SetAutoReconnect { .. } => true,
        }
    }

    fn serve_pipe(stopping: &AtomicBool, logoffs: &Mutex<VecDeque<u32>>) -> Result<(), String> {
        while !stopping.load(Ordering::SeqCst) {
            process_session_logoffs(logoffs);
            let pipe = create_pipe()?;
            if !connect_pipe(&pipe, stopping, logoffs)? {
                break;
            }
            let response = match authenticated_peer(&pipe) {
                Ok(identity) => match read_request(&pipe) {
                    Ok(request) if validate_intent(&request) => tauri::async_runtime::block_on(
                        crate::vpn_service_engine::handle(request, identity),
                    ),
                    Ok(_) => Response::error("Параметры подключения VPN некорректны."),
                    Err(error) => Response::error(error),
                },
                Err(_) => Response::error("Доступ к VPN-службе запрещён для этой сессии Windows."),
            };
            let _ = write_response(&pipe, &response);
        }
        Ok(())
    }
}

#[cfg(windows)]
pub use windows_service_host::run_service;

#[cfg(not(windows))]
pub fn run_service() -> Result<(), String> {
    Err("ByMeVPN VPN service is available only on Windows.".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn connect_requests_carry_only_bounded_intent_and_validated_options() {
        let valid = Request::Connect {
            access_token: "a".repeat(64),
            refresh_token: "r".repeat(64),
            install_id: "550e8400-e29b-41d4-a716-446655440000".into(),
            node_code: "de_germany".into(),
            bypass_ru: true,
            ad_block: "none".into(),
            dns_mode: "cloudflare".into(),
            auto_reconnect: true,
        };
        assert!(windows_service_host::validate_intent(&valid));

        let mut invalid = valid.clone();
        if let Request::Connect { node_code, .. } = &mut invalid {
            *node_code = "de; powershell.exe".into();
        }
        assert!(!windows_service_host::validate_intent(&invalid));

        let mut invalid = valid;
        if let Request::Connect { install_id, .. } = &mut invalid {
            *install_id = "not-a-uuid".into();
        }
        assert!(!windows_service_host::validate_intent(&invalid));
    }
}
