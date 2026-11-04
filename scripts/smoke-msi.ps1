# Run an administrative extraction of the built MSI and verify its real payload.
# This does not connect to the VPN or prove leak-free operation.
$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$bundle = Join-Path $root "src-tauri/target/release/bundle/msi"
$msis = @(Get-ChildItem -Path $bundle -Filter "*.msi" -File -ErrorAction Stop)
if ($msis.Count -ne 1) { throw "Expected exactly one MSI to smoke-test." }
$temp = Join-Path $env:RUNNER_TEMP "ByMeVPN-MSI-Administrative-Image"
$log = Join-Path $env:RUNNER_TEMP "ByMeVPN-MSI-Extract.log"
if (Test-Path $temp) { Remove-Item -Path $temp -Recurse -Force }
New-Item -Path $temp -ItemType Directory -Force | Out-Null

$installerPath = $msis[0].FullName
$arguments = @("/a", "`"$installerPath`"", "/qn", "TARGETDIR=`"$temp`"", "/l*v", "`"$log`"")
$process = Start-Process -FilePath "msiexec.exe" -ArgumentList $arguments -NoNewWindow -Wait -PassThru
if ($process.ExitCode -ne 0) {
    if (Test-Path $log) { Get-Content $log -Tail 35 | Write-Host }
    throw "MSI administrative extraction failed with exit code $($process.ExitCode)"
}

$files = @(Get-ChildItem -Path $temp -File -Recurse -ErrorAction Stop)
$executables = @($files | Where-Object { $_.Name -ieq "bymevpn.exe" })
if ($executables.Count -ne 1) {
    throw "Expected exactly one installed bymevpn.exe; found $($executables.Count)."
}

# An installer containing Xray SOMEWHERE is insufficient: the app resolves
# files relative to bymevpn.exe, so assert the exact on-disk Tauri layout.
$installedRoot = Split-Path -Parent $executables[0].FullName
$installedRuntime = Join-Path $installedRoot "vendor/runtime/windows-x64"
$sourceRuntime = Join-Path $root "vendor/runtime/windows-x64"
foreach ($name in @("xray.exe", "wintun.dll", "geoip.dat", "geosite.dat")) {
    $installed = Join-Path $installedRuntime $name
    $source = Join-Path $sourceRuntime $name
    if (-not (Test-Path -LiteralPath $installed -PathType Leaf)) {
        throw "MSI runtime is not next to bymevpn.exe at the path used by the app: $installed"
    }
    $expected = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash
    $actual = (Get-FileHash -LiteralPath $installed -Algorithm SHA256).Hash
    if ($actual -ne $expected) {
        throw "MSI embeds a modified VPN resource: $installed"
    }
}
Write-Host "MSI smoke-test passed: bymevpn.exe can locate all hash-verified assets at vendor/runtime/windows-x64."
