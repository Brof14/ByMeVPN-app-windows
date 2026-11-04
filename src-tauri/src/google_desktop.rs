//! Native Windows OpenID Connect using Google's Desktop OAuth client.
//! Tokens never enter the WebView. Login uses system browser + loopback PKCE,
//! then passes only the ID token and server-issued nonce to ByMeVPN backend.

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use reqwest::Client;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use url::Url;
use uuid::Uuid;

const CALLBACK_PATH: &str = "/oauth2/callback";
const AUTH_TIMEOUT: Duration = Duration::from_secs(180);

fn valid_client_id(id: &str) -> bool {
    id.len() <= 200
        && id.ends_with(".apps.googleusercontent.com")
        && id.bytes().all(|c| c.is_ascii_alphanumeric() || matches!(c, b'-' | b'_' | b'.'))
}

fn random_verifier() -> String {
    format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple())
}

fn pkce_challenge(verifier: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}

fn oauth_url(client_id: &str, redirect: &str, nonce: &str, state: &str, challenge: &str) -> Url {
    let mut url = Url::parse("https://accounts.google.com/o/oauth2/v2/auth").expect("static URL");
    url.query_pairs_mut()
        .append_pair("client_id", client_id)
        .append_pair("redirect_uri", redirect)
        .append_pair("response_type", "code")
        .append_pair("scope", "openid email profile")
        .append_pair("code_challenge", challenge)
        .append_pair("code_challenge_method", "S256")
        .append_pair("state", state)
        .append_pair("nonce", nonce)
        .append_pair("prompt", "select_account");
    url
}

#[cfg(windows)]
fn open_google_in_system_browser(url: &Url) -> Result<(), String> {
    if url.scheme() != "https" || url.host_str() != Some("accounts.google.com")
        || url.path() != "/o/oauth2/v2/auth"
    {
        return Err("Некорректный адрес Google OAuth.".into());
    }
    std::process::Command::new("rundll32.exe")
        .args(["url.dll,FileProtocolHandler", url.as_str()])
        .spawn()
        .map(|_| ())
        .map_err(|_| "Не удалось открыть браузер для входа через Google.".into())
}

#[cfg(not(windows))]
fn open_google_in_system_browser(_url: &Url) -> Result<(), String> {
    Err("Вход Google через браузер поддерживается в Windows-сборке.".into())
}

#[derive(Debug, PartialEq, Eq)]
enum Callback {
    Ignore,
    Code(String),
    Denied,
}

fn parse_callback(first_line: &str, expected_state: &str) -> Callback {
    let mut parts = first_line.split_whitespace();
    if parts.next() != Some("GET") {
        return Callback::Ignore;
    }
    let Some(target) = parts.next() else { return Callback::Ignore; };
    if parts.next() != Some("HTTP/1.1") || parts.next().is_some() || target.len() > 4096
        || !target.starts_with('/')
    {
        return Callback::Ignore;
    }
    let Ok(uri) = Url::parse(&format!("http://127.0.0.1{target}")) else {
        return Callback::Ignore;
    };
    if uri.path() != CALLBACK_PATH || uri.host_str() != Some("127.0.0.1") {
        return Callback::Ignore;
    }
    let state_values: Vec<String> = uri.query_pairs()
        .filter(|(name, _)| name == "state").map(|(_, value)| value.into_owned()).collect();
    if state_values.len() != 1 || state_values[0] != expected_state {
        return Callback::Ignore;
    }
    if uri.query_pairs().any(|(name, _)| name == "error") {
        return Callback::Denied;
    }
    let codes: Vec<String> = uri.query_pairs()
        .filter(|(name, _)| name == "code").map(|(_, value)| value.into_owned()).collect();
    if codes.len() != 1 || codes[0].is_empty() || codes[0].len() > 2048 {
        return Callback::Ignore;
    }
    Callback::Code(codes[0].clone())
}

async fn respond(stream: &mut TcpStream, ok: bool) {
    let body = if ok {
        "ByMeVPN: Google authorization received. Return to the app to finish sign-in."
    } else {
        "ByMeVPN: this request was not accepted."
    };
    let status = if ok { "200 OK" } else { "400 Bad Request" };
    let response = format!(
        "HTTP/1.1 {status}\r\nContent-Type: text/plain; charset=utf-8\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nConnection: close\r\nContent-Length: {}\r\n\r\n{body}",
        body.len()
    );
    let _ = stream.write_all(response.as_bytes()).await;
    let _ = stream.shutdown().await;
}

async fn wait_for_callback(listener: TcpListener, expected_state: &str) -> Result<String, String> {
    let deadline = tokio::time::Instant::now() + AUTH_TIMEOUT;
    for _ in 0..12 {
        let (mut stream, peer) = tokio::time::timeout_at(deadline, listener.accept())
            .await
            .map_err(|_| "Время входа через Google истекло. Попробуйте ещё раз.".to_string())?
            .map_err(|_| "Не удалось получить ответ браузера Google.".to_string())?;
        if !peer.ip().is_loopback() {
            respond(&mut stream, false).await;
            continue;
        }
        let mut bytes = Vec::with_capacity(1024);
        let mut buf = [0u8; 1024];
        while bytes.len() < 8192 && !bytes.windows(4).any(|w| w == b"\r\n\r\n") {
            let read = match tokio::time::timeout(Duration::from_secs(3), stream.read(&mut buf)).await {
                Ok(Ok(n)) if n > 0 => n,
                _ => break,
            };
            bytes.extend_from_slice(&buf[..read]);
        }
        // Only accept a well-formed HTTP/1.1 browser callback with one state.
        let headers = String::from_utf8_lossy(&bytes);
        let host = format!("Host: 127.0.0.1:{}", listener.local_addr().map(|a| a.port()).unwrap_or(0));
        if !headers.contains("\r\n\r\n")
            || !headers.lines().any(|l| l.eq_ignore_ascii_case(&host))
        {
            respond(&mut stream, false).await;
            continue;
        }
        let result = parse_callback(headers.lines().next().unwrap_or(""), expected_state);
        respond(&mut stream, matches!(result, Callback::Code(_))).await;
        match result {
            Callback::Code(code) => return Ok(code),
            Callback::Denied => return Err("Вход через Google отменён.".into()),
            Callback::Ignore => {}
        }
    }
    Err("Не удалось подтвердить ответ Google. Повторите вход.".into())
}

// Google returns structured OAuth error codes. Never display its arbitrary
// error_description: it may contain sensitive identifiers or user data.
fn token_exchange_error(status: reqwest::StatusCode, response: &Value) -> String {
    match response.get("error").and_then(Value::as_str).unwrap_or("") {
        "invalid_client" => "Google отклонил Desktop OAuth Client ID (invalid_client). Проверьте, что в Google Cloud выбран клиент типа Desktop app, а не Web application.".into(),
        "invalid_grant" => "Google отклонил одноразовый код (invalid_grant). Проверьте время Windows, повторите вход и убедитесь, что код используется только один раз.".into(),
        "redirect_uri_mismatch" => "Google отклонил адрес возврата (redirect_uri_mismatch). Проверьте тип Desktop app и локальный callback.".into(),
        "unauthorized_client" => "Этот Google OAuth-клиент не разрешён (unauthorized_client). Проверьте проект Google Cloud и экран согласия.".into(),
        "invalid_request" => "Google отклонил параметры обмена кодом (invalid_request). Проверьте настройки Desktop OAuth и PKCE.".into(),
        "access_denied" => "Google не предоставил доступ (access_denied). Проверьте тестовых пользователей OAuth и настройки согласия.".into(),
        "temporarily_unavailable" | "server_error" => "Сервис Google временно недоступен. Попробуйте повторить вход.".into(),
        _ => format!("Google не выдал токен входа (HTTP {}). Проверьте настройки OAuth и повторите попытку.", status.as_u16()),
    }
}

pub async fn acquire_id_token(client_id: &str, nonce: &str) -> Result<String, String> {
    if !valid_client_id(client_id) || nonce.len() < 24 || nonce.len() > 256 {
        return Err("Google OAuth для Windows настроен неверно.".into());
    }
    let listener = TcpListener::bind("127.0.0.1:0").await
        .map_err(|_| "Не удалось запустить локальный обработчик входа Google.".to_string())?;
    let redirect = format!("http://127.0.0.1:{}{CALLBACK_PATH}",
        listener.local_addr().map_err(|_| "Ошибка локального OAuth-порта.".to_string())?.port());
    let state = random_verifier();
    let verifier = random_verifier();
    let authorization = oauth_url(client_id, &redirect, nonce, &state, &pkce_challenge(&verifier));
    open_google_in_system_browser(&authorization)?;
    let code = wait_for_callback(listener, &state).await?;

    let client = Client::builder().https_only(true)
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(15)).build()
        .map_err(|_| "Не удалось подготовить запрос Google OAuth.".to_string())?;
    let response = client.post("https://oauth2.googleapis.com/token")
        .form(&[
            ("client_id", client_id),
            ("code", code.as_str()),
            ("redirect_uri", redirect.as_str()),
            ("grant_type", "authorization_code"),
            ("code_verifier", verifier.as_str()),
        ])
        .send().await.map_err(|_| "Google не ответил при подтверждении входа.".to_string())?;
    if !response.status().is_success() {
        let status = response.status();
        let payload: Value = response.json().await.unwrap_or(Value::Null);
        return Err(token_exchange_error(status, &payload));
    }
    let payload: Value = response.json().await
        .map_err(|_| "Google вернул некорректный ответ авторизации.".to_string())?;
    let id_token = payload.get("id_token").and_then(Value::as_str).unwrap_or("");
    if id_token.len() < 30 || id_token.len() > 16384 || id_token.split('.').count() != 3 {
        return Err("Google не вернул корректный ID-токен.".into());
    }
    Ok(id_token.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn oauth_callback_requires_correct_state_path_and_single_code() {
        assert_eq!(parse_callback("GET /oauth2/callback?state=secret&code=abc HTTP/1.1", "secret"),
            Callback::Code("abc".into()));
        for bad in [
            "GET /oauth2/callback?state=evil&code=abc HTTP/1.1",
            "GET /?state=secret&code=abc HTTP/1.1",
            "GET /oauth2/callback?state=secret&code=a&code=b HTTP/1.1",
            "POST /oauth2/callback?state=secret&code=abc HTTP/1.1",
        ] {
            assert_eq!(parse_callback(bad, "secret"), Callback::Ignore);
        }
        assert_eq!(parse_callback("GET /oauth2/callback?state=secret&error=access_denied HTTP/1.1", "secret"),
            Callback::Denied);
    }

    #[test]
    fn token_errors_are_actionable_without_reflecting_google_details() {
        let response = serde_json::json!({
            "error": "invalid_grant",
            "error_description": "SECRET_CODE_SHOULD_NOT_APPEAR"
        });
        let result = token_exchange_error(reqwest::StatusCode::BAD_REQUEST, &response);
        assert!(result.contains("invalid_grant"));
        assert!(!result.contains("SECRET_CODE_SHOULD_NOT_APPEAR"));
        assert!(token_exchange_error(reqwest::StatusCode::BAD_REQUEST,
            &serde_json::json!({"error":"invalid_client"})).contains("Desktop"));
    }

    #[test]
    fn pkce_uses_sha256_and_client_id_must_be_google_desktop_id() {
        assert_eq!(pkce_challenge("correct horse"), URL_SAFE_NO_PAD.encode(Sha256::digest(b"correct horse")));
        assert_eq!(random_verifier().len(), 64);
        assert!(valid_client_id("1234-example.apps.googleusercontent.com"));
        assert!(!valid_client_id("https://attacker.invalid"));
        assert!(!valid_client_id("bad.apps.googleusercontent.com.attacker.invalid"));
    }
}
