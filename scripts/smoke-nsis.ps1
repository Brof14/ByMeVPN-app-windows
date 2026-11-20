# Install and remove the NSIS package on the disposable Windows CI runner.
# Never launches ByMeVPN or starts a VPN session.
$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$bundle = Join-Path $root "src-tauri/target/release/bundle/nsis"
$config = Get-Content (Join-Path $root "src-tauri/tauri.conf.json") -Raw | ConvertFrom-Json
$runtimeSource = Join-Path $root "vendor/runtime/windows-x64"
$runnerTemp = $env:RUNNER_TEMP
if ([string]::IsNullOrWhiteSpace($runnerTemp) -or -not (Test-Path -LiteralPath $runnerTemp -PathType Container)) {
    throw "NSIS smoke test must run in a disposable CI runner with RUNNER_TEMP set."
}
$runnerTemp = (Resolve-Path -LiteralPath $runnerTemp).Path
$installRoot = Join-Path $runnerTemp ("ByMeVPN-NSIS-" + [guid]::NewGuid().ToString("N"))
$installerName = "ByMeVPN_$($config.version)_x64-setup.exe"
$installer = @(Get-ChildItem -Path $bundle -Filter $installerName -File -ErrorAction Stop)
if ($installer.Count -ne 1) { throw "Expected current NSIS installer $installerName." }

try {
    $process = Start-Process -FilePath $installer[0].FullName `
        -ArgumentList @("/S", "/D=$installRoot") -Wait -PassThru
    if ($process.ExitCode -ne 0) { throw "NSIS install failed with exit code $($process.ExitCode)." }

    $executables = @(Get-ChildItem -LiteralPath $installRoot -Filter "bymevpn.exe" -File -Recurse -ErrorAction Stop)
    if ($executables.Count -ne 1) { throw "Expected one installed bymevpn.exe; found $($executables.Count)." }
    $installedRoot = Split-Path -Parent $executables[0].FullName
    $installedRuntime = Join-Path $installedRoot "vendor/runtime/windows-x64"
    foreach ($name in @("xray.exe", "wintun.dll", "geoip.dat", "geosite.dat")) {
        $installed = Join-Path $installedRuntime $name
        $source = Join-Path $runtimeSource $name
        if (-not (Test-Path -LiteralPath $installed -PathType Leaf)) {
            throw "NSIS install omitted a runtime asset: $installed"
        }
        $expected = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash
        $actual = (Get-FileHash -LiteralPath $installed -Algorithm SHA256).Hash
        if ($actual -ne $expected) { throw "Installed runtime hash mismatch: $installed" }
    }

    $uninstaller = Join-Path $installedRoot "uninstall.exe"
    if (-not (Test-Path -LiteralPath $uninstaller -PathType Leaf)) {
        throw "NSIS installation did not create its uninstaller."
    }
    $remove = Start-Process -FilePath $uninstaller -ArgumentList "/S" -Wait -PassThru
    if ($remove.ExitCode -ne 0) { throw "NSIS uninstall failed with exit code $($remove.ExitCode)." }
    if (Test-Path -LiteralPath $installRoot) { throw "NSIS uninstall left files in the isolated install directory." }
    Write-Host "NSIS smoke-test passed: install, runtime hashes and uninstall."
}
finally {
    $resolvedInstallRoot = [System.IO.Path]::GetFullPath($installRoot)
    $requiredPrefix = $runnerTemp.TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
    if (-not $resolvedInstallRoot.StartsWith($requiredPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing cleanup outside RUNNER_TEMP: $resolvedInstallRoot"
    }
    if (Test-Path -LiteralPath $resolvedInstallRoot) {
        Remove-Item -LiteralPath $resolvedInstallRoot -Recurse -Force
    }
}
