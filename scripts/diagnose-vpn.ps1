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
# A successful TLS handshake is not enough: an unrelated 404/500 route
# must not be labeled as a healthy authenticated API.
$apiReachable = $curlExit -eq 0 -and $httpCode -in @('401', '403')
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

# Inspect actual OS routes only when a ByMeVPN adapter is up. These checks
# are read-only and never modify the routing table or DNS configuration.
$activeTun = @($tunAdapters | Where-Object { $_.Status -eq 'Up' })
foreach ($adapter in $activeTun) {
    $routes = @(Get-NetRoute -InterfaceIndex $adapter.ifIndex -ErrorAction SilentlyContinue)
    $ipv4Default = @($routes | Where-Object { $_.DestinationPrefix -eq '0.0.0.0/0' })
    $ipv4Split = @($routes | Where-Object { $_.DestinationPrefix -eq '0.0.0.0/1' })
    $ipv4SplitOther = @($routes | Where-Object { $_.DestinationPrefix -eq '128.0.0.0/1' })
    $ipv4Covered = $ipv4Default.Count -gt 0 -or ($ipv4Split.Count -gt 0 -and $ipv4SplitOther.Count -gt 0)
    Write-Check 'IPv4 TUN routes' $(if ($ipv4Covered) { 'PASS' } else { 'FAIL' }) $(if ($ipv4Covered) { "default or split-default route through $($adapter.Name)" } else { "missing default route through $($adapter.Name); traffic may bypass the VPN" })
    $actual = @(Find-NetRoute -RemoteIPAddress '9.9.9.9' -ErrorAction SilentlyContinue |
        Where-Object { $_.PSObject.Properties.Name -contains 'DestinationPrefix' } |
        Select-Object -First 1)
    $selectedTun = $actual.Count -gt 0 -and $actual[0].InterfaceIndex -eq $adapter.ifIndex
    Write-Check 'Windows actual IPv4 route' $(if (!$actual.Count) { 'WARN' } elseif ($selectedTun) { 'PASS' } else { 'FAIL' }) $(if (!$actual.Count) { 'route selection could not be determined' } elseif ($selectedTun) { "Windows selects $($adapter.Name) for public IPv4" } else { "Windows selects another adapter, not $($adapter.Name); VPN routes are present but not effective" })

    $ipv6Default = @($routes | Where-Object { $_.DestinationPrefix -eq '::/0' })
    $ipv6SplitA = @($routes | Where-Object { $_.DestinationPrefix -eq '::/1' })
    $ipv6SplitB = @($routes | Where-Object { $_.DestinationPrefix -eq '8000::/1' })
    $ipv6Covered = $ipv6Default.Count -gt 0 -or ($ipv6SplitA.Count -gt 0 -and $ipv6SplitB.Count -gt 0)
    Write-Check 'IPv6 TUN routes' $(if ($ipv6Covered) { 'PASS' } else { 'WARN' }) $(if ($ipv6Covered) { "IPv6 default route through $($adapter.Name)" } else { "no IPv6 default route through $($adapter.Name); verify whether IPv6 is blocked or can bypass" })

    $dnsServers = @(Get-DnsClientServerAddress -InterfaceIndex $adapter.ifIndex -ErrorAction SilentlyContinue | ForEach-Object { $_.ServerAddresses } | Where-Object { $_ })
    Write-Check 'TUN DNS configuration' $(if ($dnsServers.Count) { 'PASS' } else { 'WARN' }) $(if ($dnsServers.Count) { ($dnsServers -join ', ') } else { "no Windows DNS servers reported on $($adapter.Name); inspect Xray DNS and WFP" })
}

$appData = Join-Path $env:APPDATA 'space.parahin.bymevpn.desktop'
$startupLog = Join-Path $appData 'xray_startup.log'
if (Test-Path -LiteralPath $startupLog -PathType Leaf) {
    $log = Get-Item -LiteralPath $startupLog
    Write-Check 'Xray startup log' 'PASS' ("present, {0} bytes, updated {1:u}" -f $log.Length, $log.LastWriteTime)
} else {
    Write-Check 'Xray startup log' 'WARN' 'not present yet; start one connection attempt in the app to create it'
}

Write-Output 'This diagnostic sends no account credentials and does not change routes or start a VPN.'
