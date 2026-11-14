// SHA-256 of xray.exe from the verified Xray 26.10.31 Windows archive.
pub const XRAY_SHA256: &str = "d5b558191cccb1e92a5772b68b8cab67717b26f634b0f15153215f65ae982a7e";

pub fn is_official_xray_hash(hash: &str) -> bool {
    hash == XRAY_SHA256
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reject_changed_runtime_and_accept_pinned_official_executable() {
        assert!(is_official_xray_hash(XRAY_SHA256));
        assert!(!is_official_xray_hash(&"0".repeat(64)));
    }
}
