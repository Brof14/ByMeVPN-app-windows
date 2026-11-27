//! Installed applications for Windows split tunneling.
//!
//! Xray matches excluded programs by absolute executable path, so the picker
//! has to offer real paths instead of display names. The catalog is assembled
//! from the uninstall registry (most desktop apps), the `App Paths` registry
//! (launchers and CLIs) and a shallow scan of the per-user/program folders,
//! which catches portable and Steam-style installs that never register.

use serde::Serialize;
use std::collections::BTreeMap;
use std::path::Path;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct InstalledApp {
    pub name: String,
    pub path: String,
}

/// Executables that never belong in a bypass list: installers, updaters and
/// crash handlers only run while an app is being maintained.
const SKIPPED_EXECUTABLES: [&str; 12] = [
    "unins",
    "uninstall",
    "setup",
    "install",
    "update",
    "updater",
    "crashpad",
    "crashhandler",
    "elevate",
    "helper",
    "vc_redist",
    "dotnet",
];

const MAX_APPS: usize = 4000;

fn is_candidate_executable(path: &Path) -> bool {
    let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
        return false;
    };
    let lower = name.to_ascii_lowercase();
    if !lower.ends_with(".exe") || lower.len() <= 4 {
        return false;
    }
    !SKIPPED_EXECUTABLES.iter().any(|skip| lower.contains(skip))
}

fn display_name(path: &Path) -> String {
    path.file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or("Application")
        .to_string()
}

/// Stable catalog: one entry per executable path (case-insensitive), sorted by
/// display name. Later duplicates are ignored so the first, most specific
/// source wins.
pub fn merge_apps(apps: impl IntoIterator<Item = InstalledApp>) -> Vec<InstalledApp> {
    let mut by_path: BTreeMap<String, InstalledApp> = BTreeMap::new();
    for app in apps {
        let path = app.path.trim();
        if path.len() < 4 || path.len() > 260 {
            continue;
        }
        if path.chars().any(|c| c.is_control()) {
            continue;
        }
        let key = path.to_ascii_lowercase();
        if !key.ends_with(".exe") || by_path.contains_key(&key) {
            continue;
        }
        let name = if app.name.trim().is_empty() {
            display_name(Path::new(path))
        } else {
            app.name.trim().to_string()
        };
        by_path.insert(
            key,
            InstalledApp {
                name,
                path: path.to_string(),
            },
        );
        if by_path.len() >= MAX_APPS {
            break;
        }
    }
    let mut apps: Vec<InstalledApp> = by_path.into_values().collect();
    apps.sort_by(|a, b| {
        a.name
            .to_ascii_lowercase()
            .cmp(&b.name.to_ascii_lowercase())
            .then_with(|| a.path.cmp(&b.path))
    });
    apps
}

/// Full catalog for the current platform. Only Windows installs have a
/// meaningful list; every other target returns an empty catalog so the UI can
/// still be exercised during development.
pub fn collect_installed_apps() -> Vec<InstalledApp> {
    #[cfg(windows)]
    {
        let mut apps = Vec::new();
        collect_from_uninstall_keys(&mut apps);
        collect_from_app_paths(&mut apps);
        collect_from_program_folders(&mut apps);
        merge_apps(apps)
    }
    #[cfg(not(windows))]
    {
        Vec::new()
    }
}

#[cfg(windows)]
fn collect_from_uninstall_keys(apps: &mut Vec<InstalledApp>) {
    use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, KEY_READ};
    use winreg::RegKey;

    const UNINSTALL: &str = r"Software\Microsoft\Windows\CurrentVersion\Uninstall";
    for root in [HKEY_LOCAL_MACHINE, HKEY_CURRENT_USER] {
        let Ok(key) = RegKey::predef(root).open_subkey_with_flags(UNINSTALL, KEY_READ) else {
            continue;
        };
        for subkey in key.enum_keys().flatten() {
            let Ok(entry) = key.open_subkey_with_flags(&subkey, KEY_READ) else {
                continue;
            };
            let display: String = entry.get_value("DisplayName").unwrap_or_default();
            let icon: String = entry.get_value("DisplayIcon").unwrap_or_default();
            let location: String = entry.get_value("InstallLocation").unwrap_or_default();
            let Some(path) = exe_path_from_icon(&icon)
                .or_else(|| exe_path_in_location(&location))
                .or_else(|| exe_path_from_display(&display, &location))
            else {
                continue;
            };
            if !is_candidate_executable(Path::new(&path)) {
                continue;
            }
            apps.push(InstalledApp {
                name: if display.trim().is_empty() {
                    display_name(Path::new(&path))
                } else {
                    display
                },
                path,
            });
        }
    }
}

fn from_icon_path(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    // DisplayIcon is "C:\App\app.exe,0" or a quoted path; keep the executable.
    let unquoted = trimmed.trim_matches('"');
    let candidate = unquoted
        .rsplit_once(',')
        .map(|(path, index)| {
            if index.trim().parse::<u32>().is_ok() {
                path.trim().trim_matches('"')
            } else {
                unquoted
            }
        })
        .unwrap_or(unquoted)
        .trim();
    candidate
        .to_ascii_lowercase()
        .ends_with(".exe")
        .then(|| candidate.to_string())
}

#[cfg(windows)]
fn exe_path_from_icon(icon: &str) -> Option<String> {
    let path = from_icon_path(icon)?;
    Path::new(&path).is_file().then_some(path)
}

#[cfg(windows)]
fn exe_path_in_location(location: &str) -> Option<String> {
    let dir = location.trim().trim_matches('"');
    if dir.is_empty() {
        return None;
    }
    let mut best: Option<(u64, String)> = None;
    let entries = std::fs::read_dir(dir).ok()?;
    for entry in entries.flatten().take(400) {
        let path = entry.path();
        if !is_candidate_executable(&path) || !path.is_file() {
            continue;
        }
        let size = entry.metadata().map(|meta| meta.len()).unwrap_or(0);
        if best
            .as_ref()
            .map_or(true, |(best_size, _)| size > *best_size)
        {
            best = Some((size, path.to_string_lossy().to_string()));
        }
    }
    best.map(|(_, path)| path)
}

#[cfg(windows)]
fn exe_path_from_display(display: &str, location: &str) -> Option<String> {
    let dir = location.trim().trim_matches('"');
    let name = display.trim();
    if dir.is_empty() || name.is_empty() {
        return None;
    }
    let mut candidates = vec![format!("{dir}\\{name}.exe")];
    candidates.push(format!("{dir}\\{}.exe", name.replace(' ', "")));
    candidates
        .into_iter()
        .find(|path| Path::new(path).is_file())
}

#[cfg(windows)]
fn collect_from_app_paths(apps: &mut Vec<InstalledApp>) {
    use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, KEY_READ};
    use winreg::RegKey;

    const APP_PATHS: &str = r"Software\Microsoft\Windows\CurrentVersion\App Paths";
    for root in [HKEY_LOCAL_MACHINE, HKEY_CURRENT_USER] {
        let Ok(key) = RegKey::predef(root).open_subkey_with_flags(APP_PATHS, KEY_READ) else {
            continue;
        };
        for subkey in key.enum_keys().flatten() {
            let Ok(entry) = key.open_subkey_with_flags(&subkey, KEY_READ) else {
                continue;
            };
            let Ok(path) = entry.get_value::<String, _>("") else {
                continue;
            };
            let path = path.trim().trim_matches('"').to_string();
            if !is_candidate_executable(Path::new(&path)) || !Path::new(&path).is_file() {
                continue;
            }
            apps.push(InstalledApp {
                name: subkey.trim_end_matches(".exe").to_string(),
                path,
            });
        }
    }
}

#[cfg(windows)]
fn collect_from_program_folders(apps: &mut Vec<InstalledApp>) {
    let mut roots: Vec<std::path::PathBuf> = Vec::new();
    for variable in ["ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA"] {
        if let Ok(base) = std::env::var(variable) {
            let path = if variable == "LOCALAPPDATA" {
                std::path::PathBuf::from(base).join("Programs")
            } else {
                std::path::PathBuf::from(base)
            };
            if path.is_dir() {
                roots.push(path);
            }
        }
    }
    for root in roots {
        let Ok(entries) = std::fs::read_dir(&root) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            let Ok(children) = std::fs::read_dir(&path) else {
                continue;
            };
            for child in children.flatten().take(120) {
                let child_path = child.path();
                if child_path.is_file() && is_candidate_executable(&child_path) {
                    apps.push(InstalledApp {
                        name: display_name(&child_path),
                        path: child_path.to_string_lossy().to_string(),
                    });
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn app(name: &str, path: &str) -> InstalledApp {
        InstalledApp {
            name: name.to_string(),
            path: path.to_string(),
        }
    }

    #[test]
    fn merges_duplicates_case_insensitively_and_sorts_by_name() {
        let merged = merge_apps(vec![
            app("Zeta", r"C:\Apps\zeta.exe"),
            app("Alpha", r"C:\Apps\Alpha.exe"),
            app("Duplicate", r"c:\apps\ZETA.EXE"),
            app("", r"C:\Apps\NoName.exe"),
            app("Broken", r"not-a-path"),
            app("Text", r"C:\Apps\readme.txt"),
        ]);
        assert_eq!(
            merged,
            vec![
                app("Alpha", r"C:\Apps\Alpha.exe"),
                app("NoName", r"C:\Apps\NoName.exe"),
                app("Zeta", r"C:\Apps\zeta.exe"),
            ]
        );
    }

    #[test]
    fn rejects_installers_and_short_names() {
        assert!(is_candidate_executable(Path::new(r"C:\App\app.exe")));
        assert!(!is_candidate_executable(Path::new(r"C:\App\unins000.exe")));
        assert!(!is_candidate_executable(Path::new(r"C:\App\Updater.exe")));
        assert!(!is_candidate_executable(Path::new(r"C:\App\app.dll")));
        assert!(!is_candidate_executable(Path::new(r"C:\App\.exe")));
    }

    #[test]
    fn strips_icon_indexes_from_registry_values() {
        assert_eq!(
            from_icon_path(r##""C:\Apps\Game\Game.exe",0"##),
            Some(r"C:\Apps\Game\Game.exe".to_string())
        );
        assert_eq!(
            from_icon_path(r"C:\Apps\Game\Game.exe,3"),
            Some(r"C:\Apps\Game\Game.exe".to_string())
        );
        assert_eq!(from_icon_path(r"C:\Apps\Game\readme.txt,0"), None);
        assert_eq!(from_icon_path(""), None);
    }
}
