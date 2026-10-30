#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod api_transport;
mod egress;
mod service;
mod tun_config;
mod tunnel_runtime;

use tauri::{Manager, RunEvent};
use tauri_plugin_deep_link::DeepLinkExt;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_deep_link::init())
        .setup(|app| {
            #[cfg(all(debug_assertions, windows))]
            app.deep_link().register_all()?;
            Ok(())
        })
        .manage(service::AppState::default())
        .invoke_handler(tauri::generate_handler![
            api_transport::api_transport_encrypted,
            service::auth_login,
            service::auth_register,
            service::auth_google,
            service::telegram_login,
            service::telegram_create_session,
            service::telegram_check_session,
            service::auth_logout,
            service::restore_session,
            service::account_snapshot,
            service::get_servers,
            service::get_plans,
            service::activate_trial,
            service::create_payment,
            service::delete_device,
            service::delete_account,
            service::vpn_start,
            service::vpn_stop,
            service::vpn_status,
            service::get_settings,
            service::save_setting,
            service::startup_enabled,
            service::set_startup,
            service::window_minimize,
            service::window_toggle_maximize,
            service::window_close,
            service::open_external_url
        ])
        .build(tauri::generate_context!())
        .expect("ByMeVPN failed to start")
        .run(|app_handle, event| {
            if let RunEvent::ExitRequested { .. } = event {
                if let Some(state) = app_handle.try_state::<service::AppState>() {
                    if let Ok(mut lock) = state.tunnel.lock() {
                        if let Some(mut active) = lock.take() {
                            let _ = active.child.kill();
                            let _ = active.child.wait();
                            let _ = std::fs::remove_file(&active.config_path);
                        }
                    }
                }
            }
        });
}
