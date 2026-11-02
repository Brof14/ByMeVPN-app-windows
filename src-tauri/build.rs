use sha2::{Digest, Sha256};
use std::{fs::File, io::Read, path::PathBuf};

fn verified_build_runtime_hash() -> String {
    let path = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").expect("Manifest dir"))
        .join("../vendor/runtime/windows-x64/xray.exe");
    let Ok(mut file) = File::open(&path) else {
        if std::env::var("PROFILE").ok().as_deref() == Some("release") {
            panic!("Official, SHA256-verified Xray runtime is required before release builds");
        }
        return "missing-runtime".into();
    };
    let mut digest = Sha256::new();
    let mut buffer = [0u8; 65_536];
    loop {
        let bytes = file.read(&mut buffer).expect("Read Xray release binary");
        if bytes == 0 { break; }
        digest.update(&buffer[..bytes]);
    }
    format!("{:x}", digest.finalize())
}

fn main() {
    println!("cargo:rerun-if-env-changed=BYMEVPN_NO_ADMIN_MANIFEST");
    println!("cargo:rerun-if-changed=../vendor/runtime/windows-x64/xray.exe");
    println!("cargo:rustc-env=BYMEVPN_XRAY_SHA256={}", verified_build_runtime_hash());
    let execution_level = if std::env::var("BYMEVPN_NO_ADMIN_MANIFEST").is_ok() {
        "asInvoker"
    } else {
        "requireAdministrator"
    };

    let manifest = format!(
        r#"<assembly xmlns="urn:schemas-microsoft-com:asm.v1" manifestVersion="1.0">
  <dependency>
    <dependentAssembly>
      <assemblyIdentity
        type="win32"
        name="Microsoft.Windows.Common-Controls"
        version="6.0.0.0"
        processorArchitecture="*"
        publicKeyToken="6595b64144ccf1df"
        language="*"
      />
    </dependentAssembly>
  </dependency>
  <trustInfo xmlns="urn:schemas-microsoft-com:asm.v3">
    <security>
      <requestedPrivileges>
        <requestedExecutionLevel level="{execution_level}" uiAccess="false" />
      </requestedPrivileges>
    </security>
  </trustInfo>
  <compatibility xmlns="urn:schemas-microsoft-com:compatibility.v1">
    <application>
      <!-- Windows 10 and Windows 11 -->
      <supportedOS Id="{{8e0f7a12-bfb3-4fe8-b9a5-48fd50a15a9a}}" />
      <!-- Windows 8.1 -->
      <supportedOS Id="{{1f676c76-80e1-4239-95bb-83d0f6d0da78}}" />
      <!-- Windows 8 -->
      <supportedOS Id="{{4a2f28e3-53b9-4441-ba9c-d69d4a4a6e38}}" />
      <!-- Windows 7 -->
      <supportedOS Id="{{35138b9a-5d96-4fbd-8e2d-a2440225f93a}}" />
    </application>
  </compatibility>
  <application xmlns="urn:schemas-microsoft-com:asm.v3">
    <windowsSettings>
      <dpiAware xmlns="http://schemas.microsoft.com/SMI/2005/WindowsSettings">true/pm</dpiAware>
      <dpiAwareness xmlns="http://schemas.microsoft.com/SMI/2016/WindowsSettings">PerMonitorV2</dpiAwareness>
    </windowsSettings>
  </application>
</assembly>"#
    );

    let windows = tauri_build::WindowsAttributes::new().app_manifest(manifest);
    tauri_build::try_build(tauri_build::Attributes::new().windows_attributes(windows)).expect("build failed");
}
