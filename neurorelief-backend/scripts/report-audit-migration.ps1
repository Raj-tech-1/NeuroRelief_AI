<#
.SYNOPSIS
  Staged, guarded Report Audit migration runner for Windows PowerShell 5.1.

.DESCRIPTION
  Stage Prepare  : changes NOTHING real. Reads the database, makes a hash-verified read-only backup outside OneDrive,
                   migrates a COPY of that backup with the guarded scratch tool, verifies the copy against the backup,
                   and writes a state file. Safe to run while the backend is running.
  Stage Swap     : replaces the real database with the verified migrated copy. Requires -Approve, the RunId from Prepare,
                   and -ConfirmPid equal to the PID of the process listening on the port. Stops ONLY that process, only
                   after it is identified as `node ... server.js`. Aborts if the database changed since the backup.
                   Restores the backup automatically if any post-swap check fails.
  Stage Rollback : restores the backup from a RunId (requires -Approve and that nothing listens on the port).

  The backend is never started by this script. Nothing is printed from database contents or from any key.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][ValidateSet('Prepare', 'Swap', 'Rollback')][string]$Stage,
  [string]$BackendDir,
  [string]$DatabasePath,
  [string]$OffDir,
  [int]$Port = 8000,
  [string]$RunId,
  [string]$ConfirmPid,
  [switch]$Approve,
  [switch]$Identify
)
$ErrorActionPreference = 'Stop'
if (-not $BackendDir) { $BackendDir = Split-Path -Parent $PSScriptRoot }
if (-not $OffDir)     { $OffDir = Join-Path $env:LOCALAPPDATA 'NeuroRelief' }

function Say($m, $color) { if ($color) { Write-Host $m -ForegroundColor $color } else { Write-Host $m } }
function Step($m) { Write-Host ''; Write-Host ('== ' + $m) -ForegroundColor Cyan }
function Fail($m) { Write-Host ('ABORTED: ' + $m) -ForegroundColor Red; exit 1 }
function Sha($p)  { (Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash }
function RunNode([string[]]$NodeArgs) {
  Push-Location $BackendDir
  try {
    & node @NodeArgs 2>&1 | ForEach-Object { Write-Host ([string]$_) }   # show node's output; keep it out of the return value
    return [int]$LASTEXITCODE
  } finally { Pop-Location }
}
function Get-Listener([int]$p) {
  $c = Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue
  if (-not $c) { return $null }
  $ids = @($c | Select-Object -ExpandProperty OwningProcess -Unique)
  if ($ids.Count -ne 1) { Fail ('Expected exactly one listener on port ' + $p + ', found PIDs: ' + ($ids -join ', ')) }
  $w = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $ids[0])
  [pscustomobject]@{ Pid = [int]$w.ProcessId; Name = $w.Name; CommandLine = $w.CommandLine; ParentPid = [int]$w.ParentProcessId; Started = $w.CreationDate }
}
function Wait-PortClosed([int]$p) {
  for ($i = 0; $i -lt 20; $i++) { if (-not (Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue)) { return $true }; Start-Sleep -Milliseconds 500 }
  return $false
}

# ---- target selection ----------------------------------------------------------------------------------------------
$defaultDb = Join-Path $BackendDir 'db\neurorelief.db'
if (-not $DatabasePath) { $DatabasePath = $defaultDb }
if (-not (Test-Path -LiteralPath $DatabasePath -PathType Leaf)) { Fail ('Database file not found: ' + $DatabasePath) }
$dbItem = Get-Item -LiteralPath $DatabasePath
if ($dbItem.LinkType) { Fail 'The database path is a link; refusing.' }
$dbFull = $dbItem.FullName
$isReal = $false
if (Test-Path -LiteralPath $defaultDb) { $isReal = ($dbFull -ieq (Get-Item -LiteralPath $defaultDb).FullName) }
Step 'Target'
Say ('Database path : ' + $dbFull)
Say ('Size / modified: ' + $dbItem.Length + ' bytes / ' + $dbItem.LastWriteTime)
if ($isReal) { Say 'Mode          : REAL DATABASE (the path the server uses: db\neurorelief.db)' 'Yellow' }
else         { Say 'Mode          : REHEARSAL (non-default path)' }
Say ('Off-OneDrive dir: ' + $OffDir)
if ($dbFull -like '*\OneDrive\*') { Say 'Note: the database itself lives inside OneDrive; backups and work files go to the off-OneDrive dir.' }

$null = New-Item -ItemType Directory -Force -Path (Join-Path $OffDir 'backups')
$null = New-Item -ItemType Directory -Force -Path (Join-Path $OffDir 'work')

function Load-State {
  if (-not $RunId) { Fail 'RunId is required for this stage (printed by Prepare).' }
  if ($RunId -notmatch '^\d{8}-\d{6}$') { Fail 'RunId must look like 20261030-123456.' }
  $f = Join-Path $OffDir ('work\' + $RunId + '\state.json')
  if (-not (Test-Path -LiteralPath $f)) { Fail ('No state file for RunId ' + $RunId) }
  $s = Get-Content -LiteralPath $f -Raw | ConvertFrom-Json
  if ($s.databasePath -ine $dbFull) { Fail 'The state file was created for a different database path.' }
  return $s
}
# The backup from Prepare is the only way back. It is only ever READ by Swap and Rollback (copied, never moved or deleted).
function Assert-BackupIntact($s, [string]$when) {
  if (-not (Test-Path -LiteralPath $s.backupPath -PathType Leaf)) { Fail ('The backup is missing (' + $when + '): ' + $s.backupPath) }
  if ((Sha $s.backupPath) -ne $s.backupSha256) { Fail ('The backup no longer matches its recorded hash (' + $when + '). Not proceeding.') }
}
function Say-BackupPreserved($s) {
  Assert-BackupIntact $s 'after the operation'
  Say ('Backup preserved: not deleted, not modified - ' + $s.backupPath + ' (SHA-256 ' + $s.backupSha256 + ')')
}
function Restore-FromBackup($s) {
  $staging = Join-Path (Split-Path $dbFull) 'neurorelief-restore.db'
  Copy-Item -LiteralPath $s.backupPath -Destination $staging -Force
  Set-ItemProperty -LiteralPath $staging -Name IsReadOnly -Value $false
  if ((Sha $staging) -ne $s.backupSha256) { Remove-Item -LiteralPath $staging -Force; Fail 'Restore copy does not match the backup hash. Original untouched.' }
  Move-Item -LiteralPath $staging -Destination $dbFull -Force
  if ((Sha $dbFull) -ne $s.backupSha256) { Fail ('RESTORE VERIFICATION FAILED - restore the backup manually: ' + $s.backupPath) }
  Say 'Database restored from the backup and verified (hash matches).'
}

# ====================================================================================================================
if ($Stage -eq 'Prepare') {
  $RunId = Get-Date -Format 'yyyyMMdd-HHmmss'
  $runDir = Join-Path $OffDir ('work\' + $RunId); $null = New-Item -ItemType Directory -Force -Path $runDir

  Step 'Read-only checks of the current database'
  $h1 = Sha $dbFull; Start-Sleep -Seconds 2; $h2 = Sha $dbFull
  if ($h1 -ne $h2) { Fail 'The database file changed while reading it (is the backend writing?). Try again in a quiet moment.' }
  Say ('SHA-256 (stable across 2s): ' + $h1)
  if ((RunNode @('scripts\verify-report-audit.js', '--integrity-only', $dbFull)) -ne 0) { Fail 'Integrity check of the current database failed.' }

  Step 'Backup (outside OneDrive, hash-verified, read-only)'
  $backup = Join-Path $OffDir ('backups\neurorelief-' + $RunId + '-pre-report-audit.db')
  Copy-Item -LiteralPath $dbFull -Destination $backup
  $bh = Sha $backup
  if ($bh -ne $h1) {
    # A backup file is never deleted by this script: a copy that failed verification is set aside for inspection instead.
    $rejected = $backup + '.REJECTED'; Move-Item -LiteralPath $backup -Destination $rejected -Force
    Fail ('Backup hash does not match the source. The bad copy was kept for inspection as ' + $rejected + ' and is NOT a usable backup.')
  }
  if ((RunNode @('scripts\verify-report-audit.js', '--integrity-only', $backup)) -ne 0) { Fail 'Integrity check of the backup failed.' }
  Set-ItemProperty -LiteralPath $backup -Name IsReadOnly -Value $true
  Say ('Backup: ' + $backup); Say ('Backup SHA-256 equals source: ' + ($bh -eq $h1))

  Step 'Migrate a COPY of the backup with the guarded scratch tool'
  $copy = Join-Path $runDir ('neurorelief-' + $RunId + '.scratch.db')
  Copy-Item -LiteralPath $backup -Destination $copy
  Set-ItemProperty -LiteralPath $copy -Name IsReadOnly -Value $false
  $null = RunNode @('scripts\migrate-report-audit.js', '--scratch', '--db', $copy, '--check')
  if ((RunNode @('scripts\migrate-report-audit.js', '--scratch', '--db', $copy)) -ne 0) { Fail 'Migration of the copy failed. The real database was not touched.' }
  if ((RunNode @('scripts\migrate-report-audit.js', '--scratch', '--db', $copy, '--check')) -ne 0) { Fail 'Post-migration check failed.' }

  Step 'Both migrations (report-audit-001 and report-audit-002) must be recorded exactly once in the copy'
  if ((RunNode @('scripts\verify-report-audit.js', '--migrations-only', $copy)) -ne 0) { Fail 'The migrated copy does not record both migrations exactly once. The real database was not touched.' }

  Step 'Verify migrated copy against the backup'
  if ((RunNode @('scripts\verify-report-audit.js', '--before', $backup, '--after', $copy)) -ne 0) { Fail 'Verification FAILED. The real database was not touched.' }

  $state = [ordered]@{ runId = $RunId; databasePath = $dbFull; backupPath = $backup; backupSha256 = $bh; migratedCopyPath = $copy; migratedSha256 = (Sha $copy); createdAt = (Get-Date).ToString('o') }
  $state | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $runDir 'state.json') -Encoding ASCII
  Step 'Prepare finished - NOTHING real was changed'
  Say ('RunId: ' + $RunId)
  Say 'Review the results above. To swap (requires your explicit approval) run:'
  Say ('  .\scripts\report-audit-migration.ps1 -Stage Swap -RunId ' + $RunId + ' -Approve -ConfirmPid <PID shown by the Swap stage>')
  exit 0
}

# ====================================================================================================================
if ($Stage -eq 'Swap') {
  if (-not $Approve -and -not $Identify) { Fail 'Swap changes the database. Re-run with -Approve once you have reviewed the Prepare results.' }
  $s = Load-State

  if ($Identify) {
    Step ('Identify the process listening on port ' + $Port + ' (-Identify: nothing will be changed)')
    $il = Get-Listener $Port
    if ($il) {
      Say ('PID ' + $il.Pid + ' | ' + $il.Name + ' | started ' + $il.Started + ' | parent PID ' + $il.ParentPid)
      Say ('Command line: ' + $il.CommandLine)
      if ($il.Name -ine 'node.exe' -or $il.CommandLine -notmatch 'server.js') { Say 'WARNING: this is not a "node ... server.js" process; Swap will refuse to stop it.' 'Yellow' }
      Say ('To swap, pass: -Approve -ConfirmPid ' + $il.Pid)
    } else { Say ('Nothing is listening on port ' + $Port + '; Swap will not need to stop anything.') }
    Say 'Identify finished. Nothing was stopped or changed.'
    exit 0
  }

  Step 'Re-verify the prepared artifacts'
  if (-not (Test-Path -LiteralPath $s.backupPath) -or -not (Test-Path -LiteralPath $s.migratedCopyPath)) { Fail 'Backup or migrated copy is missing.' }
  if ((Sha $s.backupPath) -ne $s.backupSha256) { Fail 'The backup no longer matches its recorded hash.' }
  if ((Sha $s.migratedCopyPath) -ne $s.migratedSha256) { Fail 'The migrated copy no longer matches its recorded hash.' }
  Step 'Migration records: report-audit-001 AND report-audit-002 must each be recorded exactly once (checked BEFORE anything is stopped or changed)'
  if ((RunNode @('scripts\verify-report-audit.js', '--migrations-only', $s.migratedCopyPath)) -ne 0) { Fail 'A required migration is missing, recorded more than once, or an unexpected one is recorded. Nothing was stopped or changed.' }
  if ((RunNode @('scripts\verify-report-audit.js', '--before', $s.backupPath, '--after', $s.migratedCopyPath)) -ne 0) { Fail 'Fresh verification of the migrated copy failed. Nothing was stopped or changed.' }

  Step ('Identify the process listening on port ' + $Port)
  $l = Get-Listener $Port
  if ($l) {
    Say ('PID ' + $l.Pid + ' | ' + $l.Name + ' | started ' + $l.Started + ' | parent PID ' + $l.ParentPid)
    Say ('Command line: ' + $l.CommandLine)
    if ($l.Name -ine 'node.exe' -or $l.CommandLine -notmatch 'server\.js') { Fail 'The listener is not a "node ... server.js" process. I will not stop it.' }
    if (-not $ConfirmPid) { Fail ('Re-run with -ConfirmPid ' + $l.Pid + ' to confirm this is YOUR backend and may be stopped.') }
    if ([int]$ConfirmPid -ne $l.Pid) { Fail ('-ConfirmPid does not match the listener PID ' + $l.Pid + '. Nothing was stopped.') }
    Step 'Stopping ONLY that process'
    Stop-Process -Id $l.Pid
    if (-not (Wait-PortClosed $Port)) { Fail ('Port ' + $Port + ' is still listening after stopping PID ' + $l.Pid + '. Database untouched.') }
    Say ('Stopped PID ' + $l.Pid + '; port ' + $Port + ' is closed.')
  } else { Say ('Nothing is listening on port ' + $Port + '.') }

  Step 'Confirm the database is unchanged since the backup'
  $a = Sha $dbFull; Start-Sleep -Seconds 2; $b = Sha $dbFull
  if ($a -ne $b) { Fail 'The database is still changing. Database untouched.' }
  if ($a -ne $s.backupSha256) { Fail 'The database changed after the backup was taken. Backup is stale - run Prepare again. Database untouched.' }
  Say 'Database hash equals the backup hash.'

  Step 'Swap in the migrated copy'
  $staging = Join-Path (Split-Path $dbFull) 'neurorelief-migrated.db'
  if (Test-Path -LiteralPath $staging) { Fail ('A staging file already exists: ' + $staging) }
  try {
    Copy-Item -LiteralPath $s.migratedCopyPath -Destination $staging
    Set-ItemProperty -LiteralPath $staging -Name IsReadOnly -Value $false
    if ((Sha $staging) -ne $s.migratedSha256) { throw 'Staging copy hash mismatch.' }
    Move-Item -LiteralPath $staging -Destination $dbFull -Force
    if ((Sha $dbFull) -ne $s.migratedSha256) { throw 'Swapped database hash mismatch.' }
    Step 'Post-swap verification (read-only): both migrations once, definitions, data identical to the backup'
    if ((RunNode @('scripts\verify-report-audit.js', '--migrations-only', $dbFull)) -ne 0) { throw 'Post-swap: a required migration is missing or recorded more than once.' }
    if ((RunNode @('scripts\verify-report-audit.js', '--before', $s.backupPath, '--after', $dbFull)) -ne 0) { throw 'Post-swap verification failed.' }
  } catch {
    Write-Host ('PROBLEM: ' + $_.Exception.Message) -ForegroundColor Red
    if (Test-Path -LiteralPath $staging) { Remove-Item -LiteralPath $staging -Force }   # the staging COPY of the migrated file, never a backup
    Say 'Restoring the backup...'
    Restore-FromBackup $s
    Say-BackupPreserved $s
    Fail 'Swap rolled back; the original database is back in place.'
  }
  Say-BackupPreserved $s
  Step 'Swap complete'
  Say 'The backend was NOT restarted. Start it yourself:  cd backend; npm run dev'
  Say ('To undo: .\scripts\report-audit-migration.ps1 -Stage Rollback -RunId ' + $RunId + ' -Approve  (backend must be stopped)')
  exit 0
}

# ====================================================================================================================
if ($Stage -eq 'Rollback') {
  if (-not $Approve) { Fail 'Rollback changes the database. Re-run with -Approve.' }
  $s = Load-State
  Assert-BackupIntact $s 'before restoring'
  if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) { Fail ('Something is listening on port ' + $Port + '. Stop the backend first.') }
  Step 'Restoring the backup (the backup is COPIED to the database path; the backup file itself is never moved or deleted)'
  Restore-FromBackup $s
  if ((RunNode @('scripts\verify-report-audit.js', '--integrity-only', $dbFull)) -ne 0) { Fail 'Integrity check after restore failed. The backup is untouched.' }
  Say-BackupPreserved $s
  Say 'Rollback complete.'
  exit 0
}
