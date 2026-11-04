# Produce a reproducible, explicitly checked installer delivery directory.
# Requires a successful Tauri NSIS + MSI build and verified vendor/runtime.
$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$bundle = Join-Path $root "src-tauri/target/release/bundle"
$runtime = Join-Path $root "vendor/runtime/windows-x64"
$dist = Join-Path $root "dist"

foreach ($required in @("xray.exe", "wintun.dll", "geoip.dat", "geosite.dat")) {
    if (-not (Test-Path (Join-Path $runtime $required) -PathType Leaf)) {
        throw "Required VPN resource is missing before packaging: $required"
    }
}

$nsis = @(Get-ChildItem -Path (Join-Path $bundle "nsis") -Filter "*.exe" -File -ErrorAction Stop)
$msi = @(Get-ChildItem -Path (Join-Path $bundle "msi") -Filter "*.msi" -File -ErrorAction Stop)
if ($nsis.Count -ne 1 -or $msi.Count -ne 1) {
    throw "Expected one complete NSIS .exe and one MSI; found NSIS=$($nsis.Count), MSI=$($msi.Count)."
}

if (Test-Path $dist) {
    Remove-Item $dist -Recurse -Force
}
New-Item -ItemType Directory -Path $dist -Force | Out-Null

foreach ($installer in @($nsis[0], $msi[0])) {
    if ($installer.Length -lt 5000000) {
        throw "Installer is suspiciously small: $($installer.Name) ($($installer.Length) bytes)."
    }
    Copy-Item -LiteralPath $installer.FullName -Destination (Join-Path $dist $installer.Name) -Force
}

# No standalone executable: it lacks the verified Xray/Wintun assets and cannot connect.
$hashLines = @(
    Get-ChildItem -Path $dist -File | Sort-Object Name | ForEach-Object {
        $hash = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
        "$hash  $($_.Name)"
    }
)
$hashLines | Set-Content -LiteralPath (Join-Path $dist "SHA256SUMS.txt") -Encoding ascii

Write-Host "Verified installer artifacts ready:"
Get-ChildItem -Path $dist -File | Format-Table Name, Length
