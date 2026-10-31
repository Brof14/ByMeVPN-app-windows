use reqwest::{Client, Method, Response};
use serde_json::Value;

// Production API endpoint with TLS/HTTPS encryption.
pub const API_BASES: [&str; 1] = [
    "https://bymevpn.duckdns.org/api/v1",
];

#[tauri::command]
pub fn api_transport_encrypted() -> bool {
    API_BASES.iter().all(|base| base.starts_with("https://"))
}

pub async fn send_to_bases(
    client: &Client,
    bases: &[&str],
    method: Method,
    path: &str,
    body: Option<&Value>,
    token: Option<&str>,
) -> Result<Response, reqwest::Error> {
    for (index, base) in bases.iter().enumerate() {
        let mut request = client
            .request(method.clone(), format!("{base}{path}"))
            .header("Accept", "application/json");
        if let Some(body) = body {
            request = request.json(body);
        }
        if let Some(token) = token {
            request = request.bearer_auth(token);
        }
        match request.send().await {
            Err(error) if error.is_connect() && index + 1 < bases.len() => continue,
            result => return result,
        }
    }
    unreachable!("API endpoint list is nonempty")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        io::{Read, Write},
        net::TcpListener,
        thread,
    };

    #[test]
    fn falls_back_only_when_primary_connection_cannot_be_established() {
        let unavailable = TcpListener::bind("127.0.0.1:0").unwrap();
        let primary = format!("http://{}", unavailable.local_addr().unwrap());
        drop(unavailable);
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let fallback = format!("http://{}", listener.local_addr().unwrap());
        let worker = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut buffer = [0; 2048];
            let _ = stream.read(&mut buffer).unwrap();
            stream
                .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}")
                .unwrap();
        });
        let client = Client::new();
        let result = tauri::async_runtime::block_on(send_to_bases(
            &client,
            &[primary.as_str(), fallback.as_str()],
            Method::GET,
            "/plans",
            None,
            None,
        ))
        .unwrap();
        assert_eq!(result.status(), 200);
        worker.join().unwrap();
    }

    #[test]
    fn server_error_is_returned_without_retrying_a_mutation() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let primary = format!("http://{}", listener.local_addr().unwrap());
        let worker = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut buffer = [0; 2048];
            let _ = stream.read(&mut buffer).unwrap();
            stream.write_all(b"HTTP/1.1 500 Internal Server Error\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").unwrap();
        });
        let response = tauri::async_runtime::block_on(send_to_bases(
            &Client::new(),
            &[primary.as_str(), "http://127.0.0.1:1"],
            Method::POST,
            "/payment/create",
            Some(&serde_json::json!({"plan_code":"month"})),
            None,
        ))
        .unwrap();
        assert_eq!(response.status(), 500);
        worker.join().unwrap();
    }

    #[test]
    fn transport_is_strictly_encrypted() {
        assert!(api_transport_encrypted());
    }
}
