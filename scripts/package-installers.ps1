# Package the single supported NSIS installer without deleting existing files.
# Set BYMEVPN_DIST_DIR to choose an output directory other than repository dist/.
$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$nsisBundle = Join-Path $root "src-tauri/target/release/bundle/nsis"
$config = Get-Content (Join-Path $root "src-tauri/tauri.conf.json") -Raw | ConvertFrom-Json
$runtime = Join-Path $root "vendor/runtime/windows-x64"
$dist = if ([string]::IsNullOrWhiteSpace($env:BYMEVPN_DIST_DIR)) {
    Join-Path $root "dist"
} else {
    [System.IO.Path]::GetFullPath($env:BYMEVPN_DIST_DIR)
}

foreach ($required in @("xray.exe", "wintun.dll", "geoip.dat", "geosite.dat")) {
    if (-not (Test-Path (Join-Path $runtime $required) -PathType Leaf)) {
        throw "Required VPN resource is missing before packaging: $required"
    }
}

$installerName = "ByMeVPN_$($config.version)_x64-setup.exe"
$nsis = @(Get-ChildItem -Path $nsisBundle -Filter $installerName -File -ErrorAction Stop)
if ($nsis.Count -ne 1) {
    throw "Expected the current NSIS installer $installerName; found $($nsis.Count)."
}

if (Test-Path -LiteralPath $dist) {
    $existing = @(Get-ChildItem -LiteralPath $dist -Force -ErrorAction Stop)
    if ($existing.Count -gt 0) {
        throw "Refusing to overwrite non-empty output directory: $dist"
    }
}
New-Item -ItemType Directory -Path $dist -Force | Out-Null

if ($nsis[0].Length -lt 5000000) {
    throw "Installer is suspiciously small: $($nsis[0].Name) ($($nsis[0].Length) bytes)."
}
Copy-Item -LiteralPath $nsis[0].FullName -Destination (Join-Path $dist $nsis[0].Name)

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
