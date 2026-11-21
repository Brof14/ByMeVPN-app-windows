#[cfg(windows)]
#[path = "../api_transport.rs"]
mod api_transport;
#[cfg(windows)]
#[path = "../egress.rs"]
mod egress;
#[cfg(windows)]
#[path = "../vpn_service_manager.rs"]
mod service_manager;
#[cfg(windows)]
#[path = "../tun_config.rs"]
mod tun_config;
#[cfg(windows)]
#[path = "../tun_health.rs"]
mod tun_health;
#[cfg(windows)]
#[path = "../tunnel_runtime.rs"]
mod tunnel_runtime;
#[cfg(windows)]
#[path = "../vpn_broker.rs"]
mod vpn_broker;
#[cfg(windows)]
#[path = "../vpn_service.rs"]
mod vpn_service;
#[cfg(windows)]
#[path = "../vpn_service_engine.rs"]
mod vpn_service_engine;
#[cfg(windows)]
#[path = "../windows_job.rs"]
mod windows_job;

#[cfg(windows)]
fn main() {
    let action = std::env::args_os().nth(1);
    let managed = match action.as_deref() {
        Some(action) if action == "--install" => service_manager::install(),
        Some(action) if action == "--stop" => service_manager::stop(),
        Some(action) if action == "--uninstall" => service_manager::uninstall(),
        _ => return run_service_host(),
    };
    if let Err(error) = managed {
        eprintln!("ByMeVPN VPN service management failed: {error}");
        std::process::exit(1);
    }
}

#[cfg(windows)]
fn run_service_host() {
    if let Err(error) = vpn_service::run_service() {
        eprintln!("ByMeVPN VPN service failed: {error}");
        std::process::exit(1);
    }
}

#[cfg(not(windows))]
fn main() {
    eprintln!("ByMeVPN VPN service is available only on Windows.");
    std::process::exit(1);
}
