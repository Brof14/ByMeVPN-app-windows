use std::{
    ffi::{OsStr, OsString},
    path::PathBuf,
    thread,
    time::{Duration, Instant},
};
use windows_service::{
    service::{
        ServiceAccess, ServiceAction, ServiceActionType, ServiceErrorControl,
        ServiceFailureActions, ServiceFailureResetPeriod, ServiceInfo, ServiceStartType,
        ServiceState, ServiceType,
    },
    service_manager::{ServiceManager, ServiceManagerAccess},
    Error as ServiceError,
};

const NAME: &str = "ByMeVPNVpn";
const DISPLAY_NAME: &str = "ByMeVPN VPN Service";
const SERVICE_DESCRIPTION: &str =
    "Manages the ByMeVPN tunnel and restores only ByMeVPN network settings.";

pub fn install() -> Result<(), String> {
    let manager = ServiceManager::local_computer(
        None::<&OsStr>,
        ServiceManagerAccess::CONNECT | ServiceManagerAccess::CREATE_SERVICE,
    )
    .map_err(display_error)?;
    let service_info = service_info()?;
    let access = ServiceAccess::QUERY_CONFIG
        | ServiceAccess::QUERY_STATUS
        | ServiceAccess::CHANGE_CONFIG
        | ServiceAccess::START
        | ServiceAccess::STOP
        | ServiceAccess::DELETE;
    let (service, created_here) = match manager.create_service(&service_info, access) {
        Ok(service) => (service, true),
        Err(_) => (
            manager.open_service(NAME, access).map_err(display_error)?,
            false,
        ),
    };
    let configured = configure_and_start(&service, &service_info);
    if let Err(error) = configured {
        if created_here {
            let _ = stop_service(&service);
            let _ = service.delete();
        }
        return Err(error);
    }
    Ok(())
}

fn configure_and_start(
    service: &windows_service::service::Service,
    service_info: &ServiceInfo,
) -> Result<(), String> {
    service
        .change_config(&service_info)
        .map_err(display_error)?;
    service
        .set_description(SERVICE_DESCRIPTION)
        .map_err(display_error)?;
    service
        .update_failure_actions(ServiceFailureActions {
            reset_period: ServiceFailureResetPeriod::After(Duration::from_secs(86_400)),
            reboot_msg: None,
            command: None,
            actions: Some(vec![
                ServiceAction {
                    action_type: ServiceActionType::Restart,
                    delay: Duration::from_secs(5),
                },
                ServiceAction {
                    action_type: ServiceActionType::Restart,
                    delay: Duration::from_secs(15),
                },
                ServiceAction {
                    action_type: ServiceActionType::Restart,
                    delay: Duration::from_secs(30),
                },
            ]),
        })
        .map_err(display_error)?;
    service
        .set_failure_actions_on_non_crash_failures(true)
        .map_err(display_error)?;

    if service.query_status().map_err(display_error)?.current_state != ServiceState::Running {
        match service.start(&[] as &[OsString]) {
            Ok(()) => {}
            Err(error) if win_error(&error) == Some(1056) => {}
            Err(error) => return Err(display_error(error)),
        }
        wait_for_state(&service, ServiceState::Running, Duration::from_secs(20))?;
    }
    Ok(())
}

pub fn stop() -> Result<(), String> {
    let Some(service) = open_if_installed(ServiceAccess::QUERY_STATUS | ServiceAccess::STOP)?
    else {
        return Ok(());
    };
    stop_service(&service)
}

pub fn uninstall() -> Result<(), String> {
    let Some(service) = open_if_installed(
        ServiceAccess::QUERY_STATUS | ServiceAccess::STOP | ServiceAccess::DELETE,
    )?
    else {
        return crate::tun_health::cleanup_bymevpn_routes_after_exit_sync();
    };
    stop_service(&service)?;
    // A prior service crash may have terminated Xray before its Go-side
    // cleanup ran. Remove only stale routes/DNS on the ByMeVPN adapter before
    // the service and its recovery code are deleted.
    crate::tun_health::cleanup_bymevpn_routes_after_exit_sync()?;
    service.delete().map_err(display_error)
}

fn open_if_installed(
    access: ServiceAccess,
) -> Result<Option<windows_service::service::Service>, String> {
    let manager = ServiceManager::local_computer(None::<&OsStr>, ServiceManagerAccess::CONNECT)
        .map_err(display_error)?;
    match manager.open_service(NAME, access) {
        Ok(service) => Ok(Some(service)),
        Err(error) if win_error(&error) == Some(1060) => Ok(None),
        Err(error) => Err(display_error(error)),
    }
}

fn stop_service(service: &windows_service::service::Service) -> Result<(), String> {
    let state = service.query_status().map_err(display_error)?.current_state;
    if state == ServiceState::Stopped {
        return Ok(());
    }
    match service.stop() {
        Ok(_) => {}
        Err(error) if win_error(&error) == Some(1062) => return Ok(()),
        Err(error) => return Err(display_error(error)),
    }
    wait_for_state(service, ServiceState::Stopped, Duration::from_secs(35))
}

fn wait_for_state(
    service: &windows_service::service::Service,
    expected: ServiceState,
    timeout: Duration,
) -> Result<(), String> {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        let status = service.query_status().map_err(display_error)?;
        if status.current_state == expected {
            return Ok(());
        }
        thread::sleep(Duration::from_millis(250));
    }
    Err(format!(
        "Windows VPN service did not reach {expected:?} state."
    ))
}

fn service_info() -> Result<ServiceInfo, String> {
    let executable_path: PathBuf = std::env::current_exe()
        .map_err(display_error)?
        .canonicalize()
        .map_err(display_error)?;
    let program_files = std::env::var_os("ProgramFiles")
        .map(PathBuf::from)
        .and_then(|path| path.canonicalize().ok())
        .ok_or_else(|| "Windows Program Files directory could not be verified.".to_string())?;
    let executable = normalized_windows_path(&executable_path);
    let trusted_root = format!("{}\\", normalized_windows_path(&program_files));
    if !executable.starts_with(&trusted_root) {
        return Err("Install ByMeVPN under Program Files to register its VPN service.".into());
    }
    Ok(ServiceInfo {
        name: OsString::from(NAME),
        display_name: OsString::from(DISPLAY_NAME),
        service_type: ServiceType::OWN_PROCESS,
        start_type: ServiceStartType::AutoStart,
        error_control: ServiceErrorControl::Normal,
        executable_path,
        launch_arguments: vec![],
        dependencies: vec![],
        account_name: None,
        account_password: None,
    })
}

fn normalized_windows_path(path: &std::path::Path) -> String {
    path.to_string_lossy()
        .trim_start_matches(r"\\?\")
        .replace('/', "\\")
        .trim_end_matches('\\')
        .to_ascii_lowercase()
}

fn win_error(error: &ServiceError) -> Option<i32> {
    match error {
        ServiceError::Winapi(error) => error.raw_os_error(),
        _ => None,
    }
}

fn display_error(error: impl std::fmt::Display) -> String {
    error.to_string()
}
