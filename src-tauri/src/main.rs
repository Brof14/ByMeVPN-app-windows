#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod api_transport;
mod egress;
mod google_desktop;
mod service;
mod tun_config;
mod tun_health;
mod tunnel_runtime;
mod window_layout;
#[cfg(windows)]
mod windows_job;

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, RunEvent, WindowEvent,
};
#[cfg(all(debug_assertions, windows))]
use tauri_plugin_deep_link::DeepLinkExt;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_deep_link::init())
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                window_layout::fit_to_monitor(&window)?;
            }
            let open = MenuItem::with_id(app, "open", "Открыть ByMeVPN", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Выход", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &quit])?;
            TrayIconBuilder::new()
                .menu(&menu)
                .tooltip("ByMeVPN")
                .icon(app.default_window_icon().expect("application icon").clone())
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => show_main_window(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_main_window(tray.app_handle());
                    }
                })
                .build(app)?;
            if let Ok(dir) = app.path().app_data_dir() {
                let stale_config = dir.join("active_tunnel.json");
                if stale_config.exists() {
                    let _ = std::fs::remove_file(stale_config);
                }
            }
            #[cfg(all(debug_assertions, windows))]
            app.deep_link().register_all()?;
            // Native tunnel surveillance must continue even if the WebView is
            // minimized/hidden; frontend visibilitychange stops UI polling.
            // This detects Xray exits and observed egress loss. A kernel WFP
            // Kill Switch is still required for leak-free guarantees.
            let watchdog = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let mut interval = tokio::time::interval(std::time::Duration::from_secs(8));
                interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
                loop {
                    interval.tick().await;
                    let status = service::vpn_status(
                        watchdog.clone(),
                        watchdog.state::<service::AppState>(),
                    )
                    .await;
                    if status.is_ok_and(|metrics| {
                        !metrics.connected && metrics.proof != "network_recovery_required"
                    }) {
                        service::auto_reconnect_if_due(watchdog.clone()).await;
                    }
                }
            });
            Ok(())
        })
        .manage(service::AppState::default())
        .invoke_handler(tauri::generate_handler![
            api_transport::api_transport_encrypted,
            service::auth_login,
            service::auth_register,
            service::auth_google,
            service::auth_google_desktop,
            service::telegram_create_session,
            service::telegram_check_session,
            service::telegram_cancel_session,
            service::auth_logout,
            service::restore_session,
            service::account_snapshot,
            service::get_servers,
            service::get_plans,
            service::activate_trial,
            service::create_payment,
            service::check_payment,
            service::get_pending_payment,
            service::delete_device,
            service::vpn_start,
            service::vpn_stop,
            service::vpn_status,
            service::vpn_health_report,
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
            if let RunEvent::WindowEvent {
                label,
                event: WindowEvent::CloseRequested { api, .. },
                ..
            } = &event
            {
                if label == "main"
                    && service::load_settings(app_handle)["stayConnectedInBackground"]
                        == serde_json::Value::Bool(true)
                {
                    api.prevent_close();
                    if let Some(window) = app_handle.get_webview_window("main") {
                        let _ = window.hide();
                    }
                }
            }
            if matches!(event, RunEvent::ExitRequested { .. } | RunEvent::Exit) {
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

fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}
