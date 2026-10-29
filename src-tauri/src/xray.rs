use std::io;
use std::os::windows::process::CommandExt;
use std::path::Path;
use std::process::{Child, Command};
use std::sync::Mutex;

const CREATE_NO_WINDOW: u32 = 0x08000000;
static XRAY_CHILD: Mutex<Option<Child>> = Mutex::new(None);

pub fn start(config_path: &str) -> io::Result<()> {
    let mut lock = XRAY_CHILD.lock().unwrap();

    if let Some(mut child) = lock.take() {
        child.kill()?;
        child.wait()?;
    }

    let child = Command::new(Path::new("xray/xray.exe"))
        .arg("run")
        .arg("-c")
        .arg(config_path)
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()?;

    *lock = Some(child);
    Ok(())
}

pub fn stop() -> io::Result<()> {
    let mut lock = XRAY_CHILD.lock().unwrap();
    if let Some(mut child) = lock.take() {
        child.kill()?;
        child.wait()?;
    }
    Ok(())
}

