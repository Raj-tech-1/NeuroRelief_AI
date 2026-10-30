# Report encryption: key management, recovery and limits

Status: the `/api/reports` routes are now mounted in `server.js` (code only) and tested against scratch databases, but they stay inert (generic 503) until the key is configured and the migration is applied to the real database. Neither has happened: the migration has **not** been applied and the real key has **not** been generated. A backend that was started before this code was added does not have the routes at all until it is restarted.

## What is protected, and what is not
- **Protected:** report snapshots and doctor review notes are encrypted with AES-256-GCM *before* they are written to the database. A stolen database file, backup or OneDrive copy does not reveal their content without the key.
- **Not protected:** the sql.js database file as a whole is **not** encrypted. Names, emails, dates, report titles (kept neutral), share/consent records, statuses and audit events are readable by anyone who can read the file. Encrypting individual snapshots does not change that.
- **Trusted backend:** the server holds the key and decrypts reports for authorised requests. This is server-side encryption, **not end-to-end encryption**. Anyone with server access plus the key can read reports.
- **No compliance claim.** No legal, medical or regulatory compliance is claimed. Professional review is required before any real-patient use. The consent text is English only; translations must be professionally reviewed before they are used as consent.

## Design
- AES-256-GCM via Node's built-in `crypto`. Fresh random 96-bit IV per encryption; 128-bit auth tag; ciphertext, IV and tag in separate columns.
- Additional authenticated data binds the record identity (patient id, report type, encryption version): a ciphertext copied onto another patient's record fails to decrypt.
- Decryption fails closed with a generic error that never contains the key, plaintext or Node's raw message.
- `envelope_sha256` hashes `ciphertext|iv|tag` (never the plaintext, so it cannot be used to guess content).
- The key is read only from the backend environment, by one of two mutually exclusive settings (setting both is an error):
  - `REPORT_MASTER_KEY_FILE` = absolute path to a file containing the base64 key (**recommended**; the file lives outside the project and OneDrive; only the path goes in `.env`);
  - `REPORT_MASTER_KEY` = the base64 key itself (used by tests; avoid for real use).
  - `REPORT_MASTER_KEY_ID` = a label such as `k1`, stored with each record to support rotation.
- The loader refuses a key file that is relative, missing, empty, larger than 256 bytes, **inside the project folder, or inside any OneDrive folder**, and refuses a key that is not canonical base64 of exactly 32 non-uniform bytes. A missing or invalid key disables report encryption; the server never generates a key and never falls back to anything weaker. `reportKeyStatus()` returns only `valid`, `missing` or `invalid`.

## Generating the key (you run this; it prints nothing secret)
Windows PowerShell 5.1. These exact commands were rehearsed against a temporary folder and a fake `.env`; the key location below is not created until you run them.

```powershell
# 1) Generate the key straight into a file OUTSIDE OneDrive (refuses to overwrite an existing key)
$dir  = Join-Path $env:LOCALAPPDATA 'NeuroRelief\secrets'
$file = Join-Path $dir 'report-master-key.txt'
if (Test-Path -LiteralPath $file) { throw "A key file already exists at $file. Not overwriting." }
New-Item -ItemType Directory -Force -Path $dir | Out-Null
# Restrict the FOLDER FIRST, by SID, so the key file is never created with broader access (a file created first inherits
# SYSTEM, Administrators and other inherited entries until icacls runs - observed in the permissions rehearsal).
$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
icacls $dir /inheritance:r /grant:r "*${sid}:(OI)(CI)F" | Out-Null              # only your user
$bytes = New-Object byte[] 32
$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
$rng.GetBytes($bytes); $rng.Dispose()
[System.IO.File]::WriteAllText($file, [Convert]::ToBase64String($bytes))       # inherits ONLY your user from the folder
[Array]::Clear($bytes, 0, $bytes.Length)
icacls $file | Where-Object { $_ -match ':\(' }                                  # expect exactly ONE entry: your account (names/rights only)
# Record the key file's SHA-256 next to each backup of the key. It is NOT secret (a hash of 256 random bits) and lets you
# confirm later that a restored copy is byte-identical, without ever displaying the key:
(Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash

# 2) Validate without showing it (prints only True/False)
$k = [System.IO.File]::ReadAllText($file).Trim()
"Valid 32-byte key: " + (([Convert]::FromBase64String($k)).Length -eq 32 -and $k.Length -eq 44)
Remove-Variable k

# 3) Tell the backend WHERE the key is (path and id only, never the secret). Do not use Get-Content on .env.
$envFile = 'C:\Users\DELL\OneDrive\Desktop\NEURO\NeuroRelief_AI\neurorelief-backend\.env'
if (Select-String -Path $envFile -Pattern '^\s*REPORT_MASTER_KEY' -Quiet) { throw 'REPORT_MASTER_KEY settings already present.' }
Add-Content -Path $envFile -Encoding ASCII -Value ("`r`nREPORT_MASTER_KEY_FILE=" + $file + "`r`nREPORT_MASTER_KEY_ID=k1")
Select-String -Path $envFile -Pattern '^REPORT_MASTER_KEY_(FILE|ID)=' | ForEach-Object { $_.Line }   # shows only path + id
```

Notes
- `.env` and `.env.*` are git-ignored. Run step 1 **once**. Generating a second key later would make every report encrypted with the first one unreadable.
- `icacls ... /inheritance:r` removes Administrators and SYSTEM from the key folder on purpose; only your own account can open it. Because of that, a backup tool running as another account will not copy it, which is why a separate manual backup is needed.
- Do not paste the key into chat, tickets, commits or screenshots, and do not open `.env` while screen-sharing.

## Separate protected backup of the key
**If the key is lost, every encrypted report and note is permanently unreadable.** There is no recovery path by design. Keep one backup that is stored **separately** from the project folder and from every database backup. Never put the key in the same archive, cloud folder or backup as the database.

Preferred: **password manager secure note**
```powershell
Get-Content -LiteralPath $file -Raw | Set-Clipboard   # copies the key; nothing is printed
# paste it into a secure note in your password manager (do not paste it anywhere visible), then clear:
Set-Clipboard -Value ' '
```
Then clear Windows clipboard history (Win+V, Clear all) so the key is not left in it.

Alternative: **encrypted USB drive** (turn on BitLocker To Go for the drive first; keep it somewhere other than your computer)
```powershell
Copy-Item -LiteralPath $file -Destination 'E:\NeuroRelief-key-backup\report-master-key.txt'
(Get-FileHash $file).Hash -eq (Get-FileHash 'E:\NeuroRelief-key-backup\report-master-key.txt').Hash   # True = identical copy
```
(Adjust the drive letter.) Do one restore drill once the feature works: restore the key into a scratch location, point a scratch `.env` at it, and confirm a test report decrypts.

## Restore drill (do it once, with the real key, before any real patient data exists)
1. Restore the backup copy (password-manager note, or the encrypted USB file) to the key path, e.g. `Copy-Item <backup> $file`; for the password manager, paste into a new file, then clear the clipboard and Win+V history.
2. Re-apply the folder restriction if you recreated the folder (`icacls $dir /inheritance:r /grant:r "*${sid}:(OI)(CI)F"`), then confirm `icacls $file` lists only your account.
3. Confirm the restored file's SHA-256 equals the hash you recorded when the key was created (`(Get-FileHash $file).Hash`).
4. Start the backend and check the startup banner says `Report Audit key: valid`, then decrypt one test report (a report generated on a scratch copy is enough).
The same sequence was rehearsed with a clearly fake fixture value in a temporary folder (permissions, loader acceptance, simulated loss, restore, hash comparison). Because `icacls /inheritance:r` removes SYSTEM and Administrators from the key folder, backup software running as those accounts will not copy the key: the manual backup is the only copy besides the file itself. Windows may also show an unresolved SID among inherited entries on files created under `AppData`; creating the file inside a pre-restricted folder (as above) avoids inheriting it.

## Recovery and rotation
- **Lost key, backup exists:** restore the key file to `%LOCALAPPDATA%\NeuroRelief\secrets\report-master-key.txt`, make sure `.env` has `REPORT_MASTER_KEY_FILE` pointing to it, restart the backend.
- **Lost key, no backup:** encrypted reports and notes cannot be recovered. Patients would have to generate new reports. Plain database data (accounts, appointments, cycle records) is unaffected.
- **Rotation (not implemented yet):** each record stores `key_id`. Rotating means generating a new key with a new id, keeping the old key available during the transition, and re-encrypting records into new versions with the new key. Original snapshots are immutable by database triggers, so the rotation procedure must be designed and tested on a scratch copy first.
- **Suspected exposure:** rotate, re-encrypt, and assume anything the attacker also copied (database plus ciphertext) was exposed.

## Known limits
- Deleting a patient's report is blocked by the immutability triggers for now; an erasure procedure (for example crypto-shredding) is future work.
- Audit events live in the same database and are append-only by trigger, not tamper-proof against someone who can replace the file.
- sql.js enforces foreign keys only when `PRAGMA foreign_keys = ON` is set on the connection. The existing application never sets it, and `db.export()` resets it, so later code must set it again after every export or rely on the triggers.
- The project folder is inside OneDrive: `.env` and the database sync to the cloud. The key file is kept outside OneDrive so the key is not synced, but anyone who gets both your OneDrive and your computer can read reports.
