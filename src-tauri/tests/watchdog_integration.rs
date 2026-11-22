use bymevpn::egress::TunnelProof;
use bymevpn::service::{should_restart_after_health_probe, ReconnectState};
use std::time::{Duration, Instant};

#[test]
fn watchdog_triggers_xray_restart_after_crash() {
    // A confirmed routing bypass must make the watchdog restart Xray.
    let mut failures = 0u8;
    assert!(should_restart_after_health_probe(
        TunnelProof::RoutingBypass,
        false,
        &mut failures
    ));

    // A connected tunnel arms automatic reconnect with bounded backoff.
    let mut reconnect = ReconnectState::default();
    reconnect.connected("node-auto".to_string());
    let now = Instant::now();
    assert_eq!(reconnect.due_node(true, now), None);
    assert_eq!(
        reconnect.due_node(true, now + Duration::from_secs(2)),
        Some("node-auto".to_string())
    );
}

#[test]
fn watchdog_does_not_restart_on_transient_single_miss() {
    let mut failures = 0u8;
    assert!(!should_restart_after_health_probe(
        TunnelProof::ProxyUnreachable,
        false,
        &mut failures
    ));
    assert_eq!(failures, 1);
}
