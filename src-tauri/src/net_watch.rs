// Physical network surveillance for the native tunnel watchdog.
//
// Android reacts to a network switch through ConnectivityManager: a new Wi-Fi
// or cellular link triggers an immediate route probe instead of waiting for the
// next scheduled ping. Windows has no equivalent listener here, so the client
// samples the interface Windows would use for the public internet with a
// single cheap `GetBestInterface` call on every watchdog tick (2 s). The
// interface index changes when the user switches from Wi-Fi to Ethernet,
// connects to a different Wi-Fi network, or loses the link entirely.
//
// Only the numeric index is observed: no adapter names, IP addresses or
// gateways leave this module, and nothing here changes OS configuration.

/// What changed between two samples of the physical default path.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NetworkEvent {
    /// Same interface (or still offline): nothing to do.
    Unchanged,
    /// A different interface now carries public traffic.
    Changed,
    /// The public path disappeared.
    Lost,
    /// A public path exists again after being absent.
    Restored,
}

/// Classifies a transition between two interface samples. `None` means Windows
/// reported no route to the public internet.
pub fn classify(previous: Option<u32>, current: Option<u32>) -> NetworkEvent {
    match (previous, current) {
        (None, None) => NetworkEvent::Unchanged,
        (None, Some(_)) => NetworkEvent::Restored,
        (Some(_), None) => NetworkEvent::Lost,
        (Some(previous), Some(current)) if previous == current => NetworkEvent::Unchanged,
        (Some(_), Some(_)) => NetworkEvent::Changed,
    }
}

/// Should the watchdog probe the tunnel right away for this transition?
pub fn requires_immediate_probe(event: NetworkEvent) -> bool {
    matches!(
        event,
        NetworkEvent::Changed | NetworkEvent::Restored | NetworkEvent::Lost
    )
}

#[cfg(windows)]
mod sys {
    #[link(name = "iphlpapi")]
    extern "system" {
        /// Returns the interface index Windows would use to reach an IPv4
        /// destination. `0` on success, a Win32 error code otherwise.
        fn GetBestInterface(dw_dest_addr: u32, pdw_best_if_index: *mut u32) -> u32;
    }

    pub fn best_interface() -> Option<u32> {
        // 1.1.1.1 in network byte order: a public destination that never
        // resolves to a local subnet, so the answer is the route to the
        // internet rather than a VPN adapter's own on-link route.
        const PUBLIC_DESTINATION: u32 = u32::from_ne_bytes([1, 1, 1, 1]);
        let mut index: u32 = 0;
        // SAFETY: `GetBestInterface` writes one u32 through the out pointer we
        // own for the duration of the call and touches nothing else.
        let status = unsafe { GetBestInterface(PUBLIC_DESTINATION, &mut index) };
        if status == 0 && index != 0 {
            Some(index)
        } else {
            None
        }
    }
}

#[cfg(not(windows))]
mod sys {
    pub fn best_interface() -> Option<u32> {
        None
    }
}

/// Interface index currently used for public traffic, if any.
pub fn current_interface_index() -> Option<u32> {
    sys::best_interface()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identical_samples_are_not_events() {
        assert_eq!(classify(Some(12), Some(12)), NetworkEvent::Unchanged);
        assert_eq!(classify(None, None), NetworkEvent::Unchanged);
    }

    #[test]
    fn adapter_switch_is_a_change() {
        assert_eq!(classify(Some(12), Some(27)), NetworkEvent::Changed);
        assert_eq!(classify(Some(27), Some(12)), NetworkEvent::Changed);
    }

    #[test]
    fn offline_and_back_is_lost_then_restored() {
        assert_eq!(classify(Some(12), None), NetworkEvent::Lost);
        assert_eq!(classify(None, Some(12)), NetworkEvent::Restored);
    }

    #[test]
    fn every_real_transition_forces_an_immediate_probe() {
        assert!(requires_immediate_probe(NetworkEvent::Changed));
        assert!(requires_immediate_probe(NetworkEvent::Lost));
        assert!(requires_immediate_probe(NetworkEvent::Restored));
        assert!(!requires_immediate_probe(NetworkEvent::Unchanged));
    }

    #[test]
    fn sampling_never_panics_without_a_public_route() {
        // The sandbox has no Windows route table; the call must stay total.
        let _ = current_interface_index();
    }
}
