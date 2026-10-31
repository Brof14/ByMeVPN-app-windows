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
const TELEGRAM_PROFILE_KEY: &str = "telegram_profile";
const TELEGRAM_STATUS_KEY: &str = "telegram_subscription_status";
const TELEGRAM_SUBSCRIPTION_KEY: &str = "telegram_subscription_url";
static REFRESH_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

pub struct ActiveTunnel {
    pub child: std::process::Child,
    pub config_path: PathBuf,
    pub started_at: std::time::Instant,
    pub _node_code: String,
    pub server_name: String,
    pub country: String,
    pub server_ip: String,
}

#[derive(Default)]
pub struct AppState {
    pub tunnel: Mutex<Option<ActiveTunnel>>,
    // Serialize connect/disconnect across network requests and Xray startup.
    pub connection_gate: tokio::sync::Mutex<()>,
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
    #[serde(default)]
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
        TELEGRAM_PROFILE_KEY,
        TELEGRAM_STATUS_KEY,
        TELEGRAM_SUBSCRIPTION_KEY,
    ] {
        if let Ok(e) = entry(key) {
            let _ = e.delete_credential();
        }
    }
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
    save_secret(ACCESS_KEY, access).map_err(RefreshError::Unavailable)?;
    if !next_refresh.is_empty() {
        save_secret(REFRESH_KEY, next_refresh).map_err(RefreshError::Unavailable)?;
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
            .and_then(|v| serde_json::from_value(v.clone()).ok()),
    })
}

async fn store_auth(value: Value) -> Result<AuthResult, String> {
    let parsed = parse_auth(&value)?;
    save_secret(
        ACCESS_KEY,
        value["access"]
            .as_str()
            .or_else(|| value["access_token"].as_str())
            .unwrap_or(""),
    )?;
    save_secret(
        REFRESH_KEY,
        value["refresh"]
            .as_str()
            .or_else(|| value["refresh_token"].as_str())
            .unwrap_or(""),
    )?;
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
pub async fn telegram_create_session(app: AppHandle) -> Result<TelegramSessionInit, String> {
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
    Ok(TelegramSessionInit {
        session_token: token.to_string(),
        bot_url: bot_url.to_string(),
    })
}

#[tauri::command]
pub async fn telegram_check_session(
    app: AppHandle,
    session_token: String,
) -> Result<TelegramCheckResult, String> {
    let token = session_token.trim();
    if token.len() > 256 || token.is_empty() {
        return Err("Некорректный токен Telegram.".into());
    }
    // Avoid exposing one-time session tickets in URL/proxy access logs.
    let res = request(
        &app, Method::POST, "/auth/telegram/check-session",
        Some(json!({"token": token})), false, false,
    ).await?;
    let status = res
        .get("status")
        .and_then(Value::as_str)
        .unwrap_or("pending");
    if status == "authenticated" || status == "approved" || status == "success" {
        if let Some(access_token) = res.get("access_token").and_then(Value::as_str) {
            save_secret(ACCESS_KEY, access_token)?;
            if let Some(refresh_token) = res.get("refresh_token").and_then(Value::as_str) {
                save_secret(REFRESH_KEY, refresh_token)?;
            } else if let Ok(entry) = entry(REFRESH_KEY) {
                // Telegram currently issues access-only credentials; never retain a
                // refresh token belonging to the previous account.
                let _ = entry.delete_credential();
            }
            clear_telegram_session();
            let mut user: UserProfile = res
                .get("user")
                .and_then(|u| serde_json::from_value(u.clone()).ok())
                .unwrap_or(UserProfile {
                    id: json!("tg_user"),
                    email: String::new(),
                    name: "Пользователь Telegram".into(),
                    is_google: false,
                    created_at: None,
                });
            if user.name.trim().is_empty() {
                user.name = "Пользователь Telegram".into();
            }
            let subscription: Option<Subscription> = res
                .get("subscription")
                .and_then(|s| serde_json::from_value(s.clone()).ok());
            return Ok(TelegramCheckResult {
                status: "approved".into(),
                auth: Some(AuthResult { user, subscription }),
            });
        }
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
pub async fn auth_logout(app: AppHandle) -> Result<(), String> {
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
    Ok(())
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
    let subscription = sub.get("subscription").unwrap_or(&sub).clone();
    let current_install_id = install_id(app)?;
    let mut device_list = devices.as_ref()
        .and_then(|response| response.get("devices"))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    for device in &mut device_list {
        if let Some(object) = device.as_object_mut() {
            let is_current = object
                .get("install_id")
                .and_then(Value::as_str)
                .is_some_and(|id| id == current_install_id);
            object.insert("is_current".into(), json!(is_current));
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
    let subscription = serde_json::from_value(data["subscription"].clone()).ok();
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
        let name = server.get("display_name").or_else(|| server.get("name"))
            .or_else(|| server.get("remark")).and_then(Value::as_str).unwrap_or(code);
        let country = server.get("country_code").or_else(|| server.get("country"))
            .and_then(Value::as_str).unwrap_or("");
        let flag = server.get("flag").and_then(Value::as_str).unwrap_or("🌐");
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
        normalized.push(json!({"code":code, "name":name, "country":country,
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

#[tauri::command]
pub async fn get_plans(app: AppHandle) -> Result<Vec<Value>, String> {
    let data = request(&app, Method::GET, "/plans", None, false, false).await?;
    if let Some(v) = data.as_array() {
        return Ok(v.clone());
    }
    if let Some(v) = data.get("plans").and_then(Value::as_array) {
        return Ok(v.clone());
    }
    if let Some(raw) = data.get("raw_array").and_then(Value::as_array) {
        return Ok(raw.clone());
    }
    Err("Сервер вернул тарифы в неизвестном формате.".into())
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
    serde_json::from_value(sub.clone()).map_err(|e| format!("Некорректный статус: {e}"))
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
    let id = install_id(&app)?;
    let dev = devices.unwrap_or(2);
    if !matches!(dev, 2 | 5 | 10) {
        return Err("Недопустимое количество устройств.".into());
    }
    // The UI only submits values received from GET /plans. The API verifies
    // them again; never fall back to historical hard-coded prices or durations.
    let final_days = days.filter(|d| *d > 0).ok_or("Не загружен срок тарифа.")?;
    let final_amount = amount_rub.filter(|a| *a > 0).ok_or("Не загружена цена тарифа.")?;
    let request_id = request_id.unwrap_or_else(|| format!("req_{}", Uuid::new_v4().simple()));
    if request_id.len() < 8 || request_id.len() > 128 ||
        !request_id.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_')) {
        return Err("Некорректный идентификатор платежа.".into());
    }

    request(
        &app,
        Method::POST,
        "/payment/create",
        Some(json!({
            "plan_code": plan_code,
            "amount_rub": final_amount,
            "days": final_days,
            "devices": dev,
            "provider": "yookassa",
            "request_id": request_id,
            "install_id": id
        })),
        true,
        false,
    )
    .await
}

/// Check only a payment invoice owned by the signed-in user.
/// The server verifies webhook fulfillment before reporting success.
#[tauri::command]
pub async fn check_payment(app: AppHandle, invoice_id: String) -> Result<Value, String> {
    if invoice_id.is_empty() || invoice_id.len() > 128 ||
        !invoice_id.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_')) {
        return Err("Некорректный номер счёта.".into());
    }
    request(
        &app, Method::GET, &format!("/payment/check?invoice_id={invoice_id}&provider=yookassa"),
        None, true, false,
    ).await
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

pub fn load_settings(app: &AppHandle) -> Value {
    let dir = app.path().app_data_dir().unwrap_or_else(|_| PathBuf::from("."));
    let path = dir.join("settings.json");
    fs::read(&path)
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_else(|| json!({
            "autoStart": false,
            "stayConnectedInBackground": false,
            "bypassRu": true,
            "adBlock": "recommended",
            "killSwitch": false,
            "language": "ru"
        }))
}

#[tauri::command]
pub fn get_settings(app: AppHandle) -> Value {
    load_settings(&app)
}

#[tauri::command]
pub async fn save_setting(app: AppHandle, key: String, value: Value) -> Result<(), String> {
    let allowed = [
        "autoStart",
        "autoConnect",
        "selectedServerCode",
        "stayConnectedInBackground",
        "bypassRu",
        "adBlock",
        "killSwitch",
        "language",
    ];
    if !allowed.contains(&key.as_str()) {
        return Err("Неизвестная настройка.".into());
    }
    if matches!(key.as_str(), "stayConnectedInBackground" | "killSwitch") && value == Value::Bool(true) {
        return Err("Эта функция недоступна, пока не пройдёт проверку безопасности.".into());
    }
    if key == "selectedServerCode" {
        let code = value.as_str().ok_or("Неверный код сервера.")?;
        if code.len() > 128 || code.is_empty() ||
            !code.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-')) {
            return Err("Неверный код сервера.".into());
        }
    }
    let dir: PathBuf = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join("settings.json");
    let mut settings = load_settings(&app);
    settings[&key] = value;
    fs::write(
        path,
        serde_json::to_vec_pretty(&settings).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())
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
    let sub_status = request(&app, Method::GET, "/subscription/status", None, true, false).await;
    let has_active_sub = match sub_status {
        Ok(ref d) => {
            let subscription = d.get("subscription").unwrap_or(d);
            let status = subscription.get("status").and_then(Value::as_str).unwrap_or("none");
            matches!(status, "active" | "trial" | "grace")
        }
        Err(_) => false,
    };

    if !has_active_sub {
        return Err("Для подключения требуется активная подписка ByMeVPN. Активируйте 3 дня бесплатного доступа или выберите тариф.".into());
    }

    let runtime_dir = get_runtime_dir(&app)?;

    let settings = load_settings(&app);
    let bypass_ru = settings.get("bypassRu").and_then(Value::as_bool).unwrap_or(true);
    let ad_block = settings.get("adBlock").and_then(Value::as_str).unwrap_or("recommended");

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

    let xray_config = build_tun_config_ext(session, bypass_ru, ad_block)?;

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

    let ping = tokio::task::spawn_blocking({
        let host = host.to_string();
        move || measure_real_ping(&host, 443)
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
        lock.take()
    };
    if let Some(mut active) = maybe_active {
        let _ = active.child.kill();
        let _ = active.child.wait();
        let _ = fs::remove_file(&active.config_path);
        let _ = request(&app, Method::DELETE, "/vpn/session", None, true, false).await;
        Ok(())
    } else {
        Err("Активный туннель не найден.".into())
    }
}

#[tauri::command]
pub async fn vpn_status(state: State<'_, AppState>) -> Result<TunnelMetrics, String> {
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
            active.server_ip.clone()
        ))
    };
    if let Some((elapsed, server_name, country, ip)) = active_info {
        let ping_ip = ip.clone();
        let ping = tokio::task::spawn_blocking(move || measure_real_ping(&ping_ip, 443))
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
    fn login_accepts_null_name_and_uses_email_as_display_name() {
        let auth = parse_auth(&json!({"access":"access", "refresh":"refresh", "user":{
            "id":"1", "email":"tester@example.com", "name":null
        }}))
        .unwrap();
        assert_eq!(auth.user.name, "tester");
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
