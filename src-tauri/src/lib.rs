mod xray;
mod setproxy;
use std::path::Path;
use std::process::Command;
use std::os::windows::process::CommandExt;

#[tauri::command]
fn check_config() -> bool {
    Path::new("config1.json").exists()
}
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[tauri::command]
async fn add_config() -> Result<bool, String> {
    Command::new("xui.exe")
        .creation_flags(CREATE_NO_WINDOW)
        .status()
        .map_err(|e| e.to_string())?;

    Ok(Path::new("./config1.json").exists())
}

#[tauri::command]
async fn enable() -> Result<(), String> {
    xray::start("./config1.json").map_err(|e| e.to_string())?;
    setproxy::set_proxy().map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
async fn disable() -> Result<(), String> {
    xray::stop().map_err(|e| e.to_string())?;
    setproxy::disable_proxy().map_err(|e| e.to_string())?;

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![add_config, check_config, enable, disable])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app_handle, event| {
            if let tauri::RunEvent::ExitRequested { .. } = event {
                xray::stop().unwrap();
                setproxy::disable_proxy().unwrap();
            }
        });
}