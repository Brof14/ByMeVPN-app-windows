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
foreach ($required in @("bymevpn.exe", "xray.exe", "wintun.dll", "geoip.dat", "geosite.dat")) {
    if (@($files | Where-Object { $_.Name -ieq $required }).Count -lt 1) {
        throw "MSI does not include required installable file: $required"
    }
}
$runtime = Join-Path $root "vendor/runtime/windows-x64"
foreach ($name in @("xray.exe", "wintun.dll", "geoip.dat", "geosite.dat")) {
    $expected = (Get-FileHash -LiteralPath (Join-Path $runtime $name) -Algorithm SHA256).Hash
    $match = @($files | Where-Object { $_.Name -ieq $name -and (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash -eq $expected })
    if ($match.Count -lt 1) { throw "MSI embeds a missing or modified VPN resource: $name" }
}
Write-Host "MSI extraction smoke-test passed. All verified runtime assets and bymevpn.exe are present."
