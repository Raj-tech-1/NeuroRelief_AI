# Report Audit migration runbook (real database)

**Not yet approved or run.** The migration now consists of `report-audit-001` plus `report-audit-002` (appointment link, revision link, lifecycle triggers), applied together by `applyReportSchema`. **The Prepare run recorded before 002 existed (RunId `20261030-050140`) does not cover 002: run `Prepare` again and use the new RunId for Swap.** The real database has not been migrated. These are the exact steps that will be shown to the project owner for approval before anything real is changed. The staged runner `scripts/report-audit-migration.ps1` was rehearsed on a fictional scratch database with a dummy `node server.js` on a spare port (27 checks, all passing).

Run commands in Windows PowerShell 5.1 from `neurorelief-backend`. If scripts are blocked, run them as `powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\report-audit-migration.ps1 ...` (this affects only that one process).

## What each stage does
| Stage | Changes the real database? | What it does |
|---|---|---|
| `Prepare` | **No** (read-only) | Hashes the database twice 2 s apart (must be identical), integrity-checks it, makes a hash-verified read-only backup in `%LOCALAPPDATA%\NeuroRelief\backups\`, migrates a **copy of the backup** with the guarded scratch tool, and verifies the copy against the backup. Safe with the backend running. |
| `Swap` | **Yes** | Needs `-Approve`, the `RunId`, and `-ConfirmPid`. Re-verifies the artifacts, identifies the listener on the port, stops only that process (and only if it is `node ... server.js`), confirms the database is byte-identical to the backup, swaps in the migrated copy, verifies again, and restores the backup automatically if anything fails. Does not restart the backend. |
| `Rollback` | **Yes** | Needs `-Approve` and the `RunId`; refuses if anything listens on the port or the backup hash changed; restores the backup and checks integrity. |

## Step-by-step
1. **Tests (scratch only):** `npm run test:report-infra` must pass.
2. **Prepare (read-only):**
   `.\scripts\report-audit-migration.ps1 -Stage Prepare`
   Review the output: every line must say `PASS`, the summary must show identical counts for users, doctor accounts, doctor profiles and appointments, and it must end with `Prepare finished - NOTHING real was changed` and a `RunId`.
3. **Approve** (project owner) after reading the Prepare output.
4. **Identify the backend (changes nothing, stops nothing):**
   `.\scripts\report-audit-migration.ps1 -Stage Swap -RunId <RunId> -Identify`
   It prints the PID, process name, start time, parent PID and command line, warns if it is not `node ... server.js`, and exits. Check that it is the backend you started from this project. (Even without `-Identify`, `Swap -Approve` refuses to stop anything until you pass the matching `-ConfirmPid`; if nothing is listening it proceeds straight to the swap.)
5. **Swap:**
   `.\scripts\report-audit-migration.ps1 -Stage Swap -RunId <RunId> -Approve -ConfirmPid <PID>`
6. **Start the backend yourself:** `npm run dev`, then check `Invoke-RestMethod http://localhost:8000/api/health`, `Invoke-RestMethod http://localhost:8000/api/doctors | Select-Object name` (five doctors), a demo-doctor login (print only the role), and that the dashboards and a booking still work.
7. **If anything looks wrong:** stop the backend, then
   `.\scripts\report-audit-migration.ps1 -Stage Rollback -RunId <RunId> -Approve`

## Limits to know
- PowerShell 5.1 cannot read another process's working directory. Identification therefore relies on: exactly one listener on the port, process name `node.exe`, command line containing `server.js`, the printed details, and your explicit `-ConfirmPid`.
- `Swap` aborts (touching nothing) if the database differs from the backup, so a write between Prepare and Swap simply means running Prepare again.
- Existing backups in `neurorelief-backend\db\` (inside OneDrive) are left untouched. New backups go to `%LOCALAPPDATA%\NeuroRelief\backups\`.

## Guards added after the first Prepare review
- **Both migrations, exactly once.** `report-audit-001` and `report-audit-002` must each be recorded exactly once in the migrated copy, and nothing else may be recorded. Prepare checks this, Swap checks it again **before it stops anything or touches the database**, and Swap checks the live file again after the swap. A missing, duplicated or unexpected record makes the runner abort with "Nothing was stopped or changed".
- **Definitions, not just names.** The verifier rebuilds the expected schema from the migration code in memory and requires the exact CREATE text of all 30 Report Audit tables, triggers and indexes to match, checks the three migration-002 columns (type, nullable, no default, foreign keys), and runs a behaviour test of the migration-002 rules on an in-memory clone (never saved): a pending appointment is refused, an accepted one is allowed, illegal status jumps and verification without a doctor note are refused.
- **A backup is never deleted by this script.** Swap and Rollback only copy from the backup. A backup copy that fails its hash check at Prepare time is renamed `*.REJECTED` (kept for inspection), not deleted. Swap and Rollback re-hash the backup before and after and print `Backup preserved: not deleted, not modified`.
- **Rehearsal.** `scripts\rehearse-report-audit-migration.ps1` runs the whole runner (Prepare, every Swap refusal, Swap, Rollback, defective-copy guards) against a disposable fictional database in a temp folder with dummy servers on spare ports. It refuses to use the real database, the real backup folder or port 8000.
- **Before any real Swap:** re-run `Prepare` (a Swap aborts if the database changed after the backup), then use `-Identify`, then `-Approve -ConfirmPid <PID>`. Use only the RunId from that latest Prepare.
