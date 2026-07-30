$ErrorActionPreference = 'Stop'
$catalogPath = Join-Path $PSScriptRoot '..\src-tauri\Resources\catalog.json'
if (-not (Test-Path $catalogPath)) { Write-Host "Catalog not found: $catalogPath"; exit 1 }
$catalog = Get-Content $catalogPath -Raw | ConvertFrom-Json
$downloadDir = Join-Path $PSScriptRoot 'tmp_catalog_downloads'
Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $downloadDir
New-Item -ItemType Directory -Path $downloadDir | Out-Null
$maxBytes = 300MB

function TryResolve([string]$url) {
    Write-Host "Resolving: $url"
    # get headers
    $headers = ''
    try { $headers = & curl.exe -sI -L --max-redirs 10 "$url" 2>$null } catch { $headers = '' }
    $cl = 0
    if ($headers) {
        $m = ($headers -split "\r?\n") | Where-Object { $_ -match '^Content-Length:' } | Select-Object -First 1
        if ($m) { $cl = [int64]($m -replace 'Content-Length:\s*','') }
    }
    if ($cl -gt $maxBytes) { return @{ ok = $false; reason = 'content-length-exceeds'; size = $cl } }
    $final = ''
    try { $final = & curl.exe -sSL -o $null -w "%{url_effective}" "$url" 2>$null } catch { $final = $url }
    if (-not $final) { $final = $url }
    $fileName = Join-Path $downloadDir ([System.IO.Path]::GetRandomFileName())
    try {
        Write-Host "Downloading to $fileName ..."
        & curl.exe -sSL -f -o "$fileName" "$final" --max-redirs 10 --connect-timeout 20 --retry 2 --retry-delay 2
        $hash = (Get-FileHash -Algorithm SHA256 $fileName).Hash.ToLower()
        $size = (Get-Item $fileName).Length
        return @{ ok = $true; final = $final; path = $fileName; sha256 = $hash; size = $size }
    } catch {
        return @{ ok = $false; reason = 'download-failed'; err = $_.Exception.Message }
    }
}

for ($i = 0; $i -lt $catalog.apps.Count; $i++) {
    $app = $catalog.apps[$i]
    foreach ($os in @('windows','macos','linux')) {
        if ($app.targets.PSObject.Properties.Name -contains $os) {
            $target = $app.targets.$os
            if (-not $target) { continue }
            $url = $target.url
            if ($url -and $url -notmatch 'REPLACE-ME') { Write-Host "Skipping (already set): $($app.id) $os -> $url"; continue }
            $candidates = @()
            if ($app.homepage) { $candidates += "$($app.homepage.TrimEnd('/'))/download"; $candidates += $app.homepage }
            if ($url) { $candidates += $url }
            $resolved = $null
            foreach ($cand in $candidates | Select-Object -Unique) {
                Write-Host "Trying candidate: $cand"
                $res = TryResolve $cand
                if ($res.ok) { $resolved = $res; break } else { Write-Host "Candidate failed: $($res.reason)"; if ($res.err) { Write-Host $res.err } }
            }
            if ($resolved) {
                Write-Host "Resolved $($app.id) $os -> $($resolved.final) (sha256: $($resolved.sha256))"
                $catalog.apps[$i].targets.$os.url = $resolved.final
                    # ensure sha256 property exists and set it
                    if ($catalog.apps[$i].targets.$os.PSObject.Properties.Name -contains 'sha256') {
                        $catalog.apps[$i].targets.$os.sha256 = $resolved.sha256
                    } else {
                        $null = $catalog.apps[$i].targets.$os | Add-Member -NotePropertyName 'sha256' -NotePropertyValue $resolved.sha256 -Force
                    }
            } else {
                Write-Host "Could not resolve $($app.id) $os; manual action required."
            }
        }
    }
}
# write back catalog
$catalog | ConvertTo-Json -Depth 10 | Out-File -Encoding UTF8 $catalogPath
Write-Host 'Done. Updated catalog at' $catalogPath
Write-Host 'Download temp dir:' $downloadDir
