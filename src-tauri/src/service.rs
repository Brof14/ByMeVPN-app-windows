use crate::api_transport::{send_to_bases, API_BASES};
use crate::egress::{preflight_xray_server, verify_tunnel_path, TunnelProof};
use crate::tun_config::{
    add_attestation_http_inbound, build_tun_config_ext, preflight_attestation_config,
    supports_windows_session,
};
use crate::tunnel_runtime::verify_runtime;
use keyring::Entry;
use reqwest::{Client, Method, StatusCode};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    fs,
    path::PathBuf,
    sync::{Mutex, OnceLock},
    time::Duration,
};
use tauri::{AppHandle, Manager, State};
use url::Url;
use uuid::Uuid;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

const KEYRING_SERVICE: &str = "ByMeVPN";
const ACCESS_KEY: &str = "access_token";
const REFRESH_KEY: &str = "refresh_token";
const PENDING_PAYMENT_KEY: &str = "pending_payment";
const TELEGRAM_PROFILE_KEY: &str = "telegram_profile";
const TELEGRAM_STATUS_KEY: &str = "telegram_subscription_status";
const TELEGRAM_SUBSCRIPTION_KEY: &str = "telegram_subscription_url";
static REFRESH_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
static SETTINGS_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
// reqwest::Client is internally pooled and inexpensive to clone. Avoid a new
// TLS/DNS connection pool and new X-HWID file reads for every API request.
static API_CLIENT: OnceLock<Client> = OnceLock::new();

pub struct ActiveTunnel {
    pub child: std::process::Child,
    #[cfg(windows)]
    pub _job: crate::windows_job::ChildJob,
    pub config_path: PathBuf,
    pub started_at: std::time::Instant,
    pub _node_code: String,
    pub server_name: String,
    pub country: String,
    pub server_ip: String,
    pub server_host: String,
    pub server_port: u16,
    pub use_tcp_ping: bool,
    pub last_egress_probe: std::time::Instant,
    pub last_ping_probe: std::time::Instant,
    pub cached_ping_ms: u32,
    pub baseline_ip: Option<std::net::IpAddr>,
    pub egress_verified: bool,
    pub probe_port: u16,
    pub probe_password: String,
    pub last_tunnel_proof: TunnelProof,
}

/// Removes the temporary, credential-containing preflight configuration on
/// every path, including a cancelled future or failed endpoint check.
struct TemporaryConfig(PathBuf);

impl Drop for TemporaryConfig {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}

async fn stop_failed_tun(
    child: &mut std::process::Child,
    config_path: &std::path::Path,
) -> Result<(), String> {
    // Terminating Xray closes its dynamic WFP session. An abrupt termination
    // may not run the Go cleanup that removes routes and TUN DNS settings,
    // so remove stale routes on the ByMeVPN adapter, never Wi-Fi/Ethernet.
    let _ = child.kill();
    let _ = child.wait();
    let _ = fs::remove_file(config_path);
    crate::tun_health::cleanup_bymevpn_routes_after_exit().await
}

#[derive(Default)]
pub struct AppState {
    pub tunnel: Mutex<Option<ActiveTunnel>>,
    // Serialize connect/disconnect across network requests and Xray startup.
    pub connection_gate: tokio::sync::Mutex<()>,
    // Prevent overlapping watchdog/UI egress checks from racing each other.
    pub status_probe_gate: tokio::sync::Mutex<()>,
    // Native OAuth sessions must not overlap and confuse browser callbacks.
    pub google_gate: tokio::sync::Mutex<()>,
    // One Telegram session is allowed to authorize this desktop process at a time.
    pub telegram_ticket: Mutex<Option<String>>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TunnelMetrics {
    pub connected: bool,
    #[serde(default)]
    pub verified: bool,
    /// Runtime process and a verified VPN path are separate states.
    #[serde(default)]
    pub proof: String,
    pub connected_seconds: u64,
    pub download_mbps: f64,
    pub upload_mbps: f64,
    pub ping_ms: u32,
    pub server_name: String,
    pub country: String,
    pub ip: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct UserProfile {
    #[serde(default, alias = "user_id")]
    pub id: Value,
    #[serde(default, deserialize_with = "null_string_as_empty")]
    pub email: String,
    #[serde(default, deserialize_with = "null_string_as_empty")]
    pub name: String,
    #[serde(default, alias = "is_google")]
    pub is_google: bool,
    #[serde(default)]
    pub created_at: Option<String>,
}

fn null_string_as_empty<'de, D>(deserializer: D) -> Result<String, D::Error>
where
    D: serde::Deserializer<'de>,
{
    Ok(Option::<String>::deserialize(deserializer)?.unwrap_or_default())
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Subscription {
    #[serde(default)]
    pub status: String,
    #[serde(default)]
    pub plan_code: Option<String>,
    #[serde(default)]
    pub plan_name: Option<String>,
    #[serde(default)]
    pub expires_at: Option<String>,
    #[serde(default)]
    pub seconds_remaining: i64,
    #[serde(default)]
    pub trial_available: bool,
    #[serde(default)]
    pub max_devices: i64,
    #[serde(default)]
    pub active_devices: i64,
    #[serde(default)]
    pub auto_renew: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AuthResult {
    pub user: UserProfile,
    pub subscription: Option<Subscription>,
}

fn http(app: &AppHandle) -> Result<Client, String> {
    if let Some(client) = API_CLIENT.get() {
        return Ok(client.clone());
    }
    // Match the 3x-ui HWID gate used by the mobile app and subscription API.
    // One random installation ID is stable across sign-ins on this machine.
    let mut headers = reqwest::header::HeaderMap::new();
    headers.insert(
        "X-HWID",
        reqwest::header::HeaderValue::from_str(&install_id(app)?)
            .map_err(|_| "Некорректный идентификатор устройства.")?,
    );
    headers.insert(
        "X-Device-OS",
        reqwest::header::HeaderValue::from_static("Windows"),
    );
    headers.insert("X-Ver-OS", reqwest::header::HeaderValue::from_static("10+"));
    headers.insert(
        "X-Device-Model",
        reqwest::header::HeaderValue::from_static("Windows PC"),
    );
    Client::builder()
        .default_headers(headers)
        .user_agent(concat!("ByMeVPN-Windows/", env!("CARGO_PKG_VERSION")))
        .connect_timeout(Duration::from_secs(8))
        .timeout(Duration::from_secs(15))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .inspect(|client| {
            let _ = API_CLIENT.set(client.clone());
        })
        .map_err(|e| format!("Не удалось настроить соединение с API: {e}"))
}

fn entry(name: &str) -> Result<Entry, String> {
    Entry::new(KEYRING_SERVICE, name).map_err(|e| format!("Windows Credential Manager: {e}"))
}

fn read_secret(name: &str) -> Option<String> {
    entry(name).ok()?.get_password().ok()
}

fn save_secret(name: &str, value: &str) -> Result<(), String> {
    entry(name)?
        .set_password(value)
        .map_err(|e| format!("Не удалось сохранить токен в Windows Credential Manager: {e}"))
}

fn clear_secrets() {
    for key in [
        ACCESS_KEY,
        REFRESH_KEY,
        PENDING_PAYMENT_KEY,
        TELEGRAM_PROFILE_KEY,
        TELEGRAM_STATUS_KEY,
        TELEGRAM_SUBSCRIPTION_KEY,
    ] {
        if let Ok(e) = entry(key) {
            let _ = e.delete_credential();
        }
    }
}

fn clear_pending_payment() {
    if let Ok(entry) = entry(PENDING_PAYMENT_KEY) {
        let _ = entry.delete_credential();
    }
}

#[tauri::command]
pub fn get_pending_payment() -> Option<Value> {
    read_secret(ACCESS_KEY)?;
    let raw = read_secret(PENDING_PAYMENT_KEY)?;
    let pending: Value = serde_json::from_str(&raw).ok()?;
    let code = pending.get("plan_code")?.as_str()?;
    let devices = pending.get("devices")?.as_i64()?;
    let invoice = pending.get("invoice_id")?.as_str()?;
    let url = pending.get("payment_url")?.as_str()?;
    let request_id = pending.get("request_id")?.as_str()?;
    if mobile_plan_duration(code, devices).is_none()
        || invoice.is_empty()
        || invoice.len() > 128
        || !invoice
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_'))
        || request_id.is_empty()
        || request_id.len() > 128
        || !request_id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_'))
        || !payment_url_is_allowed(url)
    {
        return None;
    }
    Some(pending)
}

fn clear_telegram_session() {
    for key in [
        TELEGRAM_PROFILE_KEY,
        TELEGRAM_STATUS_KEY,
        TELEGRAM_SUBSCRIPTION_KEY,
    ] {
        if let Ok(e) = entry(key) {
            let _ = e.delete_credential();
        }
    }
}

fn install_id(app: &AppHandle) -> Result<String, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join("install-id");
    if let Ok(id) = fs::read_to_string(&path) {
        let id = id.trim();
        if !id.is_empty() && id.len() < 80 {
            return Ok(id.to_owned());
        }
    }
    let id = Uuid::new_v4().to_string();
    fs::write(path, &id).map_err(|e| e.to_string())?;
    Ok(id)
}

fn api_error(status: StatusCode, value: &Value) -> String {
    let detail = value.get("detail").unwrap_or(value);
    let nested = detail.get("error").unwrap_or(detail);
    let code = nested.get("code").and_then(Value::as_str).unwrap_or("");
    let message = nested
        .get("message")
        .and_then(Value::as_str)
        .or_else(|| detail.as_str())
        .unwrap_or("Запрос к ByMeVPN API завершился ошибкой.");
    if code.is_empty() {
        format!("{message} (HTTP {})", status.as_u16())
    } else {
        format!("{message} [{code}] (HTTP {})", status.as_u16())
    }
}

fn api_transport_error(error: &reqwest::Error, purpose: &str) -> String {
    let reason = if error.is_timeout() {
        "истекло время ожидания ответа"
    } else if error.is_connect() {
        "не удалось установить защищённое TLS-соединение"
    } else {
        "ошибка сетевого обмена"
    };
    format!("{purpose}: {reason}. Проверьте доступность API и повторите попытку.")
}

#[derive(Debug)]
enum RefreshError {
    InvalidSession,
    Unavailable(String),
}

fn refresh_status_invalidates_session(status: StatusCode) -> bool {
    matches!(status, StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN)
}

async fn refresh(client: &Client) -> Result<(), RefreshError> {
    let token = read_secret(REFRESH_KEY).ok_or(RefreshError::InvalidSession)?;
    let response = send_to_bases(
        client,
        &API_BASES,
        Method::POST,
        "/auth/refresh",
        Some(&json!({"refresh": token})),
        None,
    )
    .await
    .map_err(|error| {
        RefreshError::Unavailable(api_transport_error(
            &error,
            "Не удалось обновить сеанс ByMeVPN",
        ))
    })?;
    let status = response.status();
    let value: Value = response.json().await.unwrap_or(Value::Null);
    if !status.is_success() {
        return Err(if refresh_status_invalidates_session(status) {
            RefreshError::InvalidSession
        } else {
            RefreshError::Unavailable(api_error(status, &value))
        });
    }
    let access = value
        .get("access")
        .or_else(|| value.get("access_token"))
        .and_then(Value::as_str)
        .unwrap_or("");
    let next_refresh = value
        .get("refresh")
        .or_else(|| value.get("refresh_token"))
        .and_then(Value::as_str)
        .unwrap_or("");
    if access.is_empty() {
        return Err(RefreshError::Unavailable(
            "Сервер не вернул токен доступа.".into(),
        ));
    }
    // Rotate refresh first; never keep a partially updated token pair.
    if !next_refresh.is_empty() {
        if let Err(error) = save_secret(REFRESH_KEY, next_refresh) {
            clear_secrets();
            return Err(RefreshError::Unavailable(error));
        }
    }
    if let Err(error) = save_secret(ACCESS_KEY, access) {
        clear_secrets();
        return Err(RefreshError::Unavailable(error));
    }
    Ok(())
}

async fn request(
    app: &AppHandle,
    method: Method,
    path: &str,
    body: Option<Value>,
    auth: bool,
    retried: bool,
) -> Result<Value, String> {
    let client = http(app)?;
    let token = if auth {
        Some(read_secret(ACCESS_KEY).ok_or("Сначала войдите в ByMeVPN.")?)
    } else {
        None
    };
    let response = send_to_bases(
        &client,
        &API_BASES,
        method.clone(),
        path,
        body.as_ref(),
        token.as_deref(),
    )
    .await
    .map_err(|error| api_transport_error(&error, "Не удалось связаться с ByMeVPN API"))?;
    let status = response.status();
    let data: Value = if status == StatusCode::NO_CONTENT {
        Value::Null
    } else {
        response.json().await.unwrap_or(Value::Null)
    };
    if status == StatusCode::UNAUTHORIZED && auth && !retried {
        {
            let _guard = REFRESH_LOCK.lock().await;
            // A different request may already have refreshed the same expired token.
            if read_secret(ACCESS_KEY) == token {
                match refresh(&client).await {
                    Ok(()) => {}
                    Err(RefreshError::InvalidSession) => {
                        clear_secrets();
                        return Err("Сеанс истёк. Войдите в аккаунт снова.".into());
                    }
                    Err(RefreshError::Unavailable(message)) => return Err(message),
                }
            }
        }
        return Box::pin(request(app, method, path, body, true, true)).await;
    }
    if !status.is_success() {
        return Err(api_error(status, &data));
    }
    let _ = app;
    Ok(data)
}

// Mirror Android's device-limit fallback when the backend omits max_devices.
fn normalized_subscription_value(value: &Value) -> Value {
    let mut result = value.clone();
    if result
        .get("max_devices")
        .and_then(Value::as_i64)
        .unwrap_or(0)
        <= 0
    {
        let from_code = result
            .get("plan_code")
            .and_then(Value::as_str)
            .and_then(|code| code.rsplit_once("_d"))
            .and_then(|(_, suffix)| suffix.parse::<i64>().ok())
            .filter(|count| matches!(count, 2 | 5 | 10));
        if let Some(limit) = from_code {
            result["max_devices"] = json!(limit);
        }
    }
    result
}

fn parse_auth(value: &Value) -> Result<AuthResult, String> {
    let access = value
        .get("access")
        .or_else(|| value.get("access_token"))
        .and_then(Value::as_str)
        .unwrap_or("");
    let refresh = value
        .get("refresh")
        .or_else(|| value.get("refresh_token"))
        .and_then(Value::as_str)
        .unwrap_or("");
    if access.is_empty() || refresh.is_empty() {
        return Err("Ответ сервера не содержит необходимые токены.".into());
    }
    let user_value = value.get("user").unwrap_or(value);
    let mut user: UserProfile = serde_json::from_value(user_value.clone())
        .map_err(|e| format!("Некорректный профиль пользователя: {e}"))?;
    if user.name.trim().is_empty() {
        user.name = user
            .email
            .split('@')
            .next()
            .unwrap_or("ByMeVPN")
            .to_string();
    }
    Ok(AuthResult {
        user,
        subscription: value
            .get("subscription")
            .and_then(|v| serde_json::from_value(normalized_subscription_value(v)).ok()),
    })
}

async fn store_auth(value: Value) -> Result<AuthResult, String> {
    let parsed = parse_auth(&value)?;
    // A newly authenticated identity must not inherit another account's invoice.
    clear_pending_payment();
    // Fail closed on partial Credential Manager failures: a new access token
    // must never be paired with the previous account's refresh token.
    let access = value["access"]
        .as_str()
        .or_else(|| value["access_token"].as_str())
        .unwrap_or("");
    let refresh = value["refresh"]
        .as_str()
        .or_else(|| value["refresh_token"].as_str())
        .unwrap_or("");
    if let Err(error) =
        save_secret(REFRESH_KEY, refresh).and_then(|_| save_secret(ACCESS_KEY, access))
    {
        clear_secrets();
        return Err(error);
    }
    clear_telegram_session();
    Ok(parsed)
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TelegramSessionInit {
    pub session_token: String,
    pub bot_url: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TelegramCheckResult {
    pub status: String,
    pub auth: Option<AuthResult>,
}

#[tauri::command]
pub async fn telegram_create_session(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<TelegramSessionInit, String> {
    let res = request(
        &app,
        Method::POST,
        "/auth/telegram/create-session",
        None,
        false,
        false,
    )
    .await?;
    let token = res
        .get("session_token")
        .and_then(Value::as_str)
        .ok_or("Сервер не вернул токен сессии Telegram.")?;
    let bot_url = res
        .get("bot_url")
        .and_then(Value::as_str)
        .ok_or("Сервер не вернул ссылку на бота.")?;
    *state.telegram_ticket.lock().map_err(|e| e.to_string())? = Some(token.to_string());
    Ok(TelegramSessionInit {
        session_token: token.to_string(),
        bot_url: bot_url.to_string(),
    })
}

/// Invalidate only the ticket being cancelled: a late IPC call must not
/// revoke a newer Telegram login attempt.
#[tauri::command]
pub fn telegram_cancel_session(
    state: State<'_, AppState>,
    session_token: String,
) -> Result<(), String> {
    let mut ticket = state.telegram_ticket.lock().map_err(|e| e.to_string())?;
    if ticket.as_deref() == Some(session_token.as_str()) {
        *ticket = None;
    }
    Ok(())
}

#[tauri::command]
pub async fn telegram_check_session(
    app: AppHandle,
    state: State<'_, AppState>,
    session_token: String,
) -> Result<TelegramCheckResult, String> {
    let token = session_token.trim();
    if token.len() > 256 || token.is_empty() {
        return Err("Некорректный токен Telegram.".into());
    }
    {
        let current = state.telegram_ticket.lock().map_err(|e| e.to_string())?;
        if current.as_deref() != Some(token) {
            return Err("Этот сеанс Telegram уже отменён.".into());
        }
    }
    // POST keeps one-time tickets out of proxy logs. Only a legacy HTTP 405
    // permits the same narrow GET fallback as the current Android client.
    let res = match request(
        &app,
        Method::POST,
        "/auth/telegram/check-session",
        Some(json!({"token": token})),
        false,
        false,
    )
    .await
    {
        Ok(response) => response,
        Err(error) if error.ends_with("(HTTP 405)") => {
            let escaped: String = url::form_urlencoded::byte_serialize(token.as_bytes()).collect();
            let path = format!("/auth/telegram/check-session?token={escaped}");
            request(&app, Method::GET, &path, None, false, false).await?
        }
        Err(error) => return Err(error),
    };
    let status = res
        .get("status")
        .and_then(Value::as_str)
        .unwrap_or("pending");
    if matches!(status, "authenticated" | "approved" | "success") {
        let access_token = res
            .get("access_token")
            .or_else(|| res.get("access"))
            .and_then(Value::as_str)
            .filter(|token| !token.is_empty())
            .ok_or("Telegram не вернул токен доступа.")?;
        let mut user: UserProfile = serde_json::from_value(
            res.get("user")
                .cloned()
                .ok_or("Telegram не вернул профиль пользователя.")?,
        )
        .map_err(|_| "Некорректный профиль Telegram.".to_string())?;
        if user.id.is_null() || user.id.as_str().is_some_and(|id| id.trim().is_empty()) {
            return Err("Telegram не подтвердил ID пользователя.".into());
        }
        if user.name.trim().is_empty() {
            user.name = "Пользователь Telegram".into();
        }
        let subscription: Option<Subscription> = res
            .get("subscription")
            .and_then(|value| serde_json::from_value(normalized_subscription_value(value)).ok());
        let refresh_token = res
            .get("refresh_token")
            .or_else(|| res.get("refresh"))
            .and_then(Value::as_str)
            .filter(|token| !token.is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| format!("ref_{access_token}"));
        // Check cancellation while the HTTP request was in flight. Keep the
        // ticket lock through credential persistence and avoid fake profiles.
        let mut ticket = state.telegram_ticket.lock().map_err(|e| e.to_string())?;
        if ticket.as_deref() != Some(token) {
            return Err("Вход через Telegram отменён.".into());
        }
        // Telegram may switch the active account. Invalidate any previous
        // identity's invoice before saving the new signed-in credentials.
        clear_pending_payment();
        if let Err(err) = save_secret(REFRESH_KEY, &refresh_token)
            .and_then(|_| save_secret(ACCESS_KEY, access_token))
        {
            clear_secrets();
            return Err(err);
        }
        *ticket = None;
        clear_telegram_session();
        return Ok(TelegramCheckResult {
            status: "approved".into(),
            auth: Some(AuthResult { user, subscription }),
        });
    }
    Ok(TelegramCheckResult {
        status: status.to_string(),
        auth: None,
    })
}

#[tauri::command]
pub async fn auth_login(
    app: AppHandle,
    email: String,
    password: String,
) -> Result<AuthResult, String> {
    let id = install_id(&app)?;
    let value = request(
        &app,
        Method::POST,
        "/auth/login",
        Some(json!({"email":email.trim(),"password":password,"install_id":id})),
        false,
        false,
    )
    .await?;
    store_auth(value).await
}

#[tauri::command]
pub async fn auth_register(
    app: AppHandle,
    email: String,
    password: String,
    name: String,
) -> Result<AuthResult, String> {
    if password.chars().count() < 6 {
        return Err("Пароль должен содержать не менее 6 символов.".into());
    }
    let id = install_id(&app)?;
    let value = request(
        &app,
        Method::POST,
        "/auth/register",
        Some(json!({"email":email.trim(),"password":password,"name":name.trim(),"install_id":id})),
        false,
        false,
    )
    .await?;
    store_auth(value).await
}

#[tauri::command]
pub async fn auth_logout(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let _connection_guard = state.connection_gate.lock().await;
    // Logout must not leave the privileged VPN running under a different
    // account. Refuse logout if the OS cannot terminate the tunnel.
    {
        let mut lock = state.tunnel.lock().map_err(|e| e.to_string())?;
        if let Some(active) = lock.as_mut() {
            let already_exited = active
                .child
                .try_wait()
                .map_err(|e| format!("Не удалось проверить VPN перед выходом: {e}"))?
                .is_some();
            if !already_exited {
                active
                    .child
                    .kill()
                    .map_err(|e| format!("Не удалось остановить VPN перед выходом: {e}"))?;
                active
                    .child
                    .wait()
                    .map_err(|e| format!("Не удалось дождаться остановки VPN: {e}"))?;
            }
        }
        if let Some(active) = lock.take() {
            let _ = fs::remove_file(active.config_path);
        }
    }
    let _ = request(&app, Method::DELETE, "/vpn/session", None, true, false).await;
    let _ = request(
        &app,
        Method::POST,
        "/auth/logout",
        Some(json!({})),
        true,
        false,
    )
    .await;
    clear_secrets();
    *state.telegram_ticket.lock().map_err(|e| e.to_string())? = None;
    Ok(())
}

fn device_is_current(object: &serde_json::Map<String, Value>, install_id: &str) -> bool {
    object
        .get("is_current")
        .and_then(Value::as_bool)
        .unwrap_or_else(|| {
            object
                .get("install_id")
                .and_then(Value::as_str)
                .is_some_and(|id| id == install_id)
        })
}

async fn snapshot(app: &AppHandle) -> Result<Value, String> {
    let me = request(app, Method::GET, "/me", None, true, false).await?;
    // An outage in the subscription panel must not look like invalid login.
    // Unknown is different from "none" and must not trigger a purchase prompt.
    let sub = request(app, Method::GET, "/subscription/status", None, true, false)
        .await
        .unwrap_or_else(|_| {
            json!({
                "status": "unknown",
                "plan_name": "Не удалось проверить подписку",
                "trial_available": false
            })
        });
    // Device-management downtime must never break login or session recovery.
    let devices = request(app, Method::GET, "/devices", None, true, false)
        .await
        .ok();
    let user = me.get("user").unwrap_or(&me).clone();
    let subscription = normalized_subscription_value(sub.get("subscription").unwrap_or(&sub));
    let current_install_id = install_id(app)?;
    let mut device_list = devices
        .as_ref()
        .and_then(|response| response.get("devices"))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    for device in &mut device_list {
        if let Some(object) = device.as_object_mut() {
            // 3x-ui identifies the current device through X-HWID on the
            // backend. Preserve its canonical boolean, not a fabricated
            // comparison with an install_id that the API never returns.
            let current = device_is_current(object, &current_install_id);
            object.insert("is_current".into(), json!(current));
        }
    }
    Ok(
        json!({"user":user,"subscription":subscription,"devices":device_list,
        "devices_supported": devices.is_some()}),
    )
}

#[tauri::command]
pub async fn restore_session(app: AppHandle) -> Result<Option<AuthResult>, String> {
    if read_secret(ACCESS_KEY).is_none() {
        // Legacy URL import never issued API credentials. Do not restore it as a
        // misleading authenticated user with a fictitious active subscription.
        clear_telegram_session();
        if read_secret(REFRESH_KEY).is_none() {
            return Ok(None);
        }
        match refresh(&http(&app)?).await {
            Ok(()) => {}
            Err(RefreshError::InvalidSession) => {
                clear_secrets();
                return Ok(None);
            }
            Err(RefreshError::Unavailable(message)) => return Err(message),
        }
    }
    let data = snapshot(&app).await?;
    let user: UserProfile = serde_json::from_value(data["user"].clone())
        .map_err(|e| format!("Некорректный профиль: {e}"))?;
    let subscription =
        serde_json::from_value(normalized_subscription_value(&data["subscription"])).ok();
    Ok(Some(AuthResult { user, subscription }))
}

#[tauri::command]
pub async fn account_snapshot(app: AppHandle) -> Result<Value, String> {
    snapshot(&app).await
}

fn tcp_ping_target(host: &str, port: u16) -> String {
    if host.contains(':') && !host.starts_with('[') {
        format!("[{host}]:{port}")
    } else {
        format!("{host}:{port}")
    }
}

fn protocol_supports_tcp_ping(config: &Value) -> bool {
    !config
        .get("protocol")
        .and_then(Value::as_str)
        .is_some_and(|protocol| {
            protocol.eq_ignore_ascii_case("hysteria2") || protocol.eq_ignore_ascii_case("hy2")
        })
}

pub fn measure_real_ping(host: &str, default_port: u16) -> u32 {
    use std::net::{TcpStream, ToSocketAddrs};
    let target = tcp_ping_target(host, default_port);
    if let Ok(addrs) = target.to_socket_addrs() {
        for addr in addrs {
            let start = std::time::Instant::now();
            if TcpStream::connect_timeout(&addr, Duration::from_millis(1800)).is_ok() {
                return (start.elapsed().as_millis().max(1) as u32).min(9999);
            }
        }
    }
    0
}

#[tauri::command]
pub async fn get_servers(app: AppHandle) -> Result<Vec<Value>, String> {
    let data = request(&app, Method::GET, "/servers", None, true, false).await?;
    let servers = data
        .get("servers")
        .and_then(Value::as_array)
        .ok_or("Сервер не вернул список доступных локаций.")?;
    // Avoid spawning an unbounded number of blocking DNS/TCP probes when
    // the server catalog grows. Rendering remains responsive under load.
    let ping_slots = std::sync::Arc::new(tokio::sync::Semaphore::new(6));
    let mut tasks = Vec::with_capacity(servers.len());
    let mut normalized = Vec::with_capacity(servers.len());
    for server in servers {
        let config = server.get("config").unwrap_or(server);
        let code = server
            .get("node_code")
            .or_else(|| server.get("code"))
            .and_then(Value::as_str)
            .unwrap_or("");
        if code.is_empty() {
            continue;
        }
        let code_upper = server
            .get("country_code")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_ascii_uppercase();
        let country_fallback = match code_upper.as_str() {
            "DE" => "Германия",
            "NL" => "Нидерланды",
            "US" => "США",
            "FI" => "Финляндия",
            "SE" => "Швеция",
            "GB" => "Великобритания",
            _ => "Основной сервер",
        };
        let country_en_fallback = match code_upper.as_str() {
            "DE" => "Germany",
            "NL" => "Netherlands",
            "US" => "USA",
            "FI" => "Finland",
            "SE" => "Sweden",
            "GB" => "United Kingdom",
            _ => "Main Server",
        };
        let country = server
            .get("country")
            .and_then(Value::as_str)
            .filter(|v| !v.is_empty() && *v != "Unknown")
            .unwrap_or(country_fallback);
        let country_en = server
            .get("country_en")
            .and_then(Value::as_str)
            .filter(|v| !v.is_empty())
            .unwrap_or(if country == country_fallback {
                country_en_fallback
            } else {
                country
            });
        let city = server
            .get("city")
            .and_then(Value::as_str)
            .filter(|v| *v != "Unknown")
            .unwrap_or("");
        let city_en = server
            .get("city_en")
            .and_then(Value::as_str)
            .filter(|v| !v.is_empty())
            .unwrap_or(city);
        let name = server
            .get("display_name")
            .or_else(|| server.get("name"))
            .or_else(|| server.get("remark"))
            .and_then(Value::as_str)
            .unwrap_or(code);
        let name_en = server
            .get("display_name_en")
            .or_else(|| server.get("name_en"))
            .and_then(Value::as_str)
            .filter(|v| !v.is_empty())
            .unwrap_or(country_en);
        let flag_fallback = match code_upper.as_str() {
            "DE" => "🇩🇪",
            "NL" => "🇳🇱",
            "US" => "🇺🇸",
            "FI" => "🇫🇮",
            "SE" => "🇸🇪",
            "GB" => "🇬🇧",
            _ => "🌐",
        };
        let flag = server
            .get("flag")
            .and_then(Value::as_str)
            .filter(|v| !v.is_empty())
            .unwrap_or(flag_fallback);
        let host = config
            .get("server")
            .or_else(|| config.get("endpoint"))
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        let port = config.get("port").and_then(Value::as_u64).unwrap_or(443);
        let supported = supports_windows_session(config);
        // Hysteria2 is UDP-only; a TCP connect is not its latency and
        // just delays the server list by waiting for a closed TCP port.
        let task = if supported
            && protocol_supports_tcp_ping(config)
            && !host.is_empty()
            && (1..=65535).contains(&port)
        {
            let slots = ping_slots.clone();
            Some(tauri::async_runtime::spawn(async move {
                let _permit = slots.acquire_owned().await.ok()?;
                tauri::async_runtime::spawn_blocking(move || measure_real_ping(&host, port as u16))
                    .await
                    .ok()
            }))
        } else {
            None
        };
        tasks.push(task);
        normalized.push(json!({"code":code, "name":name, "name_en":name_en,
            "country":country, "country_en":country_en, "country_code":code_upper,
            "city":city, "city_en":city_en,
            "flag":flag, "supported":supported, "ping":0}));
    }
    // Bound the entire catalog loading delay, even with dozens of blocked
    // endpoints. Unknown latency stays 0 rather than becoming a fake ping.
    let deadline = tokio::time::Instant::now() + Duration::from_secs(4);
    for (server, task) in normalized.iter_mut().zip(tasks) {
        if let Some(mut task) = task {
            match tokio::time::timeout_at(deadline, &mut task).await {
                Ok(Ok(Some(ping))) => server["ping"] = json!(ping),
                _ => task.abort(),
            }
        }
    }
    Ok(normalized)
}

/// Android V2 sells exact, device-scoped plans (1m_d2, 3m_d5, etc.).
/// Never infer prices/durations from legacy flat catalogs or other tiers.
fn mobile_plan_duration(code: &str, devices: i64) -> Option<i64> {
    for (base, days) in [("1m", 30), ("3m", 120), ("6m", 240), ("12m", 450)] {
        if code == format!("{base}_d{devices}") {
            return Some(days);
        }
    }
    None
}

fn confirmed_mobile_plan(plan: &Value, devices: i64, checkout_default: bool) -> Option<Value> {
    let code = plan.get("code")?.as_str()?;
    let expected_days = mobile_plan_duration(code, devices)?;
    let days = plan.get("days")?.as_i64()?;
    let price = plan.get("price_rub")?.as_i64()?;
    let tier = plan.get("devices").and_then(Value::as_i64).unwrap_or(2);
    if days != expected_days || price <= 0 || tier != devices {
        return None;
    }
    let mut verified = plan.clone();
    verified["purchase_enabled"] = json!(plan
        .get("purchase_enabled")
        .and_then(Value::as_bool)
        .unwrap_or(checkout_default));
    verified["devices"] = json!(devices);
    Some(verified)
}

fn mobile_catalog_plans(catalog: &Value, devices: i64) -> Vec<Value> {
    let checkout_default = catalog
        .get("payment_enabled")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let plans = catalog
        .get("raw_array")
        .or_else(|| catalog.get("plans"))
        .and_then(Value::as_array);
    // Some backends preserve the catalog as a JSON-encoded string.
    let raw = catalog
        .get("raw")
        .and_then(Value::as_str)
        .and_then(|raw| serde_json::from_str::<Vec<Value>>(raw).ok());
    plans
        .cloned()
        .or(raw)
        .unwrap_or_default()
        .iter()
        .filter_map(|plan| confirmed_mobile_plan(plan, devices, checkout_default))
        .collect()
}

#[tauri::command]
pub async fn get_plans(app: AppHandle) -> Result<Vec<Value>, String> {
    // Android V2 explicitly scopes pricing to each device tier, and requires auth.
    // Each tier is independent: one unavailable tier should not hide valid offers.
    let tasks: Vec<_> = [2_i64, 5, 10]
        .into_iter()
        .map(|devices| {
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                let path = format!("/mobile/v2/plans?devices={devices}");
                (
                    devices,
                    request(&app, Method::GET, &path, None, true, false).await,
                )
            })
        })
        .collect();
    let mut confirmed = Vec::new();
    let mut failure = None;
    for task in tasks {
        match task.await {
            Ok((devices, Ok(body))) => confirmed.extend(mobile_catalog_plans(&body, devices)),
            Ok((_, Err(error))) => failure = Some(error),
            Err(error) => failure = Some(format!("Не удалось загрузить тарифы: {error}")),
        }
    }
    if confirmed.is_empty() {
        return Err(failure.unwrap_or_else(|| {
            "Сервер не вернул ни одного подтверждённого тарифа Android V2.".into()
        }));
    }
    Ok(confirmed)
}

#[tauri::command]
pub async fn delete_device(app: AppHandle, device_id: String) -> Result<(), String> {
    if device_id.is_empty()
        || device_id.len() > 80
        || !device_id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err("Некорректный идентификатор устройства.".into());
    }
    request(
        &app,
        Method::DELETE,
        &format!("/devices/{device_id}"),
        None,
        true,
        false,
    )
    .await?;
    Ok(())
}

// Keep the legacy IPC entry point strict: Android's backend requires a
// server-issued nonce tied to the signed ID token. Never accept email/name
// fields from the untrusted WebView as Google account identity.
#[tauri::command]
pub async fn auth_google(
    app: AppHandle,
    id_token: String,
    nonce: String,
) -> Result<AuthResult, String> {
    if id_token.len() > 16_384
        || id_token.split('.').count() != 3
        || nonce.len() < 24
        || nonce.len() > 256
    {
        return Err("Некорректный токен или одноразовый запрос входа Google.".into());
    }
    let id = install_id(&app)?;
    let result = request(
        &app,
        Method::POST,
        "/auth/google",
        Some(json!({"id_token": id_token, "nonce": nonce, "install_id": id})),
        false,
        false,
    )
    .await?;
    store_auth(result).await
}

/// Windows Desktop OAuth: server nonce + native system browser with PKCE.
/// All Google tokens stay inside Rust; only the verified ByMeVPN user snapshot
/// is returned to the WebView.
#[tauri::command]
pub async fn auth_google_desktop(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<AuthResult, String> {
    let _login_guard = state.google_gate.lock().await;
    let config = request(
        &app,
        Method::GET,
        "/auth/google/desktop-client",
        None,
        false,
        false,
    )
    .await?;
    let client_id = config
        .get("client_id")
        .and_then(Value::as_str)
        .ok_or("Сервер не настроил Google OAuth Desktop Client ID.")?;
    let challenge = request(
        &app,
        Method::POST,
        "/auth/google/nonce",
        Some(json!({})),
        false,
        false,
    )
    .await?;
    let nonce = challenge
        .get("nonce")
        .and_then(Value::as_str)
        .ok_or("Сервер не выдал одноразовый код Google.")?;
    let id = install_id(&app)?;
    // When configured, let the backend perform the Google token exchange
    // with the Desktop client credential in server-only environment storage.
    // The authorization code and PKCE verifier never pass into the WebView.
    if config.get("server_code_exchange").and_then(Value::as_bool) == Some(true) {
        let code = crate::google_desktop::acquire_code(client_id, nonce).await?;
        let result = request(
            &app,
            Method::POST,
            "/auth/google/desktop-exchange",
            Some(json!({
                "code": code.code,
                "code_verifier": code.code_verifier,
                "redirect_uri": code.redirect_uri,
                "nonce": nonce,
                "install_id": id,
            })),
            false,
            false,
        )
        .await?;
        store_auth(result).await
    } else {
        // Existing deployments that have not configured server exchange
        // retain the original PKCE flow and clear provider error codes.
        let token = crate::google_desktop::acquire_id_token(client_id, nonce).await?;
        let result = request(
            &app,
            Method::POST,
            "/auth/google",
            Some(json!({"id_token": token, "nonce": nonce, "install_id": id})),
            false,
            false,
        )
        .await?;
        store_auth(result).await
    }
}

#[tauri::command]
pub async fn activate_trial(app: AppHandle) -> Result<Subscription, String> {
    let id = install_id(&app)?;
    let res = request(
        &app,
        Method::POST,
        "/subscription/trial",
        Some(json!({
            "install_id": id,
            "device_model": "Windows PC"
        })),
        true,
        false,
    )
    .await?;
    let sub = res.get("subscription").unwrap_or(&res);
    serde_json::from_value(normalized_subscription_value(sub))
        .map_err(|e| format!("Некорректный статус: {e}"))
}

#[tauri::command]
pub async fn create_payment(
    app: AppHandle,
    plan_code: String,
    devices: Option<i64>,
    amount_rub: Option<i64>,
    days: Option<i64>,
    request_id: Option<String>,
) -> Result<Value, String> {
    let dev = devices.unwrap_or(2);
    if !matches!(dev, 2 | 5 | 10) {
        return Err("Недопустимое количество устройств.".into());
    }
    let canonical_days = mobile_plan_duration(&plan_code, dev)
        .ok_or("Неизвестный тариф Android V2 для выбранного числа устройств.")?;
    let submitted_days = days
        .filter(|days| *days > 0)
        .ok_or("Не загружен срок тарифа.")?;
    let submitted_price = amount_rub
        .filter(|price| *price > 0)
        .ok_or("Не загружена цена тарифа.")?;
    if submitted_days != canonical_days {
        return Err("Срок тарифа не соответствует проверенному каталогу.".into());
    }
    let request_id = request_id.unwrap_or_else(|| format!("req_{}", Uuid::new_v4().simple()));
    if request_id.len() < 8
        || request_id.len() > 128
        || !request_id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_'))
    {
        return Err("Некорректный идентификатор платежа.".into());
    }

    // Revalidate server-owned price, duration, tier and checkout capability.
    // A stale or tampered desktop UI must never initiate an unknown payment.
    let catalog = request(
        &app,
        Method::GET,
        &format!("/mobile/v2/plans?devices={dev}"),
        None,
        true,
        false,
    )
    .await?;
    let matching = mobile_catalog_plans(&catalog, dev)
        .into_iter()
        .find(|p| p.get("code").and_then(Value::as_str) == Some(plan_code.as_str()));
    let plan = matching.ok_or("Выбранный тариф больше не доступен. Обновите список тарифов.")?;
    if plan.get("price_rub").and_then(Value::as_i64) != Some(submitted_price)
        || plan.get("days").and_then(Value::as_i64) != Some(submitted_days)
    {
        return Err("Цена или срок тарифа изменились. Обновите тарифы перед оплатой.".into());
    }
    if plan.get("purchase_enabled").and_then(Value::as_bool) != Some(true) {
        return Err("Сервер временно отключил оплату этого тарифа.".into());
    }

    // New Android contract: send ONLY the canonical SKU and an idempotency
    // key; the backend, not the desktop client, owns the checkout terms.
    let result = request(
        &app,
        Method::POST,
        "/mobile/v2/payment/create",
        Some(json!({
            "plan_code": plan_code,
            "provider": "yookassa",
            "request_id": request_id
        })),
        true,
        false,
    )
    .await?;
    let invoice = result
        .get("invoice_id")
        .and_then(Value::as_str)
        .ok_or("Сервер оплаты не вернул идентификатор счёта.")?;
    if invoice.is_empty()
        || invoice.len() > 128
        || !invoice
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_'))
    {
        return Err("Сервер оплаты вернул некорректный номер счёта.".into());
    }
    let payment_url = result
        .get("payment_url")
        .or_else(|| result.get("confirmation_url"))
        .and_then(Value::as_str)
        .ok_or("Сервер не вернул ссылку на оплату.")?;
    if !payment_url_is_allowed(payment_url) {
        return Err("Ссылка оплаты не принадлежит проверенному провайдеру.".into());
    }
    if result
        .get("provider")
        .and_then(Value::as_str)
        .is_some_and(|provider| provider != "yookassa")
    {
        return Err("Сервер вернул неожиданного платёжного провайдера.".into());
    }
    let pending = json!({
        "plan_code":plan_code, "devices":dev, "price_rub":submitted_price,
        "days":submitted_days, "invoice_id":invoice, "payment_url":payment_url,
        "request_id":request_id
    });
    save_secret(PENDING_PAYMENT_KEY, &pending.to_string())?;
    Ok(result)
}

fn payment_url_is_allowed(url: &str) -> bool {
    let Ok(parsed) = Url::parse(url) else {
        return false;
    };
    let host = parsed.host_str().unwrap_or_default();
    parsed.scheme() == "https"
        && (host == "yookassa.ru"
            || host.ends_with(".yookassa.ru")
            || host == "yoomoney.ru"
            || host.ends_with(".yoomoney.ru"))
        && parsed.port().is_none_or(|port| port == 443)
        && parsed.username().is_empty()
        && parsed.password().is_none()
}

/// Query invoice-specific fulfillment; an active prior subscription does not
/// prove that this invoice was paid.
#[tauri::command]
pub async fn check_payment(app: AppHandle, invoice_id: String) -> Result<Value, String> {
    if invoice_id.is_empty()
        || invoice_id.len() > 128
        || !invoice_id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_'))
    {
        return Err("Некорректный номер счёта.".into());
    }
    let result = request(
        &app,
        Method::GET,
        &format!("/mobile/v2/payment/check?invoice_id={invoice_id}&provider=yookassa"),
        None,
        true,
        false,
    )
    .await?;
    let paid = matches!(
        result.get("status").and_then(Value::as_str),
        Some("succeeded" | "paid" | "completed")
    ) && result.get("is_active").and_then(Value::as_bool) == Some(true);
    let failed = matches!(
        result.get("status").and_then(Value::as_str),
        Some("failed" | "canceled" | "cancelled" | "expired")
    );
    if (paid || failed)
        && get_pending_payment()
            .as_ref()
            .and_then(|p| p.get("invoice_id"))
            .and_then(Value::as_str)
            == Some(invoice_id.as_str())
    {
        clear_pending_payment();
    }
    Ok(result)
}

// The packaged path must match bundle.resources in tauri.conf.json.
// Old installers used an array with "../"; Tauri rewrites it to "_up_".
fn bundled_runtime_candidates(resource_root: &std::path::Path) -> [PathBuf; 2] {
    [
        resource_root.join("vendor/runtime/windows-x64"),
        resource_root.join("_up_/vendor/runtime/windows-x64"),
    ]
}

fn find_verified_runtime(candidates: impl IntoIterator<Item = PathBuf>) -> Result<PathBuf, String> {
    let mut damaged_or_incomplete = false;
    for directory in candidates {
        if !directory.join("xray.exe").is_file() && !directory.join("wintun.dll").is_file() {
            continue;
        }
        if verify_runtime(&directory).is_ok() {
            return Ok(directory);
        }
        damaged_or_incomplete = true;
    }
    if damaged_or_incomplete {
        Err("Компоненты VPN повреждены или неполные. Переустановите ByMeVPN из полного установщика (.exe или .msi).".into())
    } else {
        Err("Не найдены компоненты Xray и Wintun. Установите ByMeVPN через полный установщик .exe/.msi, а не запускайте отдельный файл bymevpn.exe.".into())
    }
}

pub fn get_runtime_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let mut candidates = Vec::new();
    // Prefer the installer's resource directory. Never search an arbitrary
    // working directory ahead of bundled, hash-verified executables.
    if let Ok(resources) = app.path().resource_dir() {
        candidates.extend(bundled_runtime_candidates(&resources));
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            candidates.extend(bundled_runtime_candidates(parent));
            // Preserve support for the fully extracted portable ZIP.
            candidates.push(parent.join("runtime/windows-x64"));
        }
    }
    // Developer cargo run from the repository root.
    if cfg!(debug_assertions) {
        candidates.push(
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../vendor/runtime/windows-x64"),
        );
    }
    find_verified_runtime(candidates)
}

fn default_settings() -> Value {
    json!({
        "autoStart": false,
        "autoConnect": false,
        "stayConnectedInBackground": false,
        "bypassRu": true,
        "adBlock": "none",
        "dnsMode": "cloudflare",
        "killSwitch": false,
        "language": "system",
        "selectedServerCode": "auto"
    })
}

fn validate_setting(key: &str, value: &Value) -> Result<(), String> {
    match key {
        "autoStart" | "autoConnect" | "bypassRu" => {
            if !value.is_boolean() {
                return Err("Эта настройка должна иметь значение вкл./выкл.".into());
            }
        }
        "stayConnectedInBackground" | "killSwitch" => {
            if value != &Value::Bool(false) {
                return Err("Функция будет доступна после проверки безопасности Windows.".into());
            }
        }
        "adBlock" => {
            if !matches!(value.as_str(), Some("none" | "basic" | "recommended")) {
                return Err("Неизвестный режим блокировки рекламы.".into());
            }
        }
        "dnsMode" => {
            if !matches!(value.as_str(), Some("cloudflare" | "adguard" | "google")) {
                return Err("Неизвестный DNS-провайдер.".into());
            }
        }
        "language" => {
            if !matches!(value.as_str(), Some("ru" | "en" | "system")) {
                return Err("Приложение поддерживает RU, EN и язык системы.".into());
            }
        }
        "selectedServerCode" => {
            let code = value.as_str().ok_or("Некорректный код сервера.")?;
            if code.is_empty()
                || code.len() > 128
                || !code
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-'))
            {
                return Err("Некорректный код сервера.".into());
            }
        }
        _ => return Err("Неизвестная настройка.".into()),
    }
    Ok(())
}

pub fn load_settings(app: &AppHandle) -> Value {
    let mut settings = default_settings();
    let dir = match app.path().app_data_dir() {
        Ok(dir) => dir,
        Err(_) => return settings,
    };
    let path = dir.join("settings.json");
    if let Ok(saved) = fs::read(&path) {
        if let Ok(Value::Object(saved)) = serde_json::from_slice::<Value>(&saved) {
            for (key, val) in saved {
                // Ignore stale, invalid and unsupported settings during migration.
                if validate_setting(&key, &val).is_ok() {
                    settings[&key] = val;
                }
            }
        }
    }
    settings
}

#[tauri::command]
pub fn get_settings(app: AppHandle) -> Value {
    load_settings(&app)
}

#[tauri::command]
pub async fn save_setting(app: AppHandle, key: String, value: Value) -> Result<(), String> {
    validate_setting(&key, &value)?;
    let _guard = SETTINGS_LOCK.lock().await;
    let dir: PathBuf = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join("settings.json");
    let tmp = dir.join(format!("settings.{}.tmp", Uuid::new_v4()));
    let mut settings = load_settings(&app);
    settings[&key] = value;
    let serialized = serde_json::to_vec_pretty(&settings).map_err(|e| e.to_string())?;
    fs::write(&tmp, serialized).map_err(|e| e.to_string())?;
    if let Err(error) = fs::rename(&tmp, &path) {
        let _ = fs::remove_file(tmp);
        return Err(format!("Не удалось сохранить настройки: {error}"));
    }
    Ok(())
}

#[tauri::command]
pub async fn vpn_start(
    app: AppHandle,
    state: State<'_, AppState>,
    node_code: Option<String>,
) -> Result<TunnelMetrics, String> {
    let _connection_guard = state.connection_gate.lock().await;
    {
        let lock = state.tunnel.lock().map_err(|e| e.to_string())?;
        if lock.is_some() {
            return Err("Подключение уже активно.".into());
        }
    }

    // Check that user has an active or trial subscription before launching tunnel
    let sub_status = request(&app, Method::GET, "/subscription/status", None, true, false)
        .await
        .map_err(|e| format!("Не удалось проверить подписку. Подключение не начато: {e}"))?;
    let subscription = sub_status.get("subscription").unwrap_or(&sub_status);
    let status = subscription
        .get("status")
        .and_then(Value::as_str)
        .unwrap_or("unknown");
    if status == "unknown" {
        return Err(
            "Статус подписки пока неизвестен. Повторите проверку при доступной сети.".into(),
        );
    }
    if !matches!(status, "active" | "trial" | "grace") {
        return Err("Для подключения требуется активная подписка ByMeVPN. Активируйте пробный доступ или выберите тариф.".into());
    }

    let runtime_dir = get_runtime_dir(&app)?;

    let settings = load_settings(&app);
    let bypass_ru = settings
        .get("bypassRu")
        .and_then(Value::as_bool)
        .unwrap_or(true);
    let ad_block = settings
        .get("adBlock")
        .and_then(Value::as_str)
        .unwrap_or("none");
    let dns_mode = settings
        .get("dnsMode")
        .and_then(Value::as_str)
        .unwrap_or("cloudflare");

    let chosen_node = node_code.unwrap_or_else(|| "auto".to_string());
    let id = install_id(&app)?;

    // Egress providers may be blocked independently of the VPN endpoint. Their
    // outage must not prevent connecting, but protection stays unverified.
    let baseline_ip = crate::egress::public_egress_ip().await.ok();

    let session_val = request(
        &app,
        Method::POST,
        "/vpn/session",
        Some(json!({
            "node_code": chosen_node,
            "install_id": id
        })),
        true,
        false,
    )
    .await
    .map_err(|e| format!("Не удалось открыть сессию VPN: {e}"))?;

    // Every failure after creating a server session must revoke the session.
    // This prevents exhausted device slots after invalid configs, missing
    // components or unexpected Xray startup failures.
    let connection_result: Result<TunnelMetrics, String> = async {
        let session = session_val.get("session").unwrap_or(&session_val);
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
        // Server inbound and public egress IP often differ (NAT, relays, reverse proxies).
        let mut xray_config = build_tun_config_ext(session, bypass_ru, ad_block, dns_mode)?;
        // The port is bound only on localhost, and its secret is unique for
        // each connection. No listener is exposed on a physical/LAN adapter.
        let reservation = std::net::TcpListener::bind(("127.0.0.1", 0))
            .map_err(|_| "Не удалось подготовить локальную проверку VPN.")?;
        let probe_port = reservation
            .local_addr()
            .map_err(|_| "Не удалось определить локальный порт проверки VPN.")?
            .port();
        let probe_password = Uuid::new_v4().simple().to_string();
        add_attestation_http_inbound(
            &mut xray_config,
            probe_port,
            "bymevpn",
            &probe_password,
        )?;
        // Xray owns this port after startup. There remains a small bind race;
        // it is detected via a failed native verification, never green status.
        drop(reservation);

        let app_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
        fs::create_dir_all(&app_dir).map_err(|e| e.to_string())?;
        let config_path = app_dir.join("active_tunnel.json");
        fs::write(
            &config_path,
            serde_json::to_vec_pretty(&xray_config).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;

        #[cfg(windows)]
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        #[cfg(not(windows))]
        const CREATE_NO_WINDOW: u32 = 0;

        // Process startup and config validation are blocking Win32 operations.
        // Keep them off the Tauri async executor so auth, UI and watchdog
        // requests remain responsive while Xray initializes.
        let check_runtime = runtime_dir.clone();
        let check_config = config_path.clone();
        let test_res = tauri::async_runtime::spawn_blocking(move || {
            std::process::Command::new(check_runtime.join("xray.exe"))
                .current_dir(&check_runtime)
                .env("XRAY_LOCATION_ASSET", &check_runtime)
                .args(["run", "-test", "-config"])
                .arg(&check_config)
                .creation_flags(CREATE_NO_WINDOW)
                .output()
        })
        .await
        .map_err(|e| format!("Ошибка фоновой проверки Xray: {e}"))?
        .map_err(|e| format!("Не удалось проверить конфигурацию Xray: {e}"))?;

        if !test_res.status.success() {
            let _ = fs::remove_file(&config_path);
            // Xray emits actionable parser/config diagnostics on stderr.
            let cause = String::from_utf8_lossy(&test_res.stderr);
            let detail: String = cause.trim().chars().take(500).collect();
            return Err(if detail.is_empty() {
                format!(
                    "Конфигурация Xray отклонена (код {:?}).",
                    test_res.status.code()
                )
            } else {
                format!("Ошибка конфигурации Xray: {detail}")
            });
        }

        // Preflight the REAL selected VPN outbound while Windows networking
        // is untouched. A broken VLESS/Reality/Hysteria server must never be
        // allowed to install a default route that blackholes all PC traffic.
        let preflight_config = preflight_attestation_config(&xray_config)?;
        let preflight_path = app_dir.join(format!("preflight-{}.json", Uuid::new_v4()));
        fs::write(
            &preflight_path,
            serde_json::to_vec(&preflight_config).map_err(|e| e.to_string())?,
        )
        .map_err(|_| "Не удалось создать локальный тест сервера VPN.")?;
        let _temporary_config = TemporaryConfig(preflight_path.clone());

        // Preserve preflight failures for local diagnostics, overwriting the
        // log only when the real TUN stage starts. Never upload raw Xray logs.
        let startup_log = app_dir.join("xray_startup.log");
        let preflight_log = fs::OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(true)
            .open(&startup_log)
            .map_err(|_| "Не удалось открыть журнал проверки VPN.")?;
        let preflight_stdout = preflight_log
            .try_clone()
            .map_err(|_| "Не удалось подготовить журнал проверки VPN.")?;
        let mut preflight_child = std::process::Command::new(runtime_dir.join("xray.exe"))
            .current_dir(&runtime_dir)
            .env("XRAY_LOCATION_ASSET", &runtime_dir)
            .args(["run", "-config"])
            .arg(&preflight_path)
            .stdout(std::process::Stdio::from(preflight_stdout))
            .stderr(std::process::Stdio::from(preflight_log))
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map_err(|_| "Не удалось запустить проверку VPN-сервера.")?;
        #[cfg(windows)]
        let preflight_job = match crate::windows_job::ChildJob::attach(&preflight_child) {
            Ok(job) => job,
            Err(error) => {
                let _ = preflight_child.kill();
                let _ = preflight_child.wait();
                return Err(error);
            }
        };
        tokio::time::sleep(Duration::from_millis(250)).await;
        let preflight_ok = matches!(preflight_child.try_wait(), Ok(None))
            && preflight_xray_server(probe_port, &probe_password).await;
        // Shut down the process with NO TUN before enabling the system route.
        let _ = preflight_child.kill();
        let _ = preflight_child.wait();
        #[cfg(windows)]
        drop(preflight_job);
        if !preflight_ok {
            return Err("VPN-сервер не прошёл безопасную проверку. Системные маршруты Windows не изменены. Проверьте сервер и параметры подключения.".into());
        }

        // Preserve bounded, local diagnostics for failures that happen only
        // after 'xray run -test' succeeds (Wintun, routes, WFP, DNS).
        // This log is private to the current Windows profile and is reset on
        // each connection attempt. Never transmit it automatically.
        let log_path = app_dir.join("xray_startup.log");
        let xray_log = fs::OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(true)
            .open(&log_path)
            .map_err(|e| format!("Не удалось открыть локальный журнал Xray: {e}"))?;
        let xray_stdout = xray_log
            .try_clone()
            .map_err(|e| format!("Не удалось подготовить журнал Xray: {e}"))?;
        let mut child = match std::process::Command::new(runtime_dir.join("xray.exe"))
            .current_dir(&runtime_dir)
            .env("XRAY_LOCATION_ASSET", &runtime_dir)
            .args(["run", "-config"])
            .arg(&config_path)
            .stdout(std::process::Stdio::from(xray_stdout))
            .stderr(std::process::Stdio::from(xray_log))
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
        {
            Ok(child) => child,
            Err(e) => {
                let _ = fs::remove_file(&config_path);
                return Err(format!("Не удалось запустить Xray: {e}"));
            }
        };

        // Own Xray with an OS-level job so a force-killed WebView process cannot
        // leave an orphaned VPN process behind. Failure is fatal, not best-effort.
        #[cfg(windows)]
        let child_job = match crate::windows_job::ChildJob::attach(&child) {
            Ok(job) => job,
            Err(error) => {
                stop_failed_tun(&mut child, &config_path).await?;
                return Err(error);
            }
        };

        // Verify the actual configured proxy before trusting public IP changes.
        // An unrelated change of network/WAN IP is not evidence of VPN traffic.
        tokio::time::sleep(Duration::from_millis(750)).await;
        if !matches!(child.try_wait(), Ok(None)) {
            stop_failed_tun(&mut child, &config_path).await?;
            return Err("Xray завершился до установления VPN. Сетевые настройки восстановлены.".into());
        }
        let proof = verify_tunnel_path(baseline_ip, probe_port, &probe_password).await;
        let verified_ip = proof.verified_ip();
        if verified_ip.is_none() {
            // Never keep a system-wide TUN route installed after Xray has
            // failed a real traffic check. The previous app hung the PC here.
            stop_failed_tun(&mut child, &config_path).await?;
            return Err(format!(
                "VPN не подключён ({}). Изменения сети Windows отменены.",
                proof.status()
            ));
        }
        // An Xray process may remain alive even though Windows never installed
        // a usable Wintun route. Treat a *definitely* absent route as startup
        // failure; an unavailable OS inspection remains UNKNOWN, not success.
        let mut routes = crate::tun_health::inspect().await;
        if routes.definitely_missing() {
            tokio::time::sleep(Duration::from_millis(400)).await;
            routes = crate::tun_health::inspect().await;
            if routes.definitely_missing() {
                stop_failed_tun(&mut child, &config_path).await?;
                return Err("Windows не создала рабочий VPN-маршрут. Подключение отменено для восстановления интернета.".into());
            }
        }

        // Even a successful proxy/HTTPS comparison is not enough for a
        // green VPN indicator if the Windows TUN adapter or resolver is not
        // usable. Reuse one conservative health predicate throughout.
        let verified_ip = if crate::tun_health::health_proves_connection(
            &routes,
            crate::tun_health::dns_resolution_check().await,
            matches!(child.try_wait(), Ok(None)),
            verified_ip.is_some(),
        ) {
            verified_ip
        } else {
            None
        };

        if verified_ip.is_none() {
            // DNS, adapter or the effective Windows route remains unhealthy.
            // An Xray process alone is NOT a connection.
            stop_failed_tun(&mut child, &config_path).await?;
            return Err("Трафик через Windows TUN не подтверждён. Подключение отменено для восстановления интернета.".into());
        }

        let server_port = session
            .get("port")
            .and_then(Value::as_u64)
            .filter(|port| (1..=65535).contains(port))
            .unwrap_or(443) as u16;
        // TCP latency measurement is scheduled by vpn_status after connection.
        // Never delay activation to perform another network round trip.
        let ping = 0;
        let started_at = std::time::Instant::now();
        let mut lock = state.tunnel.lock().map_err(|e| e.to_string())?;
        *lock = Some(ActiveTunnel {
            child,
            #[cfg(windows)]
            _job: child_job,
            config_path,
            started_at,
            _node_code: chosen_node,
            server_name: server_name.clone(),
            country: country.clone(),
            server_ip: verified_ip.map(|ip| ip.to_string()).unwrap_or_default(),
            server_host: host.to_string(),
            server_port,
            use_tcp_ping: protocol_supports_tcp_ping(session),
            last_egress_probe: std::time::Instant::now(),
            last_ping_probe: std::time::Instant::now() - Duration::from_secs(50),
            cached_ping_ms: ping,
            baseline_ip,
            egress_verified: verified_ip.is_some(),
            probe_port,
            probe_password,
            last_tunnel_proof: proof,
        });

        Ok(TunnelMetrics {
            connected: true,
            verified: verified_ip.is_some(),
            proof: proof.status().into(),
            connected_seconds: 0,
            download_mbps: 0.0,
            upload_mbps: 0.0,
            ping_ms: ping,
            server_name,
            country,
            ip: verified_ip.map(|ip| ip.to_string()).unwrap_or_default(),
        })
    }
    .await;
    if connection_result.is_err() {
        if let Ok(dir) = app.path().app_data_dir() {
            let _ = fs::remove_file(dir.join("active_tunnel.json"));
        }
        let _ = request(&app, Method::DELETE, "/vpn/session", None, true, false).await;
    }
    connection_result
}

#[tauri::command]
pub async fn vpn_stop(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let _connection_guard = state.connection_gate.lock().await;
    let maybe_active = {
        let mut lock = state.tunnel.lock().map_err(|e| e.to_string())?;
        if let Some(active) = lock.as_mut() {
            let already_stopped = active
                .child
                .try_wait()
                .map_err(|e| format!("Не удалось проверить Xray: {e}"))?
                .is_some();
            if !already_stopped {
                // Do not clear connected state until the OS confirms termination.
                active
                    .child
                    .kill()
                    .map_err(|e| format!("Не удалось остановить VPN-процесс: {e}"))?;
                active
                    .child
                    .wait()
                    .map_err(|e| format!("Не удалось дождаться остановки Xray: {e}"))?;
            }
        }
        lock.take()
    };
    if let Some(active) = maybe_active {
        let _ = fs::remove_file(&active.config_path);
        // Revoke device session even if Windows refuses route cleanup.
        let cleanup = crate::tun_health::cleanup_bymevpn_routes_after_exit().await;
        let _ = request(&app, Method::DELETE, "/vpn/session", None, true, false).await;
        cleanup?;
    } else {
        // Also repair a stale ByMeVPN route from an earlier crashed build.
        crate::tun_health::cleanup_bymevpn_routes_after_exit().await?;
    }
    Ok(())
}

#[tauri::command]
pub async fn vpn_status(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<TunnelMetrics, String> {
    // An old watchdog must never remove routes after a new VPN has begun
    // connecting. Lock in the same order as start/stop.
    let _connection_guard = state.connection_gate.lock().await;
    let _probe_guard = state.status_probe_gate.lock().await;
    let mut revoke_session = false;
    // This is evidence of an actual Xray server path AND the normal Windows
    // TUN path to the SAME HTTPS endpoint. Do not equate a changing WAN IP
    // with VPN connectivity. Keep the lock free during network requests.
    let probe = {
        let lock = state.tunnel.lock().map_err(|e| e.to_string())?;
        lock.as_ref().and_then(|active| {
            (active.last_egress_probe.elapsed() >= Duration::from_secs(20)).then(|| {
                (
                    active.started_at,
                    active.baseline_ip,
                    active.probe_port,
                    active.probe_password.clone(),
                )
            })
        })
    };
    if let Some((started_at, baseline_ip, port, password)) = probe {
        let result = verify_tunnel_path(baseline_ip, port, &password).await;
        let path_ready = if result.verified_ip().is_some() {
            let routes = crate::tun_health::inspect().await;
            crate::tun_health::health_proves_connection(
                &routes,
                crate::tun_health::dns_resolution_check().await,
                true,
                true,
            )
        } else {
            false
        };
        let mut lock = state.tunnel.lock().map_err(|e| e.to_string())?;
        if let Some(active) = lock.as_mut() {
            if active.started_at == started_at {
                active.last_egress_probe = std::time::Instant::now();
                active.last_tunnel_proof = result;
                active.egress_verified = path_ready && result.verified_ip().is_some();
                active.server_ip = if active.egress_verified {
                    result
                        .verified_ip()
                        .map(|ip| ip.to_string())
                        .unwrap_or_default()
                } else {
                    String::new()
                };
                if !active.egress_verified {
                    // If a previously verified VPN stops transferring real
                    // traffic, immediately unblock Windows rather than leave
                    // the default route pointed at a stalled Xray process.
                    let _ = active.child.kill();
                    let _ = active.child.wait();
                    if let Some(active) = lock.take() {
                        let _ = fs::remove_file(active.config_path);
                        revoke_session = true;
                    }
                }
            }
        }
    }
    // Status is polled by the UI and by the native watchdog. A socket ping on
    // every poll wastes CPU and network traffic; refresh it at most every 45s.
    let ping_probe = {
        let lock = state.tunnel.lock().map_err(|e| e.to_string())?;
        lock.as_ref().and_then(|active| {
            (active.use_tcp_ping && active.last_ping_probe.elapsed() >= Duration::from_secs(45))
                .then(|| {
                    (
                        active.started_at,
                        active.server_host.clone(),
                        active.server_port,
                    )
                })
        })
    };
    if let Some((started_at, host, port)) = ping_probe {
        let ping = tokio::task::spawn_blocking(move || measure_real_ping(&host, port))
            .await
            .unwrap_or(0);
        let mut lock = state.tunnel.lock().map_err(|e| e.to_string())?;
        if let Some(active) = lock.as_mut() {
            if active.started_at == started_at {
                active.cached_ping_ms = ping;
                active.last_ping_probe = std::time::Instant::now();
            }
        }
    }
    let active_info = {
        let mut lock = state.tunnel.lock().map_err(|e| e.to_string())?;
        let exited = match lock.as_mut() {
            Some(active) => active
                .child
                .try_wait()
                .map(|status| status.is_some())
                .unwrap_or(true),
            None => false,
        };
        if exited {
            if let Some(active) = lock.take() {
                let _ = fs::remove_file(active.config_path);
                revoke_session = true;
            }
        }
        lock.as_ref().map(|active| {
            (
                active.started_at.elapsed().as_secs(),
                active.server_name.clone(),
                active.country.clone(),
                active.server_ip.clone(),
                active.egress_verified,
                active.cached_ping_ms,
                active.last_tunnel_proof.status().to_string(),
            )
        })
    };
    // A crashed tunnel or an observed routing leak must release its server
    // session as well as its local process and config. Never await HTTP while
    // holding the tunnel Mutex.
    if revoke_session {
        crate::tun_health::cleanup_bymevpn_routes_after_exit().await?;
        let _ = request(&app, Method::DELETE, "/vpn/session", None, true, false).await;
    }
    if let Some((elapsed, server_name, country, ip, verified, ping, proof)) = active_info {
        return Ok(TunnelMetrics {
            connected: true,
            verified,
            proof,
            connected_seconds: elapsed,
            download_mbps: 0.0,
            upload_mbps: 0.0,
            ping_ms: ping,
            server_name,
            country,
            ip,
        });
    }
    Ok(TunnelMetrics {
        connected: false,
        verified: false,
        proof: "disconnected".into(),
        connected_seconds: 0,
        download_mbps: 0.0,
        upload_mbps: 0.0,
        ping_ms: 0,
        server_name: String::new(),
        country: String::new(),
        ip: String::new(),
    })
}

/// Read-only local checks for a user-initiated diagnostics dialog. Never
/// return a subscription URL, a key, an IP address, or the raw Xray log.
#[tauri::command]
pub async fn vpn_health_report(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let (process_tracked, baseline_ip, tunnel_started_at, probe_auth) = {
        let guard = state.tunnel.lock().map_err(|e| e.to_string())?;
        match guard.as_ref() {
            Some(tunnel) => (
                true,
                tunnel.baseline_ip,
                Some(tunnel.started_at),
                Some((tunnel.probe_port, tunnel.probe_password.clone())),
            ),
            None => (false, None, None, None),
        }
    };
    let baseline_known = baseline_ip.is_some();
    let routes = crate::tun_health::inspect().await;
    // A log keyword is not a DNS probe. Check the OS resolver explicitly,
    // and do not run an unrelated network test when the tunnel is stopped.
    let dns_resolution = if process_tracked {
        crate::tun_health::dns_resolution_check().await
    } else {
        None
    };
    // The manual diagnostic cannot claim a tunnel from a changing WAN IP:
    // it must reach the configured Xray outbound via a credentialed loopback
    // proxy, then observe the same exit through Windows' ordinary TUN route.
    let (egress_probe, ip_verified, runtime_healthy) = if let Some((port, password)) = probe_auth {
        let _probe_guard = state.status_probe_gate.lock().await;
        let proof = verify_tunnel_path(baseline_ip, port, &password).await;
        let route_dns_ok = crate::tun_health::health_proves_connection(
            &routes,
            dns_resolution,
            true,
            proof.verified_ip().is_some(),
        );
        let mut lock = state.tunnel.lock().map_err(|e| e.to_string())?;
        let mut verified = false;
        if let Some(tunnel) = lock
            .as_mut()
            .filter(|active| Some(active.started_at) == tunnel_started_at)
        {
            verified = route_dns_ok && matches!(tunnel.child.try_wait(), Ok(None));
            tunnel.last_tunnel_proof = proof;
            tunnel.last_egress_probe = std::time::Instant::now();
            tunnel.egress_verified = verified;
            tunnel.server_ip = if verified {
                proof
                    .verified_ip()
                    .map(|ip| ip.to_string())
                    .unwrap_or_default()
            } else {
                String::new()
            };
        }
        (proof.status(), verified, verified)
    } else {
        ("not_running", false, false)
    };
    let hint = if process_tracked {
        app.path()
            .app_data_dir()
            .ok()
            .map(|path| crate::tun_health::startup_log_hint(&path.join("xray_startup.log")))
            .unwrap_or("unknown")
    } else {
        "unknown"
    };
    Ok(json!({
        "process_tracked": process_tracked,
        "ip_verified": ip_verified,
        "baseline_known": baseline_known,
        "adapter": routes.adapter,
        "ipv4_default": routes.ipv4_default,
        "ipv6_default": routes.ipv6_default,
        "effective_ipv4": routes.effective_ipv4,
        "dns_resolution": dns_resolution,
        "egress_probe": egress_probe,
        "runtime_healthy": runtime_healthy,
        "xray_hint": hint
    }))
}

#[cfg(windows)]
fn startup_value() -> Result<String, String> {
    let exe = std::env::current_exe()
        .map_err(|e| format!("Не удалось определить путь приложения: {e}"))?;
    Ok(format!("\"{}\"", exe.display()))
}

#[tauri::command]
pub fn startup_enabled() -> Result<bool, String> {
    #[cfg(windows)]
    {
        use winreg::{enums::HKEY_CURRENT_USER, RegKey};
        let key = match RegKey::predef(HKEY_CURRENT_USER)
            .open_subkey(r"Software\Microsoft\Windows\CurrentVersion\Run")
        {
            Ok(key) => key,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(false),
            Err(e) => return Err(format!("Не удалось прочитать автозапуск: {e}")),
        };
        let current: String = match key.get_value("ByMeVPN.Desktop") {
            Ok(value) => value,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => String::new(),
            Err(e) => return Err(format!("Не удалось прочитать запись автозапуска: {e}")),
        };
        Ok(current == startup_value()?)
    }
    #[cfg(not(windows))]
    {
        Err("Автозапуск доступен только в Windows.".into())
    }
}

#[tauri::command]
pub fn set_startup(enabled: bool) -> Result<(), String> {
    #[cfg(windows)]
    {
        use winreg::{enums::HKEY_CURRENT_USER, RegKey};
        let (key, _) = RegKey::predef(HKEY_CURRENT_USER)
            .create_subkey(r"Software\Microsoft\Windows\CurrentVersion\Run")
            .map_err(|e| format!("Не удалось открыть автозапуск: {e}"))?;
        let expected = startup_value()?;
        let current: String = match key.get_value("ByMeVPN.Desktop") {
            Ok(value) => value,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => String::new(),
            Err(e) => return Err(format!("Не удалось прочитать запись автозапуска: {e}")),
        };
        if !current.is_empty() && current != expected {
            return Err("Запись автозапуска принадлежит другой копии ByMeVPN.".into());
        }
        if enabled {
            key.set_value("ByMeVPN.Desktop", &expected)
                .map_err(|e| format!("Не удалось включить автозапуск: {e}"))?;
        } else if !current.is_empty() {
            key.delete_value("ByMeVPN.Desktop")
                .map_err(|e| format!("Не удалось выключить автозапуск: {e}"))?;
        }
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = enabled;
        Err("Автозапуск доступен только в Windows.".into())
    }
}

#[tauri::command]
pub fn window_minimize(window: tauri::WebviewWindow) -> Result<(), String> {
    window.minimize().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn window_toggle_maximize(window: tauri::WebviewWindow) -> Result<(), String> {
    if window.is_maximized().map_err(|e| e.to_string())? {
        window.unmaximize().map_err(|e| e.to_string())
    } else {
        window.maximize().map_err(|e| e.to_string())
    }
}

#[tauri::command]
pub fn window_close(window: tauri::WebviewWindow) -> Result<(), String> {
    window.close().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn open_external_url(url: String) -> Result<(), String> {
    let parsed = reqwest::Url::parse(&url).map_err(|_| "Некорректная ссылка.".to_string())?;
    let host = parsed.host_str().unwrap_or_default();
    let is_allowed_host = matches!(
        host,
        "t.me" | "bymevpn-site.duckdns.org" | "bymevpn.duckdns.org"
    ) || host == "yookassa.ru"
        || host.ends_with(".yookassa.ru")
        || host == "yoomoney.ru"
        || host.ends_with(".yoomoney.ru");

    if parsed.scheme() != "https"
        || !is_allowed_host
        || parsed.port().is_some_and(|port| port != 443)
        || !parsed.username().is_empty()
        || parsed.password().is_some()
    {
        return Err(
            "Разрешено открывать только официальные HTTPS-ссылки ByMeVPN, Telegram и оплаты."
                .into(),
        );
    }

    #[cfg(windows)]
    {
        std::process::Command::new("rundll32.exe")
            .args(["url.dll,FileProtocolHandler", parsed.as_str()])
            .spawn()
            .map(|_| ())
            .map_err(|e| format!("Не удалось открыть ссылку в браузере: {e}"))
    }
    #[cfg(not(windows))]
    {
        Err("Открытие внешних ссылок поддерживается в Windows-приложении.".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ping_probe_handles_ipv6_and_skips_udp_only_hysteria() {
        assert_eq!(
            tcp_ping_target("vpn.example.com", 443),
            "vpn.example.com:443"
        );
        assert_eq!(tcp_ping_target("2001:db8::1", 443), "[2001:db8::1]:443");
        assert_eq!(tcp_ping_target("[2001:db8::1]", 443), "[2001:db8::1]:443");
        assert!(protocol_supports_tcp_ping(&json!({"protocol":"vless"})));
        assert!(!protocol_supports_tcp_ping(
            &json!({"protocol":"hysteria2"})
        ));
        assert!(!protocol_supports_tcp_ping(&json!({"protocol":"hy2"})));
        assert!(!protocol_supports_tcp_ping(
            &json!({"protocol":"HYSTERIA2"})
        ));
    }

    #[test]
    fn packaged_runtime_layout_resolves_new_and_legacy_tauri_paths() {
        let root = std::path::Path::new("ByMeVPN-installation");
        let candidates = bundled_runtime_candidates(root);
        assert_eq!(candidates[0], root.join("vendor/runtime/windows-x64"));
        assert_eq!(candidates[1], root.join("_up_/vendor/runtime/windows-x64"));
    }

    #[test]
    fn settings_are_type_safe_and_unsupported_features_cannot_be_enabled() {
        assert!(validate_setting("bypassRu", &json!(true)).is_ok());
        assert!(validate_setting("bypassRu", &json!("true")).is_err());
        assert!(validate_setting("selectedServerCode", &json!("node_de-1")).is_ok());
        assert!(validate_setting("selectedServerCode", &json!("../settings")).is_err());
        assert!(validate_setting("killSwitch", &json!(true)).is_err());
        assert!(validate_setting("stayConnectedInBackground", &json!(true)).is_err());
        assert!(validate_setting("adBlock", &json!("unknown")).is_err());
        assert!(validate_setting("language", &json!("fr")).is_err());
        assert!(validate_setting("language", &json!("system")).is_ok());
        assert_eq!(default_settings()["language"], "system");
        assert!(validate_setting("dnsMode", &json!("adguard")).is_ok());
        assert!(validate_setting("dnsMode", &json!("fake")).is_err());
        assert_eq!(default_settings()["bypassRu"], true);
        assert_eq!(default_settings()["adBlock"], "none");
    }

    #[test]
    fn login_accepts_null_name_and_uses_email_as_display_name() {
        let auth = parse_auth(&json!({"access":"access", "refresh":"refresh", "user":{
            "id":"1", "email":"tester@example.com", "name":null
        }}))
        .unwrap();
        assert_eq!(auth.user.name, "tester");
    }

    #[test]
    fn android_user_id_and_subscription_device_limit_are_supported() {
        let auth = parse_auth(&json!({
            "access":"access", "refresh":"refresh",
            "user":{"user_id":42, "email":"tester@example.com","name":null},
            "subscription":{"status":"active","plan_code":"12m_d5","auto_renew":true}
        }))
        .unwrap();
        assert_eq!(auth.user.id, json!(42));
        let sub = auth.subscription.unwrap();
        assert_eq!(sub.max_devices, 5);
        assert_eq!(sub.auto_renew, Some(true));
        let invalid = normalized_subscription_value(&json!({
            "status":"active", "plan_code":"abc_d999"
        }));
        assert!(invalid.get("max_devices").is_none());
    }

    #[test]
    fn server_device_identity_is_preserved_without_a_raw_hwid_or_install_id() {
        let confirmed = json!({"id":"42","is_current":true,"device_model":"Desktop"});
        let obj = confirmed.as_object().unwrap();
        assert!(device_is_current(obj, "local-install-uuid"));
        let others = json!({"id":"43","is_current":false,"install_id":"local-install-uuid"});
        assert!(!device_is_current(
            others.as_object().unwrap(),
            "local-install-uuid"
        ));
        let legacy = json!({"id":"44","install_id":"local-install-uuid"});
        assert!(device_is_current(
            legacy.as_object().unwrap(),
            "local-install-uuid"
        ));
        let unknown = json!({"id":"45"});
        assert!(!device_is_current(
            unknown.as_object().unwrap(),
            "local-install-uuid"
        ));
    }

    #[test]
    fn v2_catalog_accepts_only_exact_backend_owned_skus_and_device_tiers() {
        let catalog = json!({"payment_enabled":true,"raw_array":[
            {"code":"1m_d2","devices":2,"price_rub":89,"days":30},
            {"code":"12m_d2","devices":2,"price_rub":885,"days":450,"purchase_enabled":false},
            {"code":"3m_d5","devices":5,"price_rub":396,"days":120},
            {"code":"6m_d2","devices":2,"price_rub":552,"days":180},
            {"code":"12m_d2","devices":5,"price_rub":1185,"days":450},
            {"code":"month","devices":2,"price_rub":89,"days":30},
            {"code":"3m_d2","devices":2,"price_rub":0,"days":120}
        ]});
        let found = mobile_catalog_plans(&catalog, 2);
        assert_eq!(found.len(), 2);
        assert_eq!(found[0]["code"], "1m_d2");
        assert_eq!(found[0]["purchase_enabled"], true);
        assert_eq!(found[1]["purchase_enabled"], false);
        assert!(mobile_catalog_plans(&catalog, 10).is_empty());
        assert_eq!(mobile_catalog_plans(&catalog, 5).len(), 1);
    }

    #[test]
    fn checkout_url_policy_rejects_untrusted_redirects_and_http() {
        assert!(payment_url_is_allowed("https://yookassa.ru/checkout/test"));
        assert!(payment_url_is_allowed(
            "https://payments.yookassa.ru/checkout/test"
        ));
        assert!(!payment_url_is_allowed("http://yookassa.ru/checkout"));
        assert!(!payment_url_is_allowed("https://yookassa.ru.attacker.net/"));
        assert!(!payment_url_is_allowed("https://evil@yookassa.ru/"));
        assert!(!payment_url_is_allowed("https://yookassa.ru:8443/checkout"));
    }

    #[test]
    fn missing_explicit_payment_capability_disables_checkout() {
        let catalog = json!({"plans":[{"code":"3m_d5","devices":5,"price_rub":396,"days":120}]});
        let found = mobile_catalog_plans(&catalog, 5);
        assert_eq!(found.len(), 1);
        assert_eq!(found[0]["purchase_enabled"], false);
        assert_eq!(mobile_plan_duration("3m_d5", 5), Some(120));
        assert_eq!(mobile_plan_duration("3m_d2", 5), None);
    }

    #[test]
    fn telegram_legacy_ticket_query_is_percent_encoded() {
        let encoded: String = url::form_urlencoded::byte_serialize(b"ab+c/=token").collect();
        assert_eq!(encoded, "ab%2Bc%2F%3Dtoken");
    }

    #[test]
    fn refresh_only_invalidates_session_for_rejected_credentials() {
        assert!(refresh_status_invalidates_session(StatusCode::UNAUTHORIZED));
        assert!(refresh_status_invalidates_session(StatusCode::FORBIDDEN));
        assert!(!refresh_status_invalidates_session(
            StatusCode::INTERNAL_SERVER_ERROR
        ));
        assert!(!refresh_status_invalidates_session(
            StatusCode::TOO_MANY_REQUESTS
        ));
        assert!(!refresh_status_invalidates_session(StatusCode::BAD_REQUEST));
    }
}
