//! Own the Xray subprocess with a Windows Job Object. Even if the UI is
//! terminated by Task Manager, the OS closes our job handle and terminates
//! its members. This is not a substitute for a privileged service or route
//! restoration; it prevents one common orphan-process failure mode.
use std::{io, mem, os::windows::io::AsRawHandle, process::Child, ptr};
use windows_sys::Win32::{
    Foundation::{CloseHandle, HANDLE},
    System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
        SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    },
};

pub struct ChildJob(HANDLE);

// Each handle is owned by one ChildJob, passed by value into the tunnel's
// Mutex-protected state. It is never accessed concurrently.
unsafe impl Send for ChildJob {}

impl ChildJob {
    pub fn attach(child: &Child) -> Result<Self, String> {
        // SAFETY: Null security attributes and name create a private unnamed
        // job; ownership of the returned handle is transferred to ChildJob.
        let handle = unsafe { CreateJobObjectW(ptr::null(), ptr::null()) };
        if handle.is_null() {
            return Err(format!(
                "Не удалось создать защиту процесса VPN: {}",
                io::Error::last_os_error()
            ));
        }
        let job = Self(handle);
        // SAFETY: Win32 explicitly accepts a zero-initialized extended limits
        // structure, then we set the supported JOB_OBJECT_LIMIT flag.
        let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = unsafe { mem::zeroed() };
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        let configured = unsafe {
            SetInformationJobObject(
                job.0,
                JobObjectExtendedLimitInformation,
                &limits as *const _ as *const _,
                mem::size_of_val(&limits) as u32,
            )
        };
        if configured == 0 {
            return Err(format!(
                "Не удалось включить остановку VPN при сбое приложения: {}",
                io::Error::last_os_error()
            ));
        }
        // SAFETY: Child owns a valid open Windows process handle.
        // If assignment fails (e.g. job restrictions), caller terminates
        // the child and never shows a successful VPN connection.
        let assigned = unsafe { AssignProcessToJobObject(job.0, child.as_raw_handle() as HANDLE) };
        if assigned == 0 {
            return Err(format!(
                "Не удалось привязать процесс VPN к приложению: {}",
                io::Error::last_os_error()
            ));
        }
        Ok(job)
    }
}

impl Drop for ChildJob {
    fn drop(&mut self) {
        // SAFETY: This is the only owner of the handle. Closing the last
        // job handle terminates Xray even after abnormal app termination.
        unsafe { CloseHandle(self.0) };
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{os::windows::process::CommandExt, process::Command, thread, time::Duration};

    #[test]
    fn closing_job_handle_terminates_tracked_child() {
        // Real Win32 semantics, not a mocked contract: an unexpectedly
        // terminated Tauri process closes exactly this job handle.
        let mut child = Command::new("powershell.exe")
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                "Start-Sleep -Seconds 30",
            ])
            .creation_flags(0x0800_0000)
            .spawn()
            .expect("Windows must launch a harmless idle test child");
        let job = match ChildJob::attach(&child) {
            Ok(job) => job,
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait();
                panic!("Cannot enforce fail-closed process supervision: {error}");
            }
        };
        drop(job);
        for _ in 0..60 {
            if child.try_wait().expect("read child exit").is_some() {
                return;
            }
            thread::sleep(Duration::from_millis(50));
        }
        let _ = child.kill();
        let _ = child.wait();
        panic!("Closing the Job Object did not terminate the child process");
    }
}
