use std::io;
use std::ptr::null;

use winreg::enums::{HKEY_CURRENT_USER, KEY_WRITE, KEY_READ};
use winreg::RegKey;

use windows_sys::Win32::Networking::WinInet::{
    InternetSetOptionW, INTERNET_OPTION_REFRESH, INTERNET_OPTION_SETTINGS_CHANGED
};

const PATH:&str = r"Software\Microsoft\Windows\CurrentVersion\Internet Settings";

fn apply_settings() {
    unsafe {
        InternetSetOptionW(null(), INTERNET_OPTION_SETTINGS_CHANGED, null(), 0);
        InternetSetOptionW(null(), INTERNET_OPTION_REFRESH, null(), 0);
    }
}

pub fn set_proxy() -> io::Result<()> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let (key, _) = hkcu.create_subkey(PATH)?;

    key.set_value("ProxyEnable", &1u32)?;
    key.set_value("ProxyServer", &"127.0.0.1:10809")?;
    key.set_value("ProxyOverride", &"localhost;127.*;10.*;192.168.*;<local>")?;

    apply_settings();
    Ok(())
}

pub fn disable_proxy() -> io::Result<()> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let (key, _) = hkcu.create_subkey(PATH)?;

    key.set_value("ProxyEnable", &0u32)?;

    apply_settings();
    Ok(())
}
