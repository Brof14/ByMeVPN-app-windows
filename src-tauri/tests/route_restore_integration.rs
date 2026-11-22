use bymevpn::tun_health::restore_routes_and_dns_on_failure;

#[tokio::test]
async fn routes_and_dns_are_restored_on_failure_paths() {
    // Idempotent restore must succeed even when no ByMeVPN adapter exists.
    assert!(restore_routes_and_dns_on_failure().await.is_ok());
}
