//! Typed, bounded IPC contract for the Windows VPN service.

use serde::{Deserialize, Serialize};

pub const PIPE_NAME: &str = r"\\.\pipe\ByMeVPN.Vpn.v1";
pub const MAX_MESSAGE_BYTES: usize = 64 * 1024;

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(tag = "operation", rename_all = "snake_case", deny_unknown_fields)]
pub enum Request {
    Connect {
        access_token: String,
        refresh_token: String,
        install_id: String,
        node_code: String,
        bypass_ru: bool,
        ad_block: String,
        dns_mode: String,
        auto_reconnect: bool,
    },
    Disconnect,
    Status {
        force_probe: bool,
    },
    Diagnostics,
    SetAutoReconnect {
        enabled: bool,
    },
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TunnelMetrics {
    pub connected: bool,
    pub verified: bool,
    pub proof: String,
    pub connected_seconds: u64,
    pub download_mbps: f64,
    pub upload_mbps: f64,
    pub ping_ms: u32,
    pub server_name: String,
    pub country: String,
    pub ip: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PeerIdentity {
    pub user_sid: String,
    pub session_id: u32,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Response {
    pub ok: bool,
    pub error: Option<String>,
    pub metrics: Option<TunnelMetrics>,
    pub access_token: Option<String>,
    pub refresh_token: Option<String>,
}

impl Response {
    pub fn error(message: impl Into<String>) -> Self {
        Self {
            ok: false,
            error: Some(message.into()),
            metrics: None,
            access_token: None,
            refresh_token: None,
        }
    }
}

#[cfg(windows)]
pub fn call(request: Request) -> Result<Response, String> {
    use std::{
        fs::OpenOptions,
        io::{Read, Write},
        os::windows::ffi::OsStrExt,
    };
    use windows_sys::Win32::System::Pipes::WaitNamedPipeW;

    let pipe_name: Vec<u16> = std::ffi::OsStr::new(PIPE_NAME)
        .encode_wide()
        .chain(Some(0))
        .collect();
    if unsafe { WaitNamedPipeW(pipe_name.as_ptr(), 5_000) } == 0 {
        return Err("Служба VPN ByMeVPN недоступна. Восстановите установку приложения.".into());
    }
    let mut pipe = OpenOptions::new()
        .read(true)
        .write(true)
        .open(PIPE_NAME)
        .map_err(|_| "Не удалось связаться со службой VPN ByMeVPN.".to_string())?;
    let request_bytes =
        serde_json::to_vec(&request).map_err(|_| "Не удалось подготовить запрос VPN-службы.")?;
    if request_bytes.is_empty() || request_bytes.len() > MAX_MESSAGE_BYTES {
        return Err("Размер запроса VPN-службе превышает допустимый предел.".into());
    }
    pipe.write_all(&(request_bytes.len() as u32).to_le_bytes())
        .and_then(|_| pipe.write_all(&request_bytes))
        .and_then(|_| pipe.flush())
        .map_err(|_| "Не удалось передать запрос VPN-службе.".to_string())?;
    let mut header = [0u8; 4];
    pipe.read_exact(&mut header)
        .map_err(|_| "Служба VPN не вернула ответ.".to_string())?;
    let response_length = u32::from_le_bytes(header) as usize;
    if response_length == 0 || response_length > MAX_MESSAGE_BYTES {
        return Err("Размер ответа VPN-службы некорректен.".into());
    }
    let mut response = vec![0u8; response_length];
    pipe.read_exact(&mut response)
        .map_err(|_| "Ответ VPN-службы повреждён.".to_string())?;
    serde_json::from_slice(&response)
        .map_err(|_| "Ответ VPN-службы имеет неизвестный формат.".into())
}

#[cfg(not(windows))]
pub fn call(_request: Request) -> Result<Response, String> {
    Err("VPN-служба ByMeVPN доступна только в Windows.".into())
}
