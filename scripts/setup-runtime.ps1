$ErrorActionPreference = "Stop"

$runtimeDir = Join-Path $PSScriptRoot "..\vendor\runtime\windows-x64"
$downloadsDir = Join-Path $PSScriptRoot "..\vendor\downloads"

if (-not (Test-Path $runtimeDir)) {
    New-Item -ItemType Directory -Path $runtimeDir -Force | Out-Null
}
if (-not (Test-Path $downloadsDir)) {
    New-Item -ItemType Directory -Path $downloadsDir -Force | Out-Null
}

$xrayExe = Join-Path $runtimeDir "xray.exe"
$wintunDll = Join-Path $runtimeDir "wintun.dll"

$expectedXrayHash = "07a332b714a3c0eee047a22a9c0ea749b64df33e4e1ff6d28a8c7f9ef943ce10"
$expectedWintunHash = "e5da8447dc2c320edc0fc52fa01885c103de8c118481f683643cacc3220dafce"

function Verify-FileHash($path, $expected) {
    if (-not (Test-Path $path)) { return $false }
    $hash = (Get-FileHash -Path $path -Algorithm SHA256).Hash.ToLower()
    return $hash -eq $expected.ToLower()
}

$needXray = -not (Verify-FileHash $xrayExe $expectedXrayHash)
$needWintun = -not (Verify-FileHash $wintunDll $expectedWintunHash)

if ($needXray) {
    Write-Host "Downloading Xray-core v26.10.29..."
    $xrayZip = Join-Path $downloadsDir "xray-v26.10.29.zip"
    $xrayUrl = "https://github.com/XTLS/Xray-core/releases/download/v26.10.29/Xray-windows-64.zip"
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 -bor [Net.SecurityProtocolType]::Tls13
    Invoke-WebRequest -Uri $xrayUrl -OutFile $xrayZip -UseBasicParsing
    
    $tempExtract = Join-Path $downloadsDir "xray_temp"
    if (Test-Path $tempExtract) { Remove-Item $tempExtract -Recurse -Force }
    Expand-Archive -Path $xrayZip -DestinationPath $tempExtract -Force
    
    Copy-Item (Join-Path $tempExtract "xray.exe") $xrayExe -Force
    if (Test-Path (Join-Path $tempExtract "geoip.dat")) {
        Copy-Item (Join-Path $tempExtract "geoip.dat") (Join-Path $runtimeDir "geoip.dat") -Force
    }
    if (Test-Path (Join-Path $tempExtract "geosite.dat")) {
        Copy-Item (Join-Path $tempExtract "geosite.dat") (Join-Path $runtimeDir "geosite.dat") -Force
    }
    if (Test-Path (Join-Path $tempExtract "LICENSE")) {
        Copy-Item (Join-Path $tempExtract "LICENSE") (Join-Path $runtimeDir "LICENSE") -Force
    }
    Remove-Item $tempExtract -Recurse -Force
}

if ($needWintun) {
    Write-Host "Downloading Wintun 0.14.1..."
    $wintunZip = Join-Path $downloadsDir "wintun-0.14.1.zip"
    $wintunUrl = "https://www.wintun.net/builds/wintun-0.14.1.zip"
    Invoke-WebRequest -Uri $wintunUrl -OutFile $wintunZip -UseBasicParsing
    
    $tempExtract = Join-Path $downloadsDir "wintun_temp"
    if (Test-Path $tempExtract) { Remove-Item $tempExtract -Recurse -Force }
    Expand-Archive -Path $wintunZip -DestinationPath $tempExtract -Force
    
    Copy-Item (Join-Path $tempExtract "wintun\bin\amd64\wintun.dll") $wintunDll -Force
    if (Test-Path (Join-Path $tempExtract "wintun\LICENSE.txt")) {
        Copy-Item (Join-Path $tempExtract "wintun\LICENSE.txt") (Join-Path $runtimeDir "LICENSE-Wintun") -Force
        Copy-Item (Join-Path $tempExtract "wintun\LICENSE.txt") (Join-Path $runtimeDir "WINTUN-LICENSE.txt") -Force
    }
    Remove-Item $tempExtract -Recurse -Force
}

if (-not (Verify-FileHash $xrayExe $expectedXrayHash)) {
    throw "xray.exe SHA256 checksum verification failed!"
}
if (-not (Verify-FileHash $wintunDll $expectedWintunHash)) {
    throw "wintun.dll SHA256 checksum verification failed!"
}

Write-Host "Runtime verification passed successfully."
