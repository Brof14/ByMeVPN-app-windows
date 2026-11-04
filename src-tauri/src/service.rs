use crate::api_transport::{send_to_bases, API_BASES};
use crate::egress::verify_egress;
use crate::tun_config::build_tun_config_ext;
use crate::tunnel_runtime::verify_runtime;
use base64::engine::general_purpose::{STANDARD, STANDARD_NO_PAD, URL_SAFE, URL_SAFE_NO_PAD};
use base64::Engine;
use keyring::Entry;
use reqwest::{Client, Method, StatusCode};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{fs, path::PathBuf, sync::Mutex, time::Duration};
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

pub struct ActiveTunnel {
    pub child: std::process::Child,
    pub config_path: PathBuf,
    pub started_at: std::time::Instant,
    pub _node_code: String,
    pub server_name: String,
    pub country: String,
    pub server_ip: String,
    pub server_host: String,
    pub server_port: u16,
    pub last_egress_verified: std::time::Instant,
}

#[derive(Default)]
pub struct AppState {
    pub tunnel: Mutex<Option<ActiveTunnel>>,
    // Serialize connect/disconnect across network requests and Xray startup.
    pub connection_gate: tokio::sync::Mutex<()>,
    // Prevent overlapping watchdog/UI egress checks from racing each other.
    pub status_probe_gate: tokio::sync::Mutex<()>,
    // One Telegram session is allowed to authorize this desktop process at a time.
    pub telegram_ticket: Mutex<Option<String>>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TunnelMetrics {
    pub connected: bool,
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
    // Match the 3x-ui HWID gate used by the mobile app and subscription API.
    // One random installation ID is stable across sign-ins on this machine.
    let mut headers = reqwest::header::HeaderMap::new();
    headers.insert("X-HWID", reqwest::header::HeaderValue::from_str(&install_id(app)?)
        .map_err(|_| "Некорректный идентификатор устройства.")?);
    headers.insert("X-Device-OS", reqwest::header::HeaderValue::from_static("Windows"));
    headers.insert("X-Ver-OS", reqwest::header::HeaderValue::from_static("10+"));
    headers.insert("X-Device-Model", reqwest::header::HeaderValue::from_static("Windows PC"));
    Client::builder()
        .default_headers(headers)
        .user_agent(concat!("ByMeVPN-Windows/", env!("CARGO_PKG_VERSION")))
        .connect_timeout(Duration::from_secs(8))
        .timeout(Duration::from_secs(15))
        .redirect(reqwest::redirect::Policy::none())
        .build()
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
    if read_secret(ACCESS_KEY).is_none() {
        return None;
    }
    let raw = read_secret(PENDING_PAYMENT_KEY)?;
    let pending: Value = serde_json::from_str(&raw).ok()?;
    let code = pending.get("plan_code")?.as_str()?;
    let devices = pending.get("devices")?.as_i64()?;
    let invoice = pending.get("invoice_id")?.as_str()?;
    let url = pending.get("payment_url")?.as_str()?;
    let request_id = pending.get("request_id")?.as_str()?;
    if mobile_plan_duration(code, devices).is_none() ||
        invoice.is_empty() || invoice.len() > 128 ||
        !invoice.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_')) ||
        request_id.is_empty() || request_id.len() > 128 ||
        !request_id.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_')) ||
        !payment_url_is_allowed(url) {
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

fn restore_telegram_session() -> Option<AuthResult> {
    let profile: UserProfile = serde_json::from_str(&read_secret(TELEGRAM_PROFILE_KEY)?).ok()?;
    let subscription: Subscription =
        serde_json::from_str(&read_secret(TELEGRAM_STATUS_KEY)?).ok()?;
    read_secret(TELEGRAM_SUBSCRIPTION_KEY)?;
    Some(AuthResult {
        user: profile,
        subscription: Some(subscription),
    })
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
    .map_err(|_| {
        RefreshError::Unavailable("Не удалось связаться с API для обновления сеанса.".into())
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
    .map_err(|_| {
        "Не удалось связаться с ByMeVPN API. Проверьте подключение и повторите попытку.".to_string()
    })?;
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
    if result.get("max_devices").and_then(Value::as_i64).unwrap_or(0) <= 0 {
        let from_code = result.get("plan_code").and_then(Value::as_str)
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
    let access = value["access"].as_str().or_else(|| value["access_token"].as_str()).unwrap_or("");
    let refresh = value["refresh"].as_str().or_else(|| value["refresh_token"].as_str()).unwrap_or("");
    if let Err(error) = save_secret(REFRESH_KEY, refresh).and_then(|_| save_secret(ACCESS_KEY, access)) {
        clear_secrets();
        return Err(error);
    }
    clear_telegram_session();
    Ok(parsed)
}

fn subscription_contains_servers(raw: &str) -> bool {
    let trimmed = raw.trim();
    if trimmed.starts_with("vless://")
        || trimmed.starts_with("hysteria2://")
        || trimmed.starts_with("hy2://")
    {
        return true;
    }
    let compact: String = trimmed.chars().filter(|c| !c.is_whitespace()).collect();
    [
        STANDARD.decode(&compact),
        STANDARD_NO_PAD.decode(&compact),
        URL_SAFE.decode(&compact),
        URL_SAFE_NO_PAD.decode(&compact),
    ]
    .into_iter()
    .filter_map(Result::ok)
    .any(|bytes| {
        let decoded = String::from_utf8_lossy(&bytes).to_ascii_lowercase();
        decoded.contains("vless://")
            || decoded.contains("hysteria2://")
            || decoded.contains("hy2://")
    })
}

#[tauri::command]
pub async fn telegram_login(
    app: AppHandle,
    subscription_url: String,
    name: Option<String>,
) -> Result<AuthResult, String> {
    let url = Url::parse(subscription_url.trim())
        .map_err(|_| "Ссылка Telegram повреждена. Запросите новую ссылку в боте.".to_string())?;
    if url.scheme() != "https"
        || url.host_str() != Some("bymevpn.duckdns.org")
        || url.port().is_some_and(|port| port != 2096)
        || !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
    {
        return Err("Бот прислал неизвестный адрес подписки. Ссылка отклонена.".into());
    }

    let client = Client::builder()
        .https_only(true)
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(8))
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| format!("Не удалось проверить ссылку Telegram: {e}"))?;
    let response = client
        .get(url.clone())
        .header("User-Agent", "ByMeVPN/Windows")
        .send()
        .await
        .map_err(|_| {
            "Не удалось проверить подписку. Проверьте интернет и запросите вход ещё раз."
                .to_string()
        })?;
    if !response.status().is_success() {
        return Err(format!(
            "Ссылка подписки вернула HTTP {}. Запросите актуальную ссылку в Telegram-боте.",
            response.status().as_u16()
        ));
    }
    let body = response
        .text()
        .await
        .map_err(|_| "Не удалось прочитать ответ подписки.".to_string())?;
    if body.len() > 1_000_000 || !subscription_contains_servers(&body) {
        return Err(
            "По ссылке не найдена действующая конфигурация серверов. Обновите её в Telegram-боте."
                .into(),
        );
    }

    let display_name = name
        .unwrap_or_default()
        .chars()
        .filter(|c| !c.is_control())
        .take(80)
        .collect::<String>()
        .trim()
        .to_string();
    let profile = UserProfile {
        id: json!(install_id(&app)?),
        email: String::new(),
        name: if display_name.is_empty() {
            "Пользователь Telegram".into()
        } else {
            display_name
        },
        is_google: false,
        created_at: None,
    };
    let subscription = Subscription {
        status: "active".into(),
        plan_code: None,
        plan_name: Some("Доступ ByMeVPN из Telegram".into()),
        expires_at: None,
        seconds_remaining: 0,
        trial_available: false,
        max_devices: 0,
        active_devices: 0,
        auto_renew: None,
    };
    let profile_json = serde_json::to_string(&profile).map_err(|e| e.to_string())?;
    let subscription_json = serde_json::to_string(&subscription).map_err(|e| e.to_string())?;
    save_secret(TELEGRAM_PROFILE_KEY, &profile_json)?;
    save_secret(TELEGRAM_STATUS_KEY, &subscription_json)?;
    save_secret(TELEGRAM_SUBSCRIPTION_KEY, url.as_str())?;
    for key in [ACCESS_KEY, REFRESH_KEY] {
        if let Ok(e) = entry(key) {
            let _ = e.delete_credential();
        }
    }
    Ok(AuthResult {
        user: profile,
        subscription: Some(subscription),
    })
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
    state: State<'_, AppState>, session_token: String,
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
        &app, Method::POST, "/auth/telegram/check-session",
        Some(json!({"token": token})), false, false,
    ).await {
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
        let access_token = res.get("access_token").or_else(|| res.get("access"))
            .and_then(Value::as_str).filter(|token| !token.is_empty())
            .ok_or("Telegram не вернул токен доступа.")?;
        let mut user: UserProfile = serde_json::from_value(
            res.get("user").cloned().ok_or("Telegram не вернул профиль пользователя.")?
        ).map_err(|_| "Некорректный профиль Telegram.".to_string())?;
        if user.id.is_null() ||
            user.id.as_str().is_some_and(|id| id.trim().is_empty()) {
            return Err("Telegram не подтвердил ID пользователя.".into());
        }
        if user.name.trim().is_empty() {
            user.name = "Пользователь Telegram".into();
        }
        let subscription: Option<Subscription> = res.get("subscription")
            .and_then(|value| serde_json::from_value(normalized_subscription_value(value)).ok());
        let refresh_token = res.get("refresh_token").or_else(|| res.get("refresh"))
            .and_then(Value::as_str).filter(|token| !token.is_empty())
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
            .and_then(|_| save_secret(ACCESS_KEY, access_token)) {
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
pub async fn auth_logout(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let _connection_guard = state.connection_gate.lock().await;
    // Logout must not leave the privileged VPN running under a different
    // account. Refuse logout if the OS cannot terminate the tunnel.
    {
        let mut lock = state.tunnel.lock().map_err(|e| e.to_string())?;
        if let Some(active) = lock.as_mut() {
            let already_exited = active.child.try_wait()
                .map_err(|e| format!("Не удалось проверить VPN перед выходом: {e}"))?
                .is_some();
            if !already_exited {
                active.child.kill().map_err(|e|
                    format!("Не удалось остановить VPN перед выходом: {e}"))?;
                active.child.wait().map_err(|e|
                    format!("Не удалось дождаться остановки VPN: {e}"))?;
            }
        }
        if let Some(active) = lock.take() {
            let _ = fs::remove_file(active.config_path);
        }
    }
    let _ = request(&app, Method::DELETE, "/vpn/session", None, true, false).await;
    let _ = request(
        &app, Method::POST, "/auth/logout", Some(json!({})), true, false,
    ).await;
    clear_secrets();
    *state.telegram_ticket.lock().map_err(|e| e.to_string())? = None;
    Ok(())
}

fn device_is_current(object: &serde_json::Map<String, Value>, install_id: &str) -> bool {
    object.get("is_current").and_then(Value::as_bool).unwrap_or_else(|| {
        object.get("install_id").and_then(Value::as_str)
            .is_some_and(|id| id == install_id)
    })
}

async fn snapshot(app: &AppHandle) -> Result<Value, String> {
    let me = request(app, Method::GET, "/me", None, true, false).await?;
    // An outage in the subscription panel must not look like invalid login.
    // Unknown is different from "none" and must not trigger a purchase prompt.
    let sub = request(app, Method::GET, "/subscription/status", None, true, false)
        .await.unwrap_or_else(|_| json!({
            "status": "unknown",
            "plan_name": "Не удалось проверить подписку",
            "trial_available": false
        }));
    // Device-management downtime must never break login or session recovery.
    let devices = request(app, Method::GET, "/devices", None, true, false).await.ok();
    let user = me.get("user").unwrap_or(&me).clone();
    let subscription = normalized_subscription_value(sub.get("subscription").unwrap_or(&sub));
    let current_install_id = install_id(app)?;
    let mut device_list = devices.as_ref()
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
    Ok(json!({"user":user,"subscription":subscription,"devices":device_list,
        "devices_supported": devices.is_some()}))
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
    let subscription = serde_json::from_value(normalized_subscription_value(&data["subscription"])).ok();
    Ok(Some(AuthResult { user, subscription }))
}

#[tauri::command]
pub async fn account_snapshot(app: AppHandle) -> Result<Value, String> {
    snapshot(&app).await
}

pub fn measure_real_ping(host: &str, default_port: u16) -> u32 {
    use std::net::{TcpStream, ToSocketAddrs};
    let target = if host.contains(':') && !host.starts_with('[') {
        host.to_string()
    } else {
        format!("{host}:{default_port}")
    };
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
    let servers = data.get("servers").and_then(Value::as_array)
        .ok_or("Сервер не вернул список доступных локаций.")?;
    let mut tasks = Vec::with_capacity(servers.len());
    let mut normalized = Vec::with_capacity(servers.len());
    for server in servers {
        let config = server.get("config").unwrap_or(server);
        let code = server.get("node_code").or_else(|| server.get("code"))
            .and_then(Value::as_str).unwrap_or("");
        if code.is_empty() { continue; }
        let code_upper = server.get("country_code").and_then(Value::as_str)
            .unwrap_or("").to_ascii_uppercase();
        let country_fallback = match code_upper.as_str() {
            "DE" => "Германия", "NL" => "Нидерланды", "US" => "США",
            "FI" => "Финляндия", "SE" => "Швеция", "GB" => "Великобритания",
            _ => "Основной сервер",
        };
        let country_en_fallback = match code_upper.as_str() {
            "DE" => "Germany", "NL" => "Netherlands", "US" => "USA",
            "FI" => "Finland", "SE" => "Sweden", "GB" => "United Kingdom",
            _ => "Main Server",
        };
        let country = server.get("country").and_then(Value::as_str)
            .filter(|v| !v.is_empty() && *v != "Unknown")
            .unwrap_or(country_fallback);
        let country_en = server.get("country_en").and_then(Value::as_str)
            .filter(|v| !v.is_empty())
            .unwrap_or(if country == country_fallback { country_en_fallback } else { country });
        let city = server.get("city").and_then(Value::as_str)
            .filter(|v| *v != "Unknown").unwrap_or("");
        let city_en = server.get("city_en").and_then(Value::as_str)
            .filter(|v| !v.is_empty()).unwrap_or(city);
        let name = server.get("display_name").or_else(|| server.get("name"))
            .or_else(|| server.get("remark")).and_then(Value::as_str)
            .unwrap_or(code);
        let name_en = server.get("display_name_en").or_else(|| server.get("name_en"))
            .and_then(Value::as_str).filter(|v| !v.is_empty())
            .unwrap_or(country_en);
        let flag_fallback = match code_upper.as_str() {
            "DE" => "🇩🇪", "NL" => "🇳🇱", "US" => "🇺🇸",
            "FI" => "🇫🇮", "SE" => "🇸🇪", "GB" => "🇬🇧",
            _ => "🌐"
        };
        let flag = server.get("flag").and_then(Value::as_str)
            .filter(|v| !v.is_empty()).unwrap_or(flag_fallback);
        let host = config.get("server").or_else(|| config.get("endpoint"))
            .and_then(Value::as_str).unwrap_or("").to_string();
        let port = config.get("port").and_then(Value::as_u64).unwrap_or(443);
        let supported = config.get("protocol").and_then(Value::as_str).unwrap_or("vless") == "vless"
            && config.get("security").and_then(Value::as_str).unwrap_or("reality") == "reality"
            && matches!(config.get("network").and_then(Value::as_str).unwrap_or("tcp"), "tcp" | "raw");
        let task = if !host.is_empty() && (1..=65535).contains(&port) {
            Some(tokio::task::spawn_blocking(move || measure_real_ping(&host, port as u16)))
        } else {
            None
        };
        tasks.push(task);
        normalized.push(json!({"code":code, "name":name, "name_en":name_en,
            "country":country, "country_en":country_en, "country_code":code_upper,
            "city":city, "city_en":city_en,
            "flag":flag, "supported":supported, "ping":0}));
    }
    // Concurrent TCP probes; never block the async runtime or measure one by one.
    for (server, task) in normalized.iter_mut().zip(tasks) {
        if let Some(task) = task {
            server["ping"] = json!(task.await.unwrap_or(0));
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
    let checkout_default = catalog.get("payment_enabled")
        .and_then(Value::as_bool).unwrap_or(false);
    let plans = catalog.get("raw_array").or_else(|| catalog.get("plans"))
        .and_then(Value::as_array);
    // Some backends preserve the catalog as a JSON-encoded string.
    let raw = catalog.get("raw").and_then(Value::as_str)
        .and_then(|raw| serde_json::from_str::<Vec<Value>>(raw).ok());
    plans.cloned().or(raw).unwrap_or_default()
        .iter()
        .filter_map(|plan| confirmed_mobile_plan(plan, devices, checkout_default))
        .collect()
}

#[tauri::command]
pub async fn get_plans(app: AppHandle) -> Result<Vec<Value>, String> {
    // Android V2 explicitly scopes pricing to each device tier, and requires auth.
    // Each tier is independent: one unavailable tier should not hide valid offers.
    let tasks: Vec<_> = [2_i64, 5, 10].into_iter().map(|devices| {
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            let path = format!("/mobile/v2/plans?devices={devices}");
            (devices, request(&app, Method::GET, &path, None, true, false).await)
        })
    }).collect();
    let mut confirmed = Vec::new();
    let mut failure = None;
    for task in tasks {
        match task.await {
            Ok((devices, Ok(body))) =>
                confirmed.extend(mobile_catalog_plans(&body, devices)),
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

#[tauri::command]
pub async fn auth_google(
    app: AppHandle,
    id_token: Option<String>,
    _email: Option<String>,
    _name: Option<String>,
) -> Result<AuthResult, String> {
    let token = match id_token {
        Some(t) if !t.trim().is_empty() && t.split('.').count() >= 3 => t,
        _ => {
            return Err("Серверная авторизация через Google отключена в текущей версии (GOOGLE_AUTH_SERVER_VERIFIED = false). Пожалуйста, используйте вход по Email или через Telegram.".into());
        }
    };

    let id = install_id(&app)?;
    let val = request(
        &app,
        Method::POST,
        "/auth/google",
        Some(json!({
            "id_token": token,
            "install_id": id
        })),
        false,
        false,
    )
    .await?;

    let auth = store_auth(val).await?;
    Ok(auth)
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
    serde_json::from_value(normalized_subscription_value(sub)).map_err(|e| format!("Некорректный статус: {e}"))
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
    let submitted_days = days.filter(|days| *days > 0)
        .ok_or("Не загружен срок тарифа.")?;
    let submitted_price = amount_rub.filter(|price| *price > 0)
        .ok_or("Не загружена цена тарифа.")?;
    if submitted_days != canonical_days {
        return Err("Срок тарифа не соответствует проверенному каталогу.".into());
    }
    let request_id = request_id.unwrap_or_else(|| format!("req_{}", Uuid::new_v4().simple()));
    if request_id.len() < 8 || request_id.len() > 128 ||
        !request_id.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_')) {
        return Err("Некорректный идентификатор платежа.".into());
    }

    // Revalidate server-owned price, duration, tier and checkout capability.
    // A stale or tampered desktop UI must never initiate an unknown payment.
    let catalog = request(&app, Method::GET,
        &format!("/mobile/v2/plans?devices={dev}"), None, true, false).await?;
    let matching = mobile_catalog_plans(&catalog, dev).into_iter()
        .find(|p| p.get("code").and_then(Value::as_str) == Some(plan_code.as_str()));
    let plan = matching.ok_or(
        "Выбранный тариф больше не доступен. Обновите список тарифов."
    )?;
    if plan.get("price_rub").and_then(Value::as_i64) != Some(submitted_price) ||
        plan.get("days").and_then(Value::as_i64) != Some(submitted_days) {
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
    ).await?;
    let invoice = result.get("invoice_id").and_then(Value::as_str)
        .ok_or("Сервер оплаты не вернул идентификатор счёта.")?;
    if invoice.is_empty() || invoice.len() > 128 ||
        !invoice.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_')) {
        return Err("Сервер оплаты вернул некорректный номер счёта.".into());
    }
    let payment_url = result.get("payment_url").or_else(|| result.get("confirmation_url"))
        .and_then(Value::as_str).ok_or("Сервер не вернул ссылку на оплату.")?;
    if !payment_url_is_allowed(payment_url) {
        return Err("Ссылка оплаты не принадлежит проверенному провайдеру.".into());
    }
    if result.get("provider").and_then(Value::as_str)
        .is_some_and(|provider| provider != "yookassa") {
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
    let Ok(parsed) = Url::parse(url) else { return false; };
    let host = parsed.host_str().unwrap_or_default();
    parsed.scheme() == "https" &&
    (host == "yookassa.ru" || host.ends_with(".yookassa.ru") ||
        host == "yoomoney.ru" || host.ends_with(".yoomoney.ru")) &&
    parsed.port().is_none_or(|port| port == 443) &&
    parsed.username().is_empty() && parsed.password().is_none()
}

/// Query invoice-specific fulfillment; an active prior subscription does not
/// prove that this invoice was paid.
#[tauri::command]
pub async fn check_payment(app: AppHandle, invoice_id: String) -> Result<Value, String> {
    if invoice_id.is_empty() || invoice_id.len() > 128 ||
        !invoice_id.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_')) {
        return Err("Некорректный номер счёта.".into());
    }
    let result = request(
        &app, Method::GET,
        &format!("/mobile/v2/payment/check?invoice_id={invoice_id}&provider=yookassa"),
        None, true, false,
    ).await?;
    let paid = matches!(result.get("status").and_then(Value::as_str),
        Some("succeeded" | "paid" | "completed")) &&
        result.get("is_active").and_then(Value::as_bool) == Some(true);
    let failed = matches!(result.get("status").and_then(Value::as_str),
        Some("failed" | "canceled" | "cancelled" | "expired"));
    if (paid || failed) && get_pending_payment().as_ref()
        .and_then(|p| p.get("invoice_id")).and_then(Value::as_str) == Some(invoice_id.as_str()) {
        clear_pending_payment();
    }
    Ok(result)
}

#[tauri::command]
pub async fn delete_account(app: AppHandle) -> Result<(), String> {
    let _ = request(&app, Method::DELETE, "/me", None, true, false).await?;
    clear_secrets();
    Ok(())
}

pub fn get_runtime_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let mut candidates = Vec::new();
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            candidates.push(parent.join("vendor/runtime/windows-x64"));
            candidates.push(parent.join("runtime/windows-x64"));
            candidates.push(parent.join("vendor/runtime"));
            candidates.push(parent.to_path_buf());
        }
    }
    candidates.push(PathBuf::from("vendor/runtime/windows-x64"));
    candidates.push(PathBuf::from("../vendor/runtime/windows-x64"));
    if let Ok(res) = app.path().resource_dir() {
        candidates.push(res.join("vendor/runtime/windows-x64"));
        candidates.push(res.join("runtime/windows-x64"));
        candidates.push(res.join("vendor/runtime"));
        candidates.push(res.clone());
    }

    for dir in candidates {
        if dir.exists() && dir.join("xray.exe").exists() {
            if verify_runtime(&dir).is_ok() {
                return Ok(dir);
            }
        }
    }
    Err("Не найден проверенный компонент Xray (xray.exe / wintun.dll).".into())
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
        "language": "ru",
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
            if !matches!(value.as_str(), Some("ru" | "en")) {
                return Err("Приложение поддерживает языки RU и EN.".into());
            }
        }
        "selectedServerCode" => {
            let code = value.as_str().ok_or("Некорректный код сервера.")?;
            if code.is_empty() || code.len() > 128 ||
                !code.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-')) {
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
        .await.map_err(|e| format!("Не удалось проверить подписку. Подключение не начато: {e}"))?;
    let subscription = sub_status.get("subscription").unwrap_or(&sub_status);
    let status = subscription.get("status").and_then(Value::as_str).unwrap_or("unknown");
    if status == "unknown" {
        return Err("Статус подписки пока неизвестен. Повторите проверку при доступной сети.".into());
    }
    if !matches!(status, "active" | "trial" | "grace") {
        return Err("Для подключения требуется активная подписка ByMeVPN. Активируйте пробный доступ или выберите тариф.".into());
    }

    let runtime_dir = get_runtime_dir(&app)?;

    let settings = load_settings(&app);
    let bypass_ru = settings.get("bypassRu").and_then(Value::as_bool).unwrap_or(true);
    let ad_block = settings.get("adBlock").and_then(Value::as_str).unwrap_or("none");
    let dns_mode = settings.get("dnsMode").and_then(Value::as_str).unwrap_or("cloudflare");

    let chosen_node = node_code.unwrap_or_else(|| "auto".to_string());
    let id = install_id(&app)?;

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

    let session = session_val.get("session").unwrap_or(&session_val);
    let host = session.get("server").and_then(Value::as_str)
        .ok_or("Сервер не вернул адрес VPN.")?;
    let server_name = session.get("display_name").or_else(|| session.get("name"))
        .and_then(Value::as_str).unwrap_or(host).to_string();
    let country = session.get("country").and_then(Value::as_str).unwrap_or("").to_string();
    // Baseline is observed before installing the route. Server inbound and
    // public egress IP often differ (NAT, reverse proxies, relay topology).
    let baseline_ip = crate::egress::public_egress_ip().await
        .map_err(|e| format!("Не удалось безопасно проверить исходный маршрут: {e}"))?;

    let xray_config = build_tun_config_ext(session, bypass_ru, ad_block, dns_mode)?;

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

    let test_res = std::process::Command::new(runtime_dir.join("xray.exe"))
        .current_dir(&runtime_dir)
        .env("XRAY_LOCATION_ASSET", &runtime_dir)
        .args(["run", "-test", "-config"])
        .arg(&config_path)
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|e| format!("Не удалось проверить конфигурацию Xray: {e}"))?;

    if !test_res.status.success() {
        let _ = fs::remove_file(&config_path);
        // Xray emits actionable parser/config diagnostics on stderr.
        let cause = String::from_utf8_lossy(&test_res.stderr);
        let detail: String = cause.trim().chars().take(500).collect();
        return Err(if detail.is_empty() {
            format!("Конфигурация Xray отклонена (код {:?}).", test_res.status.code())
        } else {
            format!("Ошибка конфигурации Xray: {detail}")
        });
    }

    let mut child = match std::process::Command::new(runtime_dir.join("xray.exe"))
        .current_dir(&runtime_dir)
        .env("XRAY_LOCATION_ASSET", &runtime_dir)
        .args(["run", "-config"])
        .arg(&config_path)
        .creation_flags(CREATE_NO_WINDOW)
        .spawn() {
            Ok(child) => child,
            Err(e) => {
                let _ = fs::remove_file(&config_path);
                return Err(format!("Не удалось запустить Xray: {e}"));
            }
        };

    let mut verified_ip = None;
    let mut last_error = "Проверка VPN не завершилась.".to_string();
    for _ in 0..3 {
        tokio::time::sleep(Duration::from_millis(750)).await;
        match child.try_wait() {
            Ok(Some(_)) => {
                last_error = "Xray завершился до установления туннеля.".into();
                break;
            }
            Err(_) => {
                last_error = "Не удалось проверить процесс Xray.".into();
                break;
            }
            Ok(None) => {}
        }
        match verify_egress(baseline_ip).await {
            Ok(ip) => {
                verified_ip = Some(ip);
                break;
            }
            Err(message) => last_error = message,
        }
    }
    if verified_ip.is_none() {
        let _ = child.kill();
        let _ = child.wait();
        let _ = fs::remove_file(&config_path);
        let _ = request(&app, Method::DELETE, "/vpn/session", None, true, false).await;
        return Err(format!("VPN не подтверждён: {last_error}"));
    }

    let server_port = session.get("port").and_then(Value::as_u64)
        .filter(|port| (1..=65535).contains(port)).unwrap_or(443) as u16;
    let ping = tokio::task::spawn_blocking({
        let host = host.to_string();
        move || measure_real_ping(&host, server_port)
    }).await.unwrap_or(0);

    let started_at = std::time::Instant::now();
    let mut lock = state.tunnel.lock().map_err(|e| e.to_string())?;
    *lock = Some(ActiveTunnel {
        child,
        config_path,
        started_at,
        _node_code: chosen_node,
        server_name: server_name.clone(),
        country: country.clone(),
        server_ip: verified_ip.expect("verified before storing").to_string(),
        server_host: host.to_string(),
        server_port,
        last_egress_verified: std::time::Instant::now(),
    });

    Ok(TunnelMetrics {
        connected: true,
        connected_seconds: 0,
        download_mbps: 0.0,
        upload_mbps: 0.0,
        ping_ms: ping,
        server_name,
        country,
        ip: verified_ip.expect("verified before publishing").to_string(),
    })
}

#[tauri::command]
pub async fn vpn_stop(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let _connection_guard = state.connection_gate.lock().await;
    let maybe_active = {
        let mut lock = state.tunnel.lock().map_err(|e| e.to_string())?;
        if let Some(active) = lock.as_mut() {
            let already_stopped = active.child.try_wait()
                .map_err(|e| format!("Не удалось проверить Xray: {e}"))?.is_some();
            if !already_stopped {
                // Do not clear connected state until the OS confirms termination.
                active.child.kill().map_err(|e|
                    format!("Не удалось остановить VPN-процесс: {e}"))?;
                active.child.wait().map_err(|e|
                    format!("Не удалось дождаться остановки Xray: {e}"))?;
            }
        }
        lock.take()
    };
    if let Some(active) = maybe_active {
        let _ = fs::remove_file(&active.config_path);
        let _ = request(&app, Method::DELETE, "/vpn/session", None, true, false).await;
    }
    // Idempotent even if the tunnel was already stopped or crashed.
    Ok(())
}

#[tauri::command]
pub async fn vpn_status(state: State<'_, AppState>) -> Result<TunnelMetrics, String> {
    let _probe_guard = state.status_probe_gate.lock().await;
    // Process liveness is not network liveness. Recheck the same public exit
    // address periodically, and remove a tunnel if route/egress changed.
    // The poll runs outside the native tunnel lock to keep disconnect responsive.
    let probe = {
        let lock = state.tunnel.lock().map_err(|e| e.to_string())?;
        lock.as_ref().and_then(|active| {
            (active.last_egress_verified.elapsed() >= Duration::from_secs(20))
                .then(|| (active.started_at, active.server_ip.clone()))
        })
    };
    if let Some((started_at, expected_ip)) = probe {
        let result = tokio::time::timeout(
            Duration::from_secs(9), crate::egress::public_egress_ip(),
        ).await;
        let observed_ok = matches!(result, Ok(Ok(ref ip)) if ip.to_string() == expected_ip);
        let mut lock = state.tunnel.lock().map_err(|e| e.to_string())?;
        if let Some(active) = lock.as_mut() {
            if active.started_at == started_at {
                if observed_ok {
                    active.last_egress_verified = std::time::Instant::now();
                } else {
                    // Fail closed in the UI. Xray termination owns TUN cleanup.
                    // This does NOT replace a genuine kernel WFP Kill Switch.
                    let _ = active.child.kill();
                    let _ = active.child.wait();
                    if let Some(active) = lock.take() {
                        let _ = fs::remove_file(active.config_path);
                    }
                }
            }
        }
    }
    let active_info = {
        let mut lock = state.tunnel.lock().map_err(|e| e.to_string())?;
        let exited = match lock.as_mut() {
            Some(active) => active.child.try_wait().map(|status| status.is_some()).unwrap_or(true),
            None => false,
        };
        if exited {
            if let Some(active) = lock.take() {
                let _ = fs::remove_file(active.config_path);
            }
        }
        lock.as_ref().map(|active| (
            active.started_at.elapsed().as_secs(),
            active.server_name.clone(),
            active.country.clone(),
            active.server_ip.clone(),
            active.server_host.clone(),
            active.server_port
        ))
    };
    if let Some((elapsed, server_name, country, ip, host, port)) = active_info {
        let ping = tokio::task::spawn_blocking(move || measure_real_ping(&host, port))
            .await.unwrap_or(0);
        return Ok(TunnelMetrics {
            connected: true, connected_seconds: elapsed,
            download_mbps: 0.0, upload_mbps: 0.0,
            ping_ms: ping, server_name, country, ip
        });
    }
    Ok(TunnelMetrics {
        connected: false, connected_seconds: 0,
        download_mbps: 0.0, upload_mbps: 0.0,
        ping_ms: 0, server_name: String::new(),
        country: String::new(), ip: String::new()
    })
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
    let is_allowed_host = matches!(host, "t.me" | "bymevpn-site.duckdns.org" | "bymevpn.duckdns.org")
        || host == "yookassa.ru"
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
            "Разрешено открывать только официальные HTTPS-ссылки ByMeVPN, Telegram и оплаты.".into(),
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
    fn settings_are_type_safe_and_unsupported_features_cannot_be_enabled() {
        assert!(validate_setting("bypassRu", &json!(true)).is_ok());
        assert!(validate_setting("bypassRu", &json!("true")).is_err());
        assert!(validate_setting("selectedServerCode", &json!("node_de-1")).is_ok());
        assert!(validate_setting("selectedServerCode", &json!("../settings")).is_err());
        assert!(validate_setting("killSwitch", &json!(true)).is_err());
        assert!(validate_setting("stayConnectedInBackground", &json!(true)).is_err());
        assert!(validate_setting("adBlock", &json!("unknown")).is_err());
        assert!(validate_setting("language", &json!("fr")).is_err());
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
        })).unwrap();
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
        assert!(!device_is_current(others.as_object().unwrap(), "local-install-uuid"));
        let legacy = json!({"id":"44","install_id":"local-install-uuid"});
        assert!(device_is_current(legacy.as_object().unwrap(), "local-install-uuid"));
        let unknown = json!({"id":"45"});
        assert!(!device_is_current(unknown.as_object().unwrap(), "local-install-uuid"));
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
        assert!(payment_url_is_allowed("https://payments.yookassa.ru/checkout/test"));
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
