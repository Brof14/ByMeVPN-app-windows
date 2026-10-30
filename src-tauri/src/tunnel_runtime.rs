use sha2::{Digest, Sha256};
use std::{fs::File, io::Read, path::Path};

const XRAY_SHA256: &str = "07a332b714a3c0eee047a22a9c0ea749b64df33e4e1ff6d28a8c7f9ef943ce10";
const WINTUN_SHA256: &str = "e5da8447dc2c320edc0fc52fa01885c103de8c118481f683643cacc3220dafce";

fn verify_file(path: &Path, expected: &str) -> Result<(), String> {
    let mut file =
        File::open(path).map_err(|_| "Не найден проверенный компонент VPN.".to_string())?;
    let mut digest = Sha256::new();
    let mut buffer = [0u8; 65536];
    loop {
        let count = file
            .read(&mut buffer)
            .map_err(|_| "Не удалось проверить компонент VPN.".to_string())?;
        if count == 0 {
            break;
        }
        digest.update(&buffer[..count]);
    }
    if format!("{:x}", digest.finalize()) != expected {
        return Err("Компонент VPN изменён или повреждён. Подключение не запускалось.".into());
    }
    Ok(())
}

pub fn verify_runtime(directory: &Path) -> Result<(), String> {
    verify_file(&directory.join("xray.exe"), XRAY_SHA256)?;
    verify_file(&directory.join("wintun.dll"), WINTUN_SHA256)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn verified_runtime_contains_the_pinned_official_binaries() {
        let dir =
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../vendor/runtime/windows-x64");
        assert!(verify_runtime(&dir).is_ok());
    }

    #[test]
    fn runtime_is_rejected_when_files_are_missing_or_changed() {
        let dir =
            std::env::temp_dir().join(format!("bymevpn-runtime-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&dir).unwrap();
        std::fs::write(dir.join("xray.exe"), b"tampered").unwrap();
        assert!(verify_runtime(&dir).is_err());
        std::fs::remove_file(dir.join("xray.exe")).unwrap();
        std::fs::remove_dir(dir).unwrap();
    }
}
