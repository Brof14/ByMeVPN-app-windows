#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod api_transport;
mod egress;
mod google_desktop;
mod installed_apps;
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
        .manage(service::AppState::default())
        .plugin(tauri_plugin_deep_link::init())
        .setup(|app| {
            // Recover app-owned TUN state left by an earlier process before
            // enabling account actions in the new session.
            let recovery_required =
                crate::tun_health::cleanup_bymevpn_routes_after_exit_sync().is_err();
            if let Ok(mut required) = app
                .state::<service::AppState>()
                .network_recovery_required
                .lock()
            {
                *required = recovery_required;
            }
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
                service::cleanup_stale_server_ping_configs(&dir);
            }
            #[cfg(all(debug_assertions, windows))]
            app.deep_link().register_all()?;
            // Native tunnel surveillance must continue even if the WebView is
            // minimized/hidden; frontend visibilitychange stops UI polling.
            // This detects Xray exits and observed egress loss. A kernel WFP
            // Kill Switch is still required for leak-free guarantees.
            let watchdog = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let mut interval = tokio::time::interval(std::time::Duration::from_secs(2));
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
                        // Record the Xray crash reason from xray_startup.log so the
                        // next reconnect attempt can surface a safe, non-raw diagnosis.
                        let _diagnosis = if let Ok(dir) = watchdog.path().app_data_dir() {
                            crate::tun_health::xray_failure_diagnosis(&dir.join("xray_startup.log"))
                        } else {
                            None
                        };
                        // Restore IPv4/IPv6/DNS on the failure path before restart.
                        let _ = crate::tun_health::restore_routes_and_dns_on_failure().await;
                        service::auto_reconnect_if_due(watchdog.clone()).await;
                    }
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            api_transport::api_transport_encrypted,
            service::auth_login,
            service::auth_request_password_reset,
            service::auth_register,
            service::auth_google,
            service::auth_google_desktop,
            service::telegram_create_session,
            service::telegram_check_session,
            service::telegram_cancel_session,
            service::auth_logout,
            service::auth_delete_account,
            service::auth_session_generation,
            service::restore_session,
            service::account_snapshot,
            service::get_servers,
            service::get_plans,
            service::get_auto_renewal,
            service::enable_auto_renewal,
            service::cancel_auto_renewal,
            service::activate_trial,
            service::create_payment,
            service::check_payment,
            service::get_pending_payment,
            service::delete_device,
            service::vpn_start,
            service::vpn_cancel_connect,
            service::vpn_stop,
            service::vpn_status,
            service::vpn_health_report,
            service::get_settings,
            service::save_setting,
            service::list_installed_apps,
            service::startup_enabled,
            service::set_startup,
            service::window_minimize,
            service::window_toggle_maximize,
            service::window_close,
            service::open_external_url,
            service::open_support_email
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
            if matches!(event, RunEvent::ExitRequested { .. }) {
                if let Some(state) = app_handle.try_state::<service::AppState>() {
                    if let Ok(mut lock) = state.tunnel.lock() {
                        if let Some(mut active) = lock.take() {
                            let _ = active.child.kill();
                            let _ = active.child.wait();
                            let _ = std::fs::remove_file(&active.config_path);
                        }
                    }
                }
                // ExitRequested is the last synchronous opportunity to clean
                // stale routes/DNS after Xray exits. The helper is scoped to
                // the ByMeVPN adapter; physical interfaces are untouched.
                let cleanup = crate::tun_health::cleanup_bymevpn_routes_after_exit_sync();
                tauri::async_runtime::spawn(async {
                    let _ = crate::tun_health::restore_routes_and_dns_on_failure().await;
                });
                if let Some(state) = app_handle.try_state::<service::AppState>() {
                    if let Ok(mut required) = state.network_recovery_required.lock() {
                        *required = cleanup.is_err();
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
