<#
.SYNOPSIS
  End-to-end REHEARSAL of scripts\report-audit-migration.ps1 against a DISPOSABLE fictional database in a temp folder.

.DESCRIPTION
  Never touches the real database or the real backup folder: the database, the off-OneDrive directory and every port are
  disposable, and the script aborts if any of them points at the real ones. A dummy `node server.js` stands in for the
  backend. Exercises Prepare, Swap (every refusal path), Rollback and the new migration-record guards, and proves that no
  backup is ever deleted. Prints PASS/FAIL per check and exits 1 if any check fails.
#>
$ErrorActionPreference = 'Stop'
$be     = Split-Path -Parent $PSScriptRoot
$script = Join-Path $be 'scripts\report-audit-migration.ps1'
$helper = Join-Path $be 'tests\helpers\rehearsal-db.mjs'
$real   = Join-Path $be 'db\neurorelief.db'
$realBefore = (Get-FileHash -LiteralPath $real -Algorithm SHA256).Hash          # only READ, to prove it is unchanged

$rd  = Join-Path $env:TEMP ('neurorelief-rehearsal-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
$off = Join-Path $rd 'off'; $db = Join-Path $rd 'db\neurorelief.db'
New-Item -ItemType Directory -Force -Path (Split-Path $db), $off | Out-Null
Push-Location $be; try { & node $helper make $db | Out-Null } finally { Pop-Location }
if ($db -ieq $real -or $off -like "$env:LOCALAPPDATA\NeuroRelief*") { throw 'Refusing: rehearsal paths point at the real ones.' }
"Rehearsal dir: $rd"

$results = New-Object System.Collections.ArrayList
$usedPorts = New-Object System.Collections.ArrayList
function Check($name, $ok) { [void]$results.Add([pscustomobject]@{ Name = $name; Ok = [bool]$ok }); '{0}  {1}' -f $(if ($ok) { 'PASS' } else { 'FAIL' }), $name }
function Sha($p) { (Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash }
function Run-Stage([string[]]$a) {
  if (($a -notcontains '-Port') -or ($a[[array]::IndexOf($a, '-Port') + 1] -eq '8000')) { throw 'Rehearsal must always pass an explicit non-default -Port.' }
  [void]$script:usedPorts.Add([string]$a[[array]::IndexOf($a, '-Port') + 1])      # every port the rehearsal ever passes to the runner
  $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  $o = & powershell -NoProfile -ExecutionPolicy Bypass -File $script @a 2>&1 | Out-String
  $code = $LASTEXITCODE; $ErrorActionPreference = $old
  [pscustomobject]@{ Code = $code; Out = $o }
}
function Start-Dummy([string]$file, [int]$port) {
  Set-Content -LiteralPath (Join-Path $rd $file) -Value ("require('http').createServer((q,r)=>r.end('{\""status\"":\""ok\""}')).listen($port)") -Encoding ASCII
  $p = Start-Process -FilePath node -ArgumentList $file -WorkingDirectory $rd -PassThru -WindowStyle Hidden
  for ($i = 0; $i -lt 30; $i++) { if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) { break }; Start-Sleep -Milliseconds 200 }
  $p
}
function RunId-From($out) { if ($out -match 'RunId: (\d{8}-\d{6})') { $Matches[1] } }
function Tamper($file, $how) { Push-Location $be; try { (& node $helper tamper $file $how | Select-Object -Last 1) } finally { Pop-Location } }
function Read-State($id) { Get-Content -LiteralPath (Join-Path $off "work\$id\state.json") -Raw | ConvertFrom-Json }
function Write-State($id, $s) { $s | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $off "work\$id\state.json") -Encoding ASCII }
$base = @('-DatabasePath', $db, '-OffDir', $off)
$allBackups = New-Object System.Collections.ArrayList     # (path, hash) of every backup Prepare creates; all must survive to the end

# ---------- Scenario 1: happy path, then Rollback preserves the backup ----------
'--- Scenario 1: Prepare -> Swap -> Rollback (backup preserved)'
$srv = Start-Dummy 'server.js' 8099
$orig = Sha $db
$r = Run-Stage (@('-Stage', 'Prepare', '-Port', '8099') + $base)
Check 'Prepare exits 0' ($r.Code -eq 0)
$id = RunId-From $r.Out; $state = Read-State $id; [void]$allBackups.Add(@($state.backupPath, $state.backupSha256))
Check 'Prepare checked BOTH migration records in the copy' ($r.Out -match 'Both migrations \(report-audit-001 and report-audit-002\) must be recorded exactly once')
Check 'Prepare verification includes migration-002 definition and trigger-behaviour checks' (($r.Out -match 'definitions of all 30 Report Audit') -and ($r.Out -match 'smoke: a share tied to a PENDING appointment is refused') -and ($r.Out -notmatch 'FAIL'))
Check 'Prepare changed nothing real (db hash identical) and left the dummy backend running' (((Sha $db) -eq $orig) -and -not $srv.HasExited)
Check 'backup exists, is read-only, hash equals original' ((Test-Path $state.backupPath) -and (Get-Item $state.backupPath).IsReadOnly -and (Sha $state.backupPath) -eq $orig)
$r = Run-Stage (@('-Stage', 'Swap', '-RunId', $id, '-Port', '8099', '-Approve', '-ConfirmPid', [string]$srv.Id) + $base)
$srv.Refresh()
Check 'Swap with the correct pid succeeds' ($r.Code -eq 0)
Check 'Swap verified migration records before stopping anything, and again after the swap' (($r.Out -match 'checked BEFORE anything is stopped') -and ($r.Out -match 'database: migration report-audit-001 recorded exactly once') -and ($r.Out -match 'database: migration report-audit-002 recorded exactly once'))
Check 'Swap reported the backup as preserved' ($r.Out -match 'Backup preserved: not deleted, not modified')
Check 'database now equals the verified migrated copy; the identified process was stopped' (((Sha $db) -eq $state.migratedSha256) -and $srv.HasExited)
Check 'backup still exists, unchanged, after Swap' ((Test-Path $state.backupPath) -and (Sha $state.backupPath) -eq $orig)
$r = Run-Stage (@('-Stage', 'Rollback', '-RunId', $id, '-Port', '8099') + $base)
Check 'Rollback without -Approve is refused and the backup is untouched' (($r.Code -eq 1) -and (Sha $db) -eq $state.migratedSha256 -and (Test-Path $state.backupPath))
$r = Run-Stage (@('-Stage', 'Rollback', '-RunId', $id, '-Port', '8099', '-Approve') + $base)
Check 'Rollback restores the original database (hash identical)' (($r.Code -eq 0) -and (Sha $db) -eq $orig)
Check 'Rollback checked the backup first and reported it preserved' (($r.Out -match 'COPIED to the database path') -and ($r.Out -match 'Backup preserved: not deleted, not modified'))
Check 'AFTER Rollback the backup file still exists, is still read-only, hash unchanged' ((Test-Path $state.backupPath) -and (Get-Item $state.backupPath).IsReadOnly -and (Sha $state.backupPath) -eq $orig)
$r = Run-Stage (@('-Stage', 'Rollback', '-RunId', $id, '-Port', '8099', '-Approve') + $base)
Check 'A second Rollback also works and still leaves the backup in place' (($r.Code -eq 0) -and (Test-Path $state.backupPath) -and (Sha $state.backupPath) -eq $orig)

# ---------- Scenario 2: migration records defective in a prepared copy -> Swap refuses BEFORE stopping anything ----------
'--- Scenario 2: a prepared copy with a missing / duplicated / unexpected migration record'
foreach ($how in @('drop002', 'drop001', 'dup001', 'extra')) {
  Start-Sleep -Seconds 1
  $srvB = Start-Dummy 'server.js' 8098
  $r = Run-Stage (@('-Stage', 'Prepare', '-Port', '8098') + $base); $idB = RunId-From $r.Out; $sB = Read-State $idB; [void]$allBackups.Add(@($sB.backupPath, $sB.backupSha256))
  $before = Sha $db
  $newHash = Tamper $sB.migratedCopyPath $how                      # a defective copy whose recorded hash is made consistent, so only the guard can catch it
  $sB.migratedSha256 = $newHash; Write-State $idB $sB
  $r = Run-Stage (@('-Stage', 'Swap', '-RunId', $idB, '-Port', '8098', '-Approve', '-ConfirmPid', [string]$srvB.Id) + $base)
  $srvB.Refresh()
  Check ("Swap REFUSES a copy with defect '$how' (exit 1, explicit message)") (($r.Code -eq 1) -and ($r.Out -match 'A required migration is missing, recorded more than once, or an unexpected one is recorded'))
  Check ("  ...'$how': nothing was stopped, the database is unchanged, the backup is intact") ((-not $srvB.HasExited) -and ((Sha $db) -eq $before) -and (Test-Path $sB.backupPath) -and ((Sha $sB.backupPath) -eq $sB.backupSha256))
  Stop-Process -Id $srvB.Id -Force -ErrorAction SilentlyContinue; Start-Sleep -Milliseconds 600
}

# ---------- Scenario 3: stale backup, tampered artifacts, wrong listener, no listener, -Identify ----------
'--- Scenario 3: stale backup / tampered artifacts'
Start-Sleep -Seconds 1
$srv3 = Start-Dummy 'server.js' 8097
$r = Run-Stage (@('-Stage', 'Prepare', '-Port', '8097') + $base); $id3 = RunId-From $r.Out; $s3 = Read-State $id3; [void]$allBackups.Add(@($s3.backupPath, $s3.backupSha256))
$bytes = [System.IO.File]::ReadAllBytes($db); [System.IO.File]::WriteAllBytes($db, $bytes + [byte]0); $changed = Sha $db
$r = Run-Stage (@('-Stage', 'Swap', '-RunId', $id3, '-Port', '8097', '-Approve', '-ConfirmPid', [string]$srv3.Id) + $base); $srv3.Refresh()
Check 'Swap aborts when the database changed after the backup; database untouched' (($r.Code -eq 1) -and ($r.Out -match 'changed after the backup') -and (Sha $db) -eq $changed)
[System.IO.File]::WriteAllBytes($db, $bytes)
Stop-Process -Id $srv3.Id -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1
$r = Run-Stage (@('-Stage', 'Prepare', '-Port', '8097') + $base); $id3b = RunId-From $r.Out; $s3b = Read-State $id3b; [void]$allBackups.Add(@($s3b.backupPath, $s3b.backupSha256)); $o3 = Sha $db
$m = [System.IO.File]::ReadAllBytes($s3b.migratedCopyPath); [System.IO.File]::WriteAllBytes($s3b.migratedCopyPath, $m + [byte]1)
$r = Run-Stage (@('-Stage', 'Swap', '-RunId', $id3b, '-Port', '8097', '-Approve') + $base)
Check 'Swap aborts when the migrated copy no longer matches its recorded hash' (($r.Code -eq 1) -and ($r.Out -match 'migrated copy no longer matches') -and (Sha $db) -eq $o3)
Set-ItemProperty -LiteralPath $s3b.backupPath -Name IsReadOnly -Value $false
[System.IO.File]::WriteAllBytes($s3b.backupPath, [System.IO.File]::ReadAllBytes($s3b.backupPath) + [byte]1)
$r = Run-Stage (@('-Stage', 'Rollback', '-RunId', $id3b, '-Port', '8097', '-Approve') + $base)
Check 'Rollback refuses a tampered backup, leaves the database alone and does NOT delete the backup file' (($r.Code -eq 1) -and ($r.Out -match 'no longer matches') -and (Sha $db) -eq $o3 -and (Test-Path $s3b.backupPath))
$allBackups.RemoveAt($allBackups.Count - 1)    # this one was tampered with on purpose; its survival was checked above
Start-Sleep -Seconds 1
$r = Run-Stage (@('-Stage', 'Prepare', '-Port', '8096') + $base); $id4 = RunId-From $r.Out; $s4 = Read-State $id4; [void]$allBackups.Add(@($s4.backupPath, $s4.backupSha256))
$other = Start-Dummy 'other.js' 8096
$r = Run-Stage (@('-Stage', 'Swap', '-RunId', $id4, '-Port', '8096', '-Approve', '-ConfirmPid', [string]$other.Id) + $base)
Check 'Swap refuses to stop a listener that is not "node ... server.js"' (($r.Code -eq 1) -and ($r.Out -match 'not a "node') -and -not $other.HasExited -and (Sha $db) -eq $o3)
Stop-Process -Id $other.Id -Force
$srv5 = Start-Dummy 'server.js' 8095
$r = Run-Stage (@('-Stage', 'Swap', '-RunId', $id4, '-Port', '8095', '-Identify') + $base)
Check '-Identify changes and stops nothing' (($r.Code -eq 0) -and (-not $srv5.HasExited) -and ((Sha $db) -eq $o3) -and ($r.Out -match 'Nothing was stopped or changed'))
$r = Run-Stage (@('-Stage', 'Swap', '-RunId', $id4, '-Port', '8095', '-Approve') + $base)
Check 'Swap without -ConfirmPid stops nothing' (($r.Code -eq 1) -and ($r.Out -match 'Re-run with -ConfirmPid') -and -not $srv5.HasExited -and (Sha $db) -eq $o3)
Stop-Process -Id $srv5.Id -Force -ErrorAction SilentlyContinue
$r = Run-Stage (@('-Stage', 'Swap', '-RunId', $id4, '-Port', '8094', '-Approve') + $base)
Check 'Swap works when nothing listens on the port' (($r.Code -eq 0) -and ($r.Out -match 'Nothing is listening'))

# ---------- Scenario 4: invariants ----------
'--- Scenario 4: invariants'
$missing = @($allBackups | Where-Object { -not (Test-Path -LiteralPath $_[0]) -or ((Sha $_[0]) -ne $_[1]) })
Check ("EVERY backup created during the rehearsal ($($allBackups.Count)) still exists with its recorded hash") ($missing.Count -eq 0)
Check 'no backup file with a REJECTED suffix was produced (no failed backups)' (-not (Get-ChildItem -Path (Join-Path $off 'backups') -Filter '*.REJECTED' -ErrorAction SilentlyContinue))
$realAfter = (Get-FileHash -LiteralPath $real -Algorithm SHA256).Hash
Check 'REAL database content hash identical before and after the rehearsal' ($realAfter -eq $realBefore)
Check 'rehearsal never used the real db path or the real backup folder' (-not (Select-String -Path (Join-Path $off 'work\*\state.json') -Pattern 'neurorelief-backend|NeuroRelief\\backups' -Quiet))
Check ('port 8000 (the live backend) was never passed to the runner; ports used: ' + (($usedPorts | Sort-Object -Unique) -join ', ')) (($usedPorts.Count -gt 0) -and ($usedPorts -notcontains '8000'))

$bad = @($results | Where-Object { -not $_.Ok })
''; ('RESULT: {0} checks, {1} failed' -f $results.Count, $bad.Count)
Get-Process node -ErrorAction SilentlyContinue | Where-Object { $_.Id -in @($srv.Id, $other.Id, $srv3.Id, $srv5.Id) } | Stop-Process -Force -ErrorAction SilentlyContinue
"Rehearsal artifacts left in: $rd"
if ($bad.Count) { exit 1 } else { exit 0 }
