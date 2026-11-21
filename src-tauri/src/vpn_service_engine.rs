//! Privileged VPN tunnel engine.

use crate::{
    api_transport::{send_to_bases, API_BASES},
    egress::{preflight_xray_server, verify_tunnel_path, TunnelProof},
    tun_config::{
        add_attestation_http_inbound, build_tun_config_ext, preflight_attestation_config,
    },
    tunnel_runtime::verify_runtime,
    vpn_broker::{PeerIdentity, Request, Response, TunnelMetrics},
};
use reqwest::{Client, Method, StatusCode};
use serde_json::{json, Value};
use std::{
    fs,
    net::IpAddr,
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::OnceLock,
    time::{Duration, Instant},
};
use tokio::sync::Mutex;
use uuid::Uuid;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

struct ActiveTunnel {
    child: Child,
    _job: crate::windows_job::ChildJob,
    config_path: PathBuf,
    started_at: Instant,
    server_name: String,
    country: String,
    baseline_ip: Option<IpAddr>,
    verified_ip: Option<IpAddr>,
    probe_port: u16,
    probe_password: String,
    last_probe: Instant,
    failed_health_probes: u8,
    proof: TunnelProof,
    owner: PeerIdentity,
    access_token: String,
    refresh_token: String,
}

#[derive(Clone)]
struct ReconnectPlan {
    owner: PeerIdentity,
    access_token: String,
    refresh_token: String,
    install_id: String,
    node_code: String,
    bypass_ru: bool,
    ad_block: String,
    dns_mode: String,
    auto_reconnect: bool,
    failed_attempts: usize,
    next_attempt: Option<Instant>,
}

#[derive(Default)]
struct BrokerState {
    active: Option<ActiveTunnel>,
    reconnect: Option<ReconnectPlan>,
    reconnect_in_flight: bool,
    recovery_required: bool,
}

static STATE: OnceLock<Mutex<BrokerState>> = OnceLock::new();

fn state() -> &'static Mutex<BrokerState> {
    STATE.get_or_init(|| Mutex::new(BrokerState::default()))
}

pub async fn handle(request: Request, owner: PeerIdentity) -> Response {
    let result = match request {
        Request::Connect {
            access_token,
            refresh_token,
            install_id,
            node_code,
            bypass_ru,
            ad_block,
            dns_mode,
            auto_reconnect,
        } => {
            connect(
                owner,
                access_token,
                refresh_token,
                install_id,
                node_code,
                bypass_ru,
                &ad_block,
                &dns_mode,
                auto_reconnect,
            )
            .await
        }
        Request::Status { force_probe } => status(&owner, force_probe).await,
        Request::Diagnostics => status(&owner, true).await,
        Request::Disconnect => disconnect(&owner).await,
        Request::SetAutoReconnect { enabled } => set_auto_reconnect(&owner, enabled).await,
    };
    match result {
        Ok(response) => response,
        Err(error) => Response::error(error),
    }
}

async fn connect(
    owner: PeerIdentity,
    mut access_token: String,
    mut refresh_token: String,
    install_id: String,
    node_code: String,
    bypass_ru: bool,
    ad_block: &str,
    dns_mode: &str,
    auto_reconnect: bool,
) -> Result<Response, String> {
    let mut state = state().lock().await;
    if state.recovery_required {
        let recovery =
            tokio::task::spawn_blocking(crate::tun_health::cleanup_bymevpn_routes_after_exit_sync)
                .await
                .map_err(|_| "Не удалось проверить восстановление сети Windows.".to_string())?;
        if let Err(error) = recovery {
            return Err(error);
        }
        state.recovery_required = false;
    }
    if let Some(active) = state.active.as_ref() {
        return Err(if active.owner == owner {
            "Подключение VPN уже активно.".into()
        } else {
            "VPN уже используется в другой учётной записи Windows.".into()
        });
    }
    let client = api_client()?;
    let subscription = match api_request(
        &client,
        Method::GET,
        "/subscription/status",
        None,
        &mut access_token,
        &mut refresh_token,
        None,
    )
    .await
    {
        Ok(value) => value,
        Err(error) => return Ok(error_response(error, access_token, refresh_token, None)),
    };
    let subscription = subscription.get("subscription").unwrap_or(&subscription);
    if !matches!(
        subscription.get("status").and_then(Value::as_str),
        Some("active" | "trial" | "grace")
    ) {
        return Ok(error_response(
            "Для подключения требуется подтверждённая активная подписка ByMeVPN.".into(),
            access_token,
            refresh_token,
            None,
        ));
    }
    let session = match api_request(
        &client,
        Method::POST,
        "/vpn/session",
        Some(json!({"node_code": node_code, "install_id": install_id})),
        &mut access_token,
        &mut refresh_token,
        Some(&install_id),
    )
    .await
    {
        Ok(value) => value,
        Err(error) => return Ok(error_response(error, access_token, refresh_token, None)),
    };
    let session = session.get("session").unwrap_or(&session).clone();
    let reconnect = ReconnectPlan {
        owner: owner.clone(),
        access_token: access_token.clone(),
        refresh_token: refresh_token.clone(),
        install_id: install_id.clone(),
        node_code: node_code.clone(),
        bypass_ru,
        ad_block: ad_block.to_string(),
        dns_mode: dns_mode.to_string(),
        auto_reconnect,
        failed_attempts: 0,
        next_attempt: None,
    };
    let active = match start_tunnel(
        session,
        bypass_ru,
        ad_block,
        dns_mode,
        owner,
        access_token.clone(),
        refresh_token.clone(),
    )
    .await
    {
        Ok(active) => active,
        Err(error) => {
            let recovery = tokio::task::spawn_blocking(
                crate::tun_health::cleanup_bymevpn_routes_after_exit_sync,
            )
            .await
            .unwrap_or_else(|_| Err("Не удалось завершить восстановление сети Windows.".into()));
            state.recovery_required = recovery.is_err();
            let message = match recovery {
                Ok(()) => error,
                Err(restore) => {
                    format!("{error} Сетевое восстановление не подтверждено: {restore}")
                }
            };
            let _ = api_request(
                &client,
                Method::DELETE,
                "/vpn/session",
                None,
                &mut access_token,
                &mut refresh_token,
                None,
            )
            .await;
            return Ok(error_response(
                message,
                access_token,
                refresh_token,
                state
                    .recovery_required
                    .then_some("network_recovery_required"),
            ));
        }
    };
    let metrics = metrics(&active);
    state.active = Some(active);
    state.reconnect = Some(reconnect);
    state.reconnect_in_flight = false;
    Ok(Response {
        ok: true,
        error: None,
        metrics: Some(metrics),
        access_token: Some(access_token),
        refresh_token: Some(refresh_token),
    })
}

fn api_client() -> Result<Client, String> {
    Client::builder()
        .user_agent(concat!(
            "ByMeVPN-Windows-Service/",
            env!("CARGO_PKG_VERSION")
        ))
        .connect_timeout(Duration::from_secs(8))
        .timeout(Duration::from_secs(15))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| "Не удалось настроить защищённое соединение VPN-службы.".into())
}

async fn api_request(
    client: &Client,
    method: Method,
    path: &str,
    body: Option<Value>,
    access: &mut String,
    refresh: &mut String,
    device_id: Option<&str>,
) -> Result<Value, String> {
    let mut response = send_to_bases(
        client,
        &API_BASES,
        method.clone(),
        path,
        body.as_ref(),
        Some(access),
        device_id,
    )
    .await
    .map_err(|error| api_error_transport(&error))?;
    if response.status() == StatusCode::UNAUTHORIZED {
        let refresh_response = send_to_bases(
            client,
            &API_BASES,
            Method::POST,
            "/auth/refresh",
            Some(&json!({"refresh": refresh})),
            None,
            None,
        )
        .await
        .map_err(|error| api_error_transport(&error))?;
        let status = refresh_response.status();
        let refreshed: Value = refresh_response.json().await.unwrap_or(Value::Null);
        if !status.is_success() {
            return Err("Сеанс ByMeVPN истёк. Войдите в аккаунт снова.".into());
        }
        *access = refreshed
            .get("access")
            .or_else(|| refreshed.get("access_token"))
            .and_then(Value::as_str)
            .filter(|token| !token.is_empty())
            .ok_or("Сервер не обновил сеанс ByMeVPN.")?
            .to_string();
        if let Some(next) = refreshed
            .get("refresh")
            .or_else(|| refreshed.get("refresh_token"))
            .and_then(Value::as_str)
            .filter(|token| !token.is_empty())
        {
            *refresh = next.to_string();
        }
        response = send_to_bases(
            client,
            &API_BASES,
            method,
            path,
            body.as_ref(),
            Some(access),
            device_id,
        )
        .await
        .map_err(|error| api_error_transport(&error))?;
    }
    let status = response.status();
    let value: Value = if status == StatusCode::NO_CONTENT {
        Value::Null
    } else {
        response.json().await.unwrap_or(Value::Null)
    };
    if !status.is_success() {
        let message = value
            .pointer("/detail/message")
            .or_else(|| value.pointer("/detail/error/message"))
            .and_then(Value::as_str)
            .unwrap_or("Запрос к серверу ByMeVPN завершился ошибкой.");
        return Err(format!("{message} (HTTP {})", status.as_u16()));
    }
    Ok(value)
}

fn api_error_transport(error: &reqwest::Error) -> String {
    let reason = if error.is_timeout() {
        "истекло время ожидания защищённого соединения"
    } else {
        "не удалось установить защищённое соединение с сервером"
    };
    format!("VPN-служба: {reason}. Проверьте сеть и повторите попытку.")
}

#[cfg(windows)]
fn runtime_dir() -> Result<PathBuf, String> {
    let root = std::env::current_exe()
        .map_err(|_| "Не удалось определить путь VPN-службы.")?
        .parent()
        .ok_or("Не удалось определить каталог VPN-службы.")?
        .to_owned();
    [
        root.join("vendor/runtime/windows-x64"),
        root.join("resources/vendor/runtime/windows-x64"),
        root.join("_up_/vendor/runtime/windows-x64"),
        root.join("resources/_up_/vendor/runtime/windows-x64"),
    ]
    .into_iter()
    .find(|dir| dir.join("xray.exe").is_file() && verify_runtime(dir).is_ok())
    .ok_or_else(|| "Проверенные компоненты Xray и Wintun не найдены рядом со службой.".into())
}

async fn start_tunnel(
    session: Value,
    bypass_ru: bool,
    ad_block: &str,
    dns_mode: &str,
    owner: PeerIdentity,
    access_token: String,
    refresh_token: String,
) -> Result<ActiveTunnel, String> {
    let runtime = runtime_dir()?;
    let host = session
        .get("server")
        .and_then(Value::as_str)
        .ok_or("Сервер не вернул адрес VPN.")?;
    let server_name = session
        .get("display_name")
        .or_else(|| session.get("name"))
        .and_then(Value::as_str)
        .unwrap_or(host)
        .to_string();
    let country = session
        .get("country")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let mut config = build_tun_config_ext(&session, bypass_ru, ad_block, dns_mode)?;
    let reservation = std::net::TcpListener::bind(("127.0.0.1", 0))
        .map_err(|_| "Не удалось подготовить локальную проверку VPN.")?;
    let probe_port = reservation
        .local_addr()
        .map_err(|_| "Не удалось определить порт проверки VPN.")?
        .port();
    let probe_password = Uuid::new_v4().simple().to_string();
    add_attestation_http_inbound(&mut config, probe_port, "bymevpn", &probe_password)?;
    drop(reservation);

    let config_path = private_temp_file("active")?;
    let config_guard = TempPath(config_path.clone());
    write_config(&config_path, &config)?;
    let runtime_check = runtime.clone();
    let config_check = config_path.clone();
    let checked = tauri::async_runtime::spawn_blocking(move || {
        Command::new(runtime_check.join("xray.exe"))
            .current_dir(&runtime_check)
            .env("XRAY_LOCATION_ASSET", &runtime_check)
            .args(["run", "-test", "-config"])
            .arg(&config_check)
            .creation_flags(0x0800_0000)
            .output()
    })
    .await
    .map_err(|_| "Не удалось проверить конфигурацию VPN.")?
    .map_err(|_| "Не удалось запустить проверку Xray.")?;
    if !checked.status.success() {
        return Err("Xray отклонил параметры VPN-сервера. Маршруты Windows не изменялись.".into());
    }

    let preflight_path = private_temp_file("preflight")?;
    let preflight_guard = TempPath(preflight_path.clone());
    write_config(&preflight_path, &preflight_attestation_config(&config)?)?;
    // Capture the original egress concurrently with the no-TUN server
    // preflight. Waiting for both in sequence added several seconds to every
    // connection even though these independent checks can overlap.
    let baseline_task = tauri::async_runtime::spawn(crate::egress::public_egress_ip());
    let mut child = match spawn_xray(&runtime, &preflight_path) {
        Ok(child) => child,
        Err(error) => {
            baseline_task.abort();
            return Err(error);
        }
    };
    let job = match crate::windows_job::ChildJob::attach(&child) {
        Ok(job) => job,
        Err(error) => {
            let _ = child.kill();
            let _ = child.wait();
            baseline_task.abort();
            return Err(error);
        }
    };
    let ready =
        crate::egress::wait_for_attestation_listener(probe_port, Duration::from_secs(5)).await;
    let reachable = ready && preflight_xray_server(probe_port, &probe_password).await;
    let _ = child.kill();
    let _ = child.wait();
    drop(job);
    drop(preflight_guard);
    if !reachable {
        baseline_task.abort();
        return Err(
            "Выбранный VPN-сервер не прошёл проверку. Маршруты Windows не менялись.".into(),
        );
    }
    let baseline = baseline_task.await.ok().and_then(Result::ok);

    let mut child = spawn_xray(&runtime, &config_path)?;
    let job = match crate::windows_job::ChildJob::attach(&child) {
        Ok(job) => job,
        Err(error) => {
            let _ = child.kill();
            let _ = child.wait();
            let _ = crate::tun_health::cleanup_bymevpn_routes_after_exit_sync();
            return Err(error);
        }
    };
    let result = tokio::time::timeout(Duration::from_secs(12), async {
        if !crate::egress::wait_for_attestation_listener(probe_port, Duration::from_secs(3)).await {
            return (TunnelProof::ProbeUnavailable, false);
        }
        let proof = verify_tunnel_path(baseline, probe_port, &probe_password).await;
        if !proof.traffic_confirmed() {
            return (proof, false);
        }
        let (routes, dns) = tokio::join!(
            crate::tun_health::inspect(),
            crate::tun_health::dns_resolution_check()
        );
        let healthy = crate::tun_health::health_proves_connection(&routes, dns, true, true);
        (proof, healthy)
    })
    .await;
    let (proof, healthy) = match result {
        Ok(result) => result,
        Err(_) => {
            let _ = child.kill();
            let _ = child.wait();
            let _ = crate::tun_health::cleanup_bymevpn_routes_after_exit_sync();
            return Err(
                "Проверка VPN превысила безопасное время. Сетевая конфигурация восстановлена."
                    .into(),
            );
        }
    };
    if !healthy || !matches!(child.try_wait(), Ok(None)) {
        let _ = child.kill();
        let _ = child.wait();
        drop(job);
        let _ = crate::tun_health::cleanup_bymevpn_routes_after_exit_sync();
        return Err(format!(
            "VPN не подтвердил передачу трафика ({}).",
            proof.status()
        ));
    }
    std::mem::forget(config_guard);
    Ok(ActiveTunnel {
        child,
        _job: job,
        config_path,
        started_at: Instant::now(),
        server_name,
        country,
        baseline_ip: baseline,
        verified_ip: proof.verified_ip(),
        probe_port,
        probe_password,
        last_probe: Instant::now(),
        failed_health_probes: 0,
        proof,
        owner,
        access_token,
        refresh_token,
    })
}

#[cfg(windows)]
fn spawn_xray(runtime: &Path, config: &Path) -> Result<Child, String> {
    Command::new(runtime.join("xray.exe"))
        .current_dir(runtime)
        .env("XRAY_LOCATION_ASSET", runtime)
        .args(["run", "-config"])
        .arg(config)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .creation_flags(0x0800_0000)
        .spawn()
        .map_err(|_| "Не удалось запустить проверенный Xray.".into())
}

#[cfg(windows)]
fn private_temp_file(kind: &str) -> Result<PathBuf, String> {
    Ok(std::env::temp_dir().join(format!("bymevpn-service-{kind}-{}.json", Uuid::new_v4())))
}

#[cfg(windows)]
fn write_config(path: &Path, config: &Value) -> Result<(), String> {
    use std::os::windows::{ffi::OsStrExt, io::FromRawHandle};
    use windows_sys::Win32::{
        Foundation::{LocalFree, INVALID_HANDLE_VALUE},
        Security::{
            Authorization::{
                ConvertStringSecurityDescriptorToSecurityDescriptorW, SDDL_REVISION_1,
            },
            SECURITY_ATTRIBUTES,
        },
        Storage::FileSystem::{
            CreateFileW, CREATE_NEW, FILE_ATTRIBUTE_HIDDEN, FILE_ATTRIBUTE_TEMPORARY,
        },
    };

    let path: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
    let sddl: Vec<u16> = "D:P(A;;FA;;;SY)(A;;FA;;;BA)"
        .encode_utf16()
        .chain(Some(0))
        .collect();
    let mut descriptor = std::ptr::null_mut();
    // The temporary Xray config contains the server credentials; give the
    // file an explicit SYSTEM/Administrators DACL at creation time.
    if unsafe {
        ConvertStringSecurityDescriptorToSecurityDescriptorW(
            sddl.as_ptr(),
            SDDL_REVISION_1,
            &mut descriptor,
            std::ptr::null_mut(),
        )
    } == 0
    {
        return Err("Не удалось ограничить доступ к VPN-конфигурации службы.".into());
    }
    let security = SECURITY_ATTRIBUTES {
        nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32,
        lpSecurityDescriptor: descriptor,
        bInheritHandle: 0,
    };
    let handle = unsafe {
        CreateFileW(
            path.as_ptr(),
            0x4000_0000,
            0,
            &security,
            CREATE_NEW,
            FILE_ATTRIBUTE_HIDDEN | FILE_ATTRIBUTE_TEMPORARY,
            std::ptr::null_mut(),
        )
    };
    unsafe { LocalFree(descriptor as _) };
    if handle == INVALID_HANDLE_VALUE {
        return Err("Не удалось создать защищённую конфигурацию VPN-службы.".into());
    }
    let mut file = unsafe { std::fs::File::from_raw_handle(handle as _) };
    let bytes =
        serde_json::to_vec(config).map_err(|_| "Не удалось подготовить конфигурацию VPN.")?;
    std::io::Write::write_all(&mut file, &bytes)
        .map_err(|_| "Не удалось сохранить конфигурацию VPN-службы.")?;
    file.sync_all()
        .map_err(|_| "Не удалось завершить запись конфигурации VPN.".to_string())
}

struct TempPath(PathBuf);
impl Drop for TempPath {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}

async fn status(owner: &PeerIdentity, force_probe: bool) -> Result<Response, String> {
    let mut state = state().lock().await;
    let Some(active) = state.active.as_mut() else {
        let proof = if state.recovery_required {
            "network_recovery_required"
        } else {
            "disconnected"
        };
        return Ok(ok_response(disconnected_metrics_with(proof), None, None));
    };
    if &active.owner != owner {
        return Err("VPN уже управляется в другой сессии Windows.".into());
    }
    let process_alive = matches!(active.child.try_wait(), Ok(None));
    if !process_alive {
        return Ok(disconnect_lost_tunnel(&mut state, "process_exited").await);
    }
    if force_probe
        || state
            .active
            .as_ref()
            .is_some_and(|active| active.last_probe.elapsed() >= Duration::from_secs(20))
    {
        let active = state.active.as_mut().expect("active tunnel checked above");
        let proof = verify_tunnel_path(
            active.baseline_ip,
            active.probe_port,
            &active.probe_password,
        )
        .await;
        let path_healthy = if proof.traffic_confirmed() {
            let (routes, dns) = tokio::join!(
                crate::tun_health::inspect(),
                crate::tun_health::dns_resolution_check()
            );
            crate::tun_health::health_proves_connection(&routes, dns, true, true)
        } else {
            false
        };
        let must_disconnect =
            should_disconnect_after_health(proof, path_healthy, &mut active.failed_health_probes);
        active.proof = proof;
        active.verified_ip = if path_healthy {
            proof.verified_ip()
        } else {
            None
        };
        active.last_probe = Instant::now();
        if must_disconnect {
            return Ok(disconnect_lost_tunnel(&mut state, proof.status()).await);
        }
    }
    let active = state.active.as_ref().expect("active tunnel retained");
    Ok(ok_response(
        metrics(active),
        Some(active.access_token.clone()),
        Some(active.refresh_token.clone()),
    ))
}

async fn disconnect(owner: &PeerIdentity) -> Result<Response, String> {
    let mut state = state().lock().await;
    let Some(active) = state.active.as_ref() else {
        let recovery =
            tokio::task::spawn_blocking(crate::tun_health::cleanup_bymevpn_routes_after_exit_sync)
                .await
                .map_err(|_| "Не удалось завершить восстановление сети Windows.".to_string())?;
        state.recovery_required = recovery.is_err();
        state.reconnect = None;
        state.reconnect_in_flight = false;
        return recovery.map_or_else(
            |error| Err(error),
            |_| Ok(ok_response(disconnected_metrics(), None, None)),
        );
    };
    if &active.owner != owner {
        return Err("VPN управляется другой сессией Windows.".into());
    }
    let active = state.active.take().expect("active tunnel checked above");
    state.reconnect = None;
    state.reconnect_in_flight = false;
    let response = stop_active(active, true).await;
    state.recovery_required = !response.ok;
    Ok(response)
}

/// Recover only the ByMeVPN adapter before accepting connections. This is
/// called by the service process, never by the unprivileged UI.
pub async fn recover_stale_network_state() -> Result<(), String> {
    let recovery =
        tokio::task::spawn_blocking(crate::tun_health::cleanup_bymevpn_routes_after_exit_sync)
            .await
            .map_err(|_| "Не удалось проверить восстановление сети Windows.".to_string())?;
    state().lock().await.recovery_required = recovery.is_err();
    recovery
}

/// Keep supervising the tunnel even when the desktop WebView is hidden or
/// closed. The client watchdog may reconnect later; this process at least
/// detects a dead core or a confirmed unsafe path and restores our adapter.
pub async fn watchdog() {
    let owner = state()
        .lock()
        .await
        .active
        .as_ref()
        .map(|active| active.owner.clone());
    if let Some(owner) = owner {
        let _ = status(&owner, false).await;
        return;
    }

    let recovery_required = state().lock().await.recovery_required;
    if recovery_required {
        let recovery =
            tokio::task::spawn_blocking(crate::tun_health::cleanup_bymevpn_routes_after_exit_sync)
                .await
                .unwrap_or_else(
                    |_| Err("Не удалось завершить восстановление сети Windows.".into()),
                );
        let mut state = state().lock().await;
        state.recovery_required = recovery.is_err();
        if recovery.is_ok() {
            if let Some(plan) = state.reconnect.as_mut() {
                plan.next_attempt = Some(Instant::now());
            }
        }
        if recovery.is_err() {
            return;
        }
    }

    let plan = {
        let mut state = state().lock().await;
        let due = state.reconnect.as_ref().is_some_and(|plan| {
            plan.auto_reconnect && plan.next_attempt.is_some_and(|at| Instant::now() >= at)
        });
        if due && !state.reconnect_in_flight {
            state.reconnect_in_flight = true;
            state.reconnect.clone()
        } else {
            None
        }
    };
    let Some(plan) = plan else {
        return;
    };
    let response = connect(
        plan.owner.clone(),
        plan.access_token.clone(),
        plan.refresh_token.clone(),
        plan.install_id.clone(),
        plan.node_code.clone(),
        plan.bypass_ru,
        &plan.ad_block,
        &plan.dns_mode,
        plan.auto_reconnect,
    )
    .await;
    let mut state = state().lock().await;
    state.reconnect_in_flight = false;
    let Ok(response) = response else {
        if let Some(next) = state.reconnect.as_mut() {
            next.failed_attempts = next.failed_attempts.saturating_add(1);
            const DELAYS: [u64; 5] = [2, 4, 8, 16, 30];
            let delay = DELAYS[next.failed_attempts.min(DELAYS.len() - 1)];
            next.next_attempt = Some(Instant::now() + Duration::from_secs(delay));
        }
        return;
    };
    if response.ok {
        return;
    }
    let recovery_required = state.recovery_required;
    if let Some(next) = state.reconnect.as_mut() {
        if let Some(access) = response.access_token {
            next.access_token = access;
        }
        if let Some(refresh) = response.refresh_token {
            next.refresh_token = refresh;
        }
        if recovery_required {
            next.next_attempt = None;
            return;
        }
        next.failed_attempts = next.failed_attempts.saturating_add(1);
        const DELAYS: [u64; 5] = [2, 4, 8, 16, 30];
        let delay = DELAYS[next.failed_attempts.min(DELAYS.len() - 1)];
        next.next_attempt = Some(Instant::now() + Duration::from_secs(delay));
    }
}

/// SCM shutdown is the last orderly opportunity to stop our child and restore
/// our own adapter. It must never search for or terminate processes by name.
pub async fn shutdown() -> Result<(), String> {
    let mut state = state().lock().await;
    let Some(active) = state.active.take() else {
        let recovery =
            tokio::task::spawn_blocking(crate::tun_health::cleanup_bymevpn_routes_after_exit_sync)
                .await
                .map_err(|_| "Не удалось завершить восстановление сети Windows.".to_string())?;
        state.recovery_required = recovery.is_err();
        return recovery;
    };
    let response = stop_active(active, true).await;
    state.recovery_required = !response.ok;
    if response.ok {
        Ok(())
    } else {
        Err(response.error.unwrap_or_else(|| {
            "Не удалось полностью восстановить сеть при остановке службы.".into()
        }))
    }
}

/// A user logoff must not leave that user's account credentials, backend VPN
/// session, or tunnel active in the machine-wide service.
pub async fn disconnect_session(session_id: u32) -> Result<(), String> {
    let mut state = state().lock().await;
    let owns_active = state
        .active
        .as_ref()
        .is_some_and(|active| active.owner.session_id == session_id);
    let owns_reconnect = state
        .reconnect
        .as_ref()
        .is_some_and(|plan| plan.owner.session_id == session_id);

    if !owns_active && !owns_reconnect {
        return Ok(());
    }
    if owns_reconnect {
        state.reconnect = None;
    }
    if let Some(active) = state.active.take().filter(|_| owns_active) {
        let response = stop_active(active, true).await;
        state.recovery_required = !response.ok;
        if !response.ok {
            return Err(response.error.unwrap_or_else(|| {
                "Не удалось восстановить сеть после выхода пользователя.".into()
            }));
        }
    }
    Ok(())
}

async fn disconnect_lost_tunnel(state: &mut BrokerState, proof: &str) -> Response {
    let Some(active) = state.active.take() else {
        return ok_response(disconnected_metrics(), None, None);
    };
    let mut response = stop_active(active, true).await;
    if response.ok {
        if let Some(metrics) = response.metrics.as_mut() {
            metrics.proof = proof.to_string();
        }
    } else {
        state.recovery_required = true;
        if let Some(metrics) = response.metrics.as_mut() {
            metrics.proof = "network_recovery_required".into();
        }
    }
    if !state.recovery_required {
        if let Some(plan) = state.reconnect.as_mut().filter(|plan| plan.auto_reconnect) {
            plan.failed_attempts = 0;
            plan.next_attempt = Some(Instant::now() + Duration::from_secs(2));
        }
    }
    response
}

async fn set_auto_reconnect(owner: &PeerIdentity, enabled: bool) -> Result<Response, String> {
    let mut state = state().lock().await;
    if let Some(plan) = state.reconnect.as_ref() {
        if &plan.owner != owner {
            return Err("VPN уже управляется в другой сессии Windows.".into());
        }
    }
    if let Some(active) = state.active.as_ref() {
        if &active.owner != owner {
            return Err("VPN уже используется в другой учётной записи Windows.".into());
        }
    }

    let recovery_required = state.recovery_required;
    let active_response = state.active.as_ref().map(|active| {
        ok_response(
            metrics(active),
            Some(active.access_token.clone()),
            Some(active.refresh_token.clone()),
        )
    });
    if let Some(plan) = state.reconnect.as_mut() {
        plan.auto_reconnect = enabled;
        plan.next_attempt = if enabled && !recovery_required && active_response.is_none() {
            Some(Instant::now() + Duration::from_secs(2))
        } else {
            None
        };
    }
    Ok(active_response.unwrap_or_else(|| ok_response(disconnected_metrics(), None, None)))
}

fn error_response(
    error: String,
    access_token: String,
    refresh_token: String,
    proof: Option<&str>,
) -> Response {
    Response {
        ok: false,
        error: Some(error),
        metrics: Some(disconnected_metrics_with(proof.unwrap_or("disconnected"))),
        access_token: Some(access_token),
        refresh_token: Some(refresh_token),
    }
}

async fn stop_active(mut active: ActiveTunnel, revoke_backend: bool) -> Response {
    let _ = active.child.kill();
    let _ = active.child.wait();
    drop(active._job);
    let _ = fs::remove_file(&active.config_path);
    let cleanup =
        tokio::task::spawn_blocking(crate::tun_health::cleanup_bymevpn_routes_after_exit_sync)
            .await
            .unwrap_or_else(|_| Err("Не удалось завершить восстановление сети Windows.".into()));
    if revoke_backend {
        if let Ok(client) = api_client() {
            let _ = api_request(
                &client,
                Method::DELETE,
                "/vpn/session",
                None,
                &mut active.access_token,
                &mut active.refresh_token,
                None,
            )
            .await;
        }
    }
    match cleanup {
        Ok(()) => ok_response(
            disconnected_metrics(),
            Some(active.access_token),
            Some(active.refresh_token),
        ),
        Err(error) => Response {
            ok: false,
            error: Some(format!(
                "Xray остановлен, но маршрут ByMeVPN не удалось восстановить: {error}"
            )),
            metrics: Some(disconnected_metrics_with("network_recovery_required")),
            access_token: Some(active.access_token),
            refresh_token: Some(active.refresh_token),
        },
    }
}

fn should_disconnect_after_health(
    proof: TunnelProof,
    path_healthy: bool,
    failures: &mut u8,
) -> bool {
    if proof == TunnelProof::RoutingBypass {
        return true;
    }
    if proof.traffic_confirmed() && path_healthy {
        *failures = 0;
        return false;
    }
    if matches!(
        proof,
        TunnelProof::ProxyUnreachable | TunnelProof::TunUnreachable
    ) || (proof.traffic_confirmed() && !path_healthy)
    {
        *failures = failures.saturating_add(1);
    } else {
        *failures = 0;
    }
    *failures >= 2
}

fn metrics(active: &ActiveTunnel) -> TunnelMetrics {
    TunnelMetrics {
        connected: true,
        verified: active.verified_ip.is_some(),
        proof: active.proof.status().into(),
        connected_seconds: active.started_at.elapsed().as_secs(),
        download_mbps: 0.0,
        upload_mbps: 0.0,
        ping_ms: 0,
        server_name: active.server_name.clone(),
        country: active.country.clone(),
        ip: active
            .verified_ip
            .map(|ip| ip.to_string())
            .unwrap_or_default(),
    }
}

fn disconnected_metrics() -> TunnelMetrics {
    disconnected_metrics_with("disconnected")
}

fn disconnected_metrics_with(proof: &str) -> TunnelMetrics {
    TunnelMetrics {
        connected: false,
        verified: false,
        proof: proof.into(),
        connected_seconds: 0,
        download_mbps: 0.0,
        upload_mbps: 0.0,
        ping_ms: 0,
        server_name: String::new(),
        country: String::new(),
        ip: String::new(),
    }
}

fn ok_response(
    metrics: TunnelMetrics,
    access_token: Option<String>,
    refresh_token: Option<String>,
) -> Response {
    Response {
        ok: true,
        error: None,
        metrics: Some(metrics),
        access_token,
        refresh_token,
    }
}
