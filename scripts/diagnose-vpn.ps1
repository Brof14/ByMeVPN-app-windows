param(
    [string]$InstallDirectory = "$env:ProgramFiles\ByMeVPN"
)

$ErrorActionPreference = 'SilentlyContinue'

function Write-Check([string]$Name, [string]$State, [string]$Detail) {
    if ($State -notin @('PASS', 'WARN', 'FAIL')) { throw "Invalid check state: $State" }
    Write-Output ("[{0}] {1}: {2}" -f $State, $Name, $Detail)
}

function Write-Pass([string]$Name, [bool]$Passed, [string]$Detail) {
    Write-Check $Name $(if ($Passed) { 'PASS' } else { 'FAIL' }) $Detail
}

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
$isElevated = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
Write-Check 'elevation' $(if ($isElevated) { 'PASS' } else { 'WARN' }) $(if ($isElevated) { 'elevated process' } else { 'not elevated; Windows TUN routing cannot be validated' })

$runtime = Join-Path $InstallDirectory 'vendor\runtime\windows-x64'
$xray = Join-Path $runtime 'xray.exe'
$wintun = Join-Path $runtime 'wintun.dll'
$runtimePresent = (Test-Path -LiteralPath $xray -PathType Leaf) -and (Test-Path -LiteralPath $wintun -PathType Leaf)
Write-Pass 'runtime files' $runtimePresent $(if ($runtimePresent) { $runtime } else { "missing Xray or Wintun under $runtime" })

if (Test-Path -LiteralPath $xray -PathType Leaf) {
    $xrayOutput = & $xray version 2>&1
    $xrayExit = $LASTEXITCODE
    $xrayVersion = ($xrayOutput | Select-Object -First 1).ToString()
    Write-Pass 'Xray runtime' ($xrayExit -eq 0) $xrayVersion
}

if (Test-Path -LiteralPath $wintun -PathType Leaf) {
    $wintunHash = (Get-FileHash -LiteralPath $wintun -Algorithm SHA256).Hash.ToLowerInvariant()
    $wintunValid = $wintunHash -eq 'e5da8447dc2c320edc0fc52fa01885c103de8c118481f683643cacc3220dafce'
    Write-Pass 'Wintun integrity' $wintunValid $(if ($wintunValid) { 'SHA-256 matches pinned Wintun 0.14.1' } else { 'SHA-256 mismatch' })
}

$apiHost = 'bymevpn.duckdns.org'
$apiUrl = "https://$apiHost/api/v1/servers"
$dns = Resolve-DnsName $apiHost -Type A | Where-Object Type -eq 'A' | Select-Object -First 1
Write-Pass 'API DNS' ([bool]$dns) $(if ($dns) { "A record resolved to $($dns.IPAddress)" } else { 'DNS lookup failed' })

$httpCode = & curl.exe --silent --show-error --output NUL --max-time 10 --connect-timeout 4 --proto '=https' --write-out '%{http_code}' $apiUrl 2>$null
$curlExit = $LASTEXITCODE
$apiReachable = $curlExit -eq 0 -and $httpCode -match '^\d{3}$' -and $httpCode -ne '000'
Write-Pass 'API HTTPS' $apiReachable $(if ($apiReachable) { "HTTP $httpCode (401/403 is expected without login)" } else { "TLS/HTTP failed (curl exit $curlExit, status $httpCode)" })

# Read-only, unauthenticated health endpoint on the backend's documented local
# service port. This does not authorize using HTTP for account/API requests.
$healthUrl = "http://${apiHost}:8080/readyz"
$healthCode = & curl.exe --silent --show-error --output NUL --max-time 6 --connect-timeout 3 --proto '=http' --write-out '%{http_code}' $healthUrl 2>$null
$healthExit = $LASTEXITCODE
$healthOk = $healthExit -eq 0 -and $healthCode -eq '200'
Write-Check 'Backend health (HTTP only)' $(if ($healthOk) { 'PASS' } else { 'WARN' }) $(if ($healthOk) { 'read-only /readyz returned HTTP 200 on port 8080; credentials are never sent here' } else { "not confirmed (curl exit $healthExit, status $healthCode)" })
$routeUrl = "http://${apiHost}:8080/api/v1/servers"
$routeCode = & curl.exe --silent --show-error --output NUL --max-time 6 --connect-timeout 3 --proto '=http' --write-out '%{http_code}' $routeUrl 2>$null
$routeExit = $LASTEXITCODE
$routeOk = $routeExit -eq 0 -and $routeCode -eq '401'
Write-Check 'Backend API route (HTTP only)' $(if ($routeOk) { 'PASS' } else { 'WARN' }) $(if ($routeOk) { 'unauthenticated GET returned HTTP 401 as expected; no credentials were sent' } else { "route not confirmed (curl exit $routeExit, status $routeCode)" })

$tunAdapters = @(Get-NetAdapter -IncludeHidden | Where-Object {
    $_.Name -match 'ByMeVPN' -or $_.InterfaceDescription -match 'ByMeVPN|Wintun Tunnel'
})
Write-Check 'TUN adapter' $(if ($tunAdapters.Count) { 'PASS' } else { 'WARN' }) $(if ($tunAdapters.Count) { ($tunAdapters | ForEach-Object { "$($_.Name) [$($_.Status)]" }) -join ', ' } else { 'no ByMeVPN TUN adapter found; connect first to inspect routes' })

$appData = Join-Path $env:APPDATA 'space.parahin.bymevpn.desktop'
$startupLog = Join-Path $appData 'xray_startup.log'
if (Test-Path -LiteralPath $startupLog -PathType Leaf) {
    $log = Get-Item -LiteralPath $startupLog
    Write-Check 'Xray startup log' 'PASS' ("present, {0} bytes, updated {1:u}" -f $log.Length, $log.LastWriteTime)
} else {
    Write-Check 'Xray startup log' 'WARN' 'not present yet; start one connection attempt in the app to create it'
}

Write-Output 'This diagnostic sends no account credentials and does not change routes or start a VPN.'
