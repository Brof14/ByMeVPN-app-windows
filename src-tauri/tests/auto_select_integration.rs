use bymevpn::service::select_fastest_server_latency;

#[test]
fn auto_select_picks_server_with_lowest_outbound_latency() {
    let candidates = vec![
        ("node-a".to_string(), 120u32),
        ("node-b".to_string(), 45u32),
        ("node-c".to_string(), 0u32),
    ];
    assert_eq!(
        select_fastest_server_latency(&candidates),
        Some("node-b".to_string())
    );
}

#[test]
fn auto_select_returns_none_without_positive_latency() {
    let candidates = vec![("node-a".to_string(), 0u32), ("node-b".to_string(), 0u32)];
    assert_eq!(select_fastest_server_latency(&candidates), None);
}
