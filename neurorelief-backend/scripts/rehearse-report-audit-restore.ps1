<#
.SYNOPSIS
  End-to-end REHEARSAL of Swap's AUTOMATIC RESTORE after a deliberately failed post-Swap verification.

.DESCRIPTION
  Uses only a disposable fictional database in a temp folder, a dummy `node server.js` on a spare port and (afterwards) the
  real application code started on a COPY of the restored database on another spare port. It never touches the real
  database, the real backup folder or port 8000, never generates a key, and never stops anything it did not start.

  How the failure is produced without changing the production runner: the runner is given -BackendDir pointing at a
  throw-away folder whose scripts\verify-report-audit.js is tests\helpers\failing-verify-wrapper.cjs. The wrapper runs the
  REAL verifier first and forwards its result; it only forces the post-Swap checks (those naming the swapped-in database)
  to fail. A control scenario with the same wrapper and no injection must succeed, proving the wrapper itself is neutral.
#>
$ErrorActionPreference = 'Stop'
$be      = Split-Path -Parent $PSScriptRoot
$runner  = Join-Path $be 'scripts\report-audit-migration.ps1'
$helper  = Join-Path $be 'tests\helpers\rehearsal-db.mjs'
$wrapper = Join-Path $be 'tests\helpers\failing-verify-wrapper.cjs'
$realVerify = Join-Path $be 'scripts\verify-report-audit.js'
$real    = Join-Path $be 'db\neurorelief.db'
$realBefore = (Get-FileHash -LiteralPath $real -Algorithm SHA256).Hash          # only READ, to prove it is unchanged
$listener8000Before = @(Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique)

$root = Join-Path $env:TEMP ('neurorelief-restore-rehearsal-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Force -Path $root | Out-Null
"Rehearsal root: $root"
# the throw-away backend dir used only for -BackendDir (it contains just the wrapper as scripts\verify-report-audit.js)
$pbe = Join-Path $root 'poisoned-backend'; New-Item -ItemType Directory -Force -Path (Join-Path $pbe 'scripts') | Out-Null
Copy-Item -LiteralPath $wrapper -Destination (Join-Path $pbe 'scripts\verify-report-audit.js')

$results = New-Object System.Collections.ArrayList
$usedPorts = New-Object System.Collections.ArrayList
function Check($name, $ok) { [void]$results.Add([pscustomobject]@{ Name = $name; Ok = [bool]$ok }); '{0}  {1}' -f $(if ($ok) { 'PASS' } else { 'FAIL' }), $name }
function Sha($p) { (Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash }
function Same-Bytes($a, $b) { $x = [IO.File]::ReadAllBytes($a); $y = [IO.File]::ReadAllBytes($b); ($x.Length -eq $y.Length) -and [System.Linq.Enumerable]::SequenceEqual($x, $y) }
function Node-Helper([string[]]$a) { Push-Location $be; try { (& node $helper @a | Select-Object -Last 1) } finally { Pop-Location } }
function Run-Runner([string[]]$a) {
  $pi = [array]::IndexOf($a, '-Port'); if ($pi -lt 0 -or $a[$pi + 1] -eq '8000') { throw 'Rehearsal must always pass an explicit non-default -Port.' }
  [void]$usedPorts.Add([string]$a[$pi + 1])
  $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  $o = & powershell -NoProfile -ExecutionPolicy Bypass -File $runner @a 2>&1 | Out-String
  $code = $LASTEXITCODE; $ErrorActionPreference = $old
  [pscustomobject]@{ Code = $code; Out = $o }
}
function Start-Dummy([string]$dir, [int]$port) {
  Set-Content -LiteralPath (Join-Path $dir 'server.js') -Value ("require('http').createServer((q,r)=>r.end('{\""status\"":\""ok\""}')).listen($port)") -Encoding ASCII
  $p = Start-Process -FilePath node -ArgumentList 'server.js' -WorkingDirectory $dir -PassThru -WindowStyle Hidden
  for ($i = 0; $i -lt 30; $i++) { if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) { break }; Start-Sleep -Milliseconds 200 }
  $p
}
function RunId-From($out) { if ($out -match 'RunId: (\d{8}-\d{6})') { $Matches[1] } }

# Starts the REAL application code on a COPY of the given database (never the file itself), proves it works, then stops only that process.
function Test-AppStarts([string]$restoredDb, [int]$port, [string]$dir, [int]$expectedDoctors) {
  $copy = Join-Path $dir 'app-copy.scratch.db'
  Copy-Item -LiteralPath $restoredDb -Destination $copy
  $log = Join-Path $dir 'app.log'
  $saved = @{}; foreach ($k in 'NEURORELIEF_DB_PATH', 'PORT', 'REPORT_MASTER_KEY', 'REPORT_MASTER_KEY_FILE') { $saved[$k] = [Environment]::GetEnvironmentVariable($k, 'Process') }
  $env:NEURORELIEF_DB_PATH = $copy; $env:PORT = [string]$port; Remove-Item Env:\REPORT_MASTER_KEY -ErrorAction SilentlyContinue; Remove-Item Env:\REPORT_MASTER_KEY_FILE -ErrorAction SilentlyContinue
  [void]$usedPorts.Add([string]$port)
  $app = $null
  $out = [ordered]@{ Started = $false; Health = 0; Doctors = -1; FixtureDoctor = $false; Registered = $false; Status = ''; Banner = ''; Stopped = $false; Error = '' }
  try {
    $app = Start-Process -FilePath node -ArgumentList 'server.js' -WorkingDirectory $be -PassThru -WindowStyle Hidden -RedirectStandardOutput $log -RedirectStandardError ($log + '.err')
    for ($i = 0; $i -lt 40; $i++) { if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) { $out.Started = $true; break }; Start-Sleep -Milliseconds 250 }
    if ($out.Started) {
      $base = "http://127.0.0.1:$port/api"
      $out.Health = (Invoke-WebRequest "$base/health" -UseBasicParsing).StatusCode
      # Windows PowerShell 5.1 returns a JSON array from Invoke-RestMethod as ONE nested object; piping through ForEach-Object unrolls it
      $docs = @(Invoke-RestMethod "$base/doctors" | ForEach-Object { $_ }); $out.Doctors = $docs.Count; $out.FixtureDoctor = [bool]($docs | Where-Object { $_.name -like 'Dr. Fixture*' })
      $reg = Invoke-RestMethod "$base/auth/register" -Method Post -ContentType 'application/json' -Body (@{ name = 'Rehearsal Patient'; email = 'rehearsal@fixture.invalid'; password = 'Rehearsal-Only-1!' } | ConvertTo-Json)
      $out.Registered = [bool]$reg.token
      $st = Invoke-RestMethod "$base/reports/status" -Headers @{ Authorization = ('Bearer ' + $reg.token) }
      $out.Status = ($st | ConvertTo-Json -Compress)
      $out.Banner = (Select-String -Path $log -Pattern 'Report Audit key: (\w+)' | ForEach-Object { $_.Matches[0].Groups[1].Value } | Select-Object -First 1)
    }
  } catch {
    $out.Error = $_.Exception.Message          # recorded (and shown) instead of aborting the whole rehearsal
    Write-Host ('  app check problem: ' + $out.Error)
  } finally {
    if ($app) { Stop-Process -Id $app.Id -Force -ErrorAction SilentlyContinue; Start-Sleep -Milliseconds 700; $out.Stopped = -not (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) }
    foreach ($k in $saved.Keys) { [Environment]::SetEnvironmentVariable($k, $saved[$k], 'Process') }
  }
  [pscustomobject]$out
}

function Run-Scenario([string]$name, [string]$mode, [int]$basePort) {
  "`n--- $name"
  $dir = Join-Path $root ($name -replace '[^A-Za-z0-9]+', '-'); $off = Join-Path $dir 'off'; $dbDir = Join-Path $dir 'db'
  $db = Join-Path $dbDir 'restore-test.scratch.db'
  New-Item -ItemType Directory -Force -Path $dbDir, $off | Out-Null
  Push-Location $be; try { & node $helper make $db | Out-Null } finally { Pop-Location }
  if ($db -ieq $real -or $off -like "$env:LOCALAPPDATA\NeuroRelief*") { throw 'Refusing: rehearsal paths point at the real ones.' }
  $snapshot = Join-Path $dir 'original-snapshot.bin'; Copy-Item -LiteralPath $db -Destination $snapshot     # independent byte-for-byte reference
  $orig = Sha $db; $origInfo = Node-Helper @('inspect', $db) | ConvertFrom-Json
  $srv = Start-Dummy $dir $basePort
  $base = @('-DatabasePath', $db, '-OffDir', $off, '-Port', [string]$basePort)

  $r = Run-Runner (@('-Stage', 'Prepare') + $base); $id = RunId-From $r.Out
  $state = Get-Content -LiteralPath (Join-Path $off "work\$id\state.json") -Raw | ConvertFrom-Json
  Check 'Prepare ok; the prepared copy has both migrations and verifies' (($r.Code -eq 0) -and ($r.Out -match 'RESULT: all \d+ checks passed'))

  # Swap, using the throw-away backend dir (wrapper verifier). Injection settings travel in the environment of this call only.
  $env:NR_REAL_VERIFY = $realVerify; $env:NR_FAIL_DB = $db; $env:NR_FAIL_MODE = $mode
  try { $s = Run-Runner (@('-Stage', 'Swap', '-RunId', $id, '-Approve', '-ConfirmPid', [string]$srv.Id, '-BackendDir', $pbe) + $base) }
  finally { Remove-Item Env:\NR_REAL_VERIFY, Env:\NR_FAIL_DB, Env:\NR_FAIL_MODE -ErrorAction SilentlyContinue }
  $srv.Refresh()
  Check 'the identified dummy backend was stopped by Swap (and only that process)' ($srv.HasExited)

  if ($mode) {
    Check 'Swap FAILED (exit 1) because of the injected post-swap verification failure' (($s.Code -eq 1) -and ($s.Out -match 'INJECTED FAILURE'))
    Check 'Swap printed PROBLEM, then "Restoring the backup...", then restore verification' (($s.Out -match 'PROBLEM: ') -and ($s.Out -match 'Restoring the backup\.\.\.') -and ($s.Out -match 'Database restored from the backup and verified \(hash matches\)'))
    Check 'Swap reported "Swap rolled back; the original database is back in place."' ($s.Out -match 'Swap rolled back; the original database is back in place')
    Check 'Swap did NOT report "Swap complete"' ($s.Out -notmatch 'Swap complete')
    Check 'database SHA-256 equals the original' ((Sha $db) -eq $orig)
    Check 'database is BYTE-FOR-BYTE identical to the independent snapshot of the original' (Same-Bytes $db $snapshot)
    Check 'database is NOT the migrated copy (the swap was undone)' ((Sha $db) -ne $state.migratedSha256)
    $after = Node-Helper @('inspect', $db) | ConvertFrom-Json
    Check 'restored database: integrity ok, no report tables, same table/user/doctor/appointment counts as before' (($after.integrity -eq 'ok') -and ($after.reportTables -eq 0) -and ($after.tables -eq $origInfo.tables) -and ($after.users -eq $origInfo.users) -and ($after.doctorProfiles -eq $origInfo.doctorProfiles) -and ($after.appointments -eq $origInfo.appointments))
    Check 'no staging files left in the database folder' (-not (Test-Path (Join-Path $dbDir 'neurorelief-migrated.db')) -and -not (Test-Path (Join-Path $dbDir 'neurorelief-restore.db')))
  } else {
    Check 'CONTROL (wrapper, no injection): Swap succeeds' (($s.Code -eq 0) -and ($s.Out -match 'Swap complete'))
    Check 'CONTROL: database equals the verified migrated copy' ((Sha $db) -eq $state.migratedSha256)
  }
  $bk = Get-Item -LiteralPath $state.backupPath
  Check 'backup still present, READ-ONLY, hash identical to the recorded hash and to the original' ($bk.IsReadOnly -and ((Sha $bk.FullName) -eq $state.backupSha256) -and ((Sha $bk.FullName) -eq $orig))
  Check 'Swap reported the backup as preserved' ($s.Out -match 'Backup preserved: not deleted, not modified')
  Check 'the prepared migrated copy is still present (nothing was cleaned up behind the user)' (Test-Path -LiteralPath $state.migratedCopyPath)

  if ($mode) {
    $pre = Sha $db
    $app = Test-AppStarts $db ($basePort + 100) $dir $origInfo.doctorProfiles
    Check "application code starts on a copy of the RESTORED database (port $($basePort + 100))" ($app.Started -and $app.Health -eq 200)
    Check 'application serves the restored data (doctor profiles match, fixture doctor present)' (($app.Doctors -eq $origInfo.doctorProfiles) -and $app.FixtureDoctor)
    Check 'application accepts a new registration and answers /api/reports/status (feature off: no key, no tables)' ($app.Registered -and ($app.Status -match '"enabled":false'))
    Check 'application reported the report key as missing (feature disabled, not enabled by accident)' ($app.Banner -eq 'missing')
    Check 'the application process was stopped again; the restored file itself was not touched by it' ($app.Stopped -and ((Sha $db) -eq $pre) -and ((Sha $db) -eq $orig))
  }
  Get-Process node -ErrorAction SilentlyContinue | Where-Object { $_.Id -eq $srv.Id } | Stop-Process -Force -ErrorAction SilentlyContinue
}

Run-Scenario 'Control no injection' '' 8093
Run-Scenario 'Injected failure at migration-record check' 'migrations' 8092
Run-Scenario 'Injected failure at full verification' 'full' 8091
Run-Scenario 'Injected failure at both post-swap checks' 'both' 8090

"`n--- Invariants"
$realAfter = (Get-FileHash -LiteralPath $real -Algorithm SHA256).Hash
Check 'REAL database content hash identical before and after the rehearsal' ($realAfter -eq $realBefore)
Check 'the real backend listener on port 8000 is the same process as before and still listening' ((@(Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique) -join ',') -eq ($listener8000Before -join ','))
Check ('port 8000 was never passed to the runner or the app; ports used: ' + (($usedPorts | Sort-Object -Unique) -join ', ')) (($usedPorts.Count -gt 0) -and ($usedPorts -notcontains '8000'))
Check 'no key file or secrets folder was created' (-not (Test-Path (Join-Path $env:LOCALAPPDATA 'NeuroRelief\secrets')))
$realBackups = @(Get-ChildItem -LiteralPath (Join-Path $env:LOCALAPPDATA 'NeuroRelief\backups') -Filter '*.db' | Where-Object { $_.LastWriteTime -gt (Get-Date).AddMinutes(-30) })
Check 'the real backup folder received no new backup during the rehearsal' ($realBackups.Count -eq 0)

$bad = @($results | Where-Object { -not $_.Ok })
''; ('RESULT: {0} checks, {1} failed' -f $results.Count, $bad.Count)
"Rehearsal artifacts left in: $root"
if ($bad.Count) { exit 1 } else { exit 0 }
