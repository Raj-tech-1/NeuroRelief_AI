# NeuroRelief AI

NeuroRelief AI is a wellness companion for menstrual-cycle tracking, mood and symptom logging, pain-severity prediction, doctor appointments and doctor-reviewed health reports. The interface is available in English, Hindi, Kannada, Tamil and Telugu.

> This project is for wellness support and educational use. It is not a medical device, AI predictions are not diagnoses, and it is not a substitute for professional medical advice. Demo doctors are fictional.

## Features

**Patients**
- Register and sign in (JWT authentication)
- Cycle tracking: phases, periods, fertile window and history
- Daily mood and wellness check-ins
- AI symptom advisor with pain-severity prediction (Python model) and personal calibration from your feedback
- Doctor Connect: browse doctors, book appointments, see their status
- Report Audit: generate a report from your own records or upload a PDF, preview it, share it with a doctor whose appointment you have accepted (with explicit consent), track its status, read the doctor's feedback and revoke access
- Device panel, Learn articles, voice/chat assistant (needs a Gemini API key)
- Five languages, switchable at any time

**Doctors** (`/doctor`)
- Dashboard, appointment requests (accept/decline), calendar, appointments
- Report Verification: inbox of reports shared with them, review notes, request changes, verify with confirmation

## Project structure

```text
.
├── neurorelief-ai/        # Frontend: React 18 + Vite + Tailwind + i18next (port 5173)
├── neurorelief-backend/   # API: Node.js + Express + sql.js (SQLite in a file), port 8000
│   ├── db/                # database code (the .db file is created here on first start, not in git)
│   ├── docs/              # Report Audit encryption and migration guides
│   ├── scripts/           # seeding, Report Audit migration runner
│   └── tests/             # backend tests (scratch databases only)
└── neurorelief-ml/        # Python training script, dataset and the trained model (neurorelief_model.pkl)
```

## Prerequisites

| Tool | Version | Check |
|---|---|---|
| Git | any recent | `git --version` |
| Node.js (includes npm) | 18 or newer (tested with 22) | `node --version` |
| Python | 3.11 or newer (tested with 3.13) | Windows: `py -3.13 --version` · macOS/Linux: `python3 --version` |

The instructions use **Windows PowerShell**. macOS/Linux commands are shown where they differ.

## Quick start

### 1. Clone the repository

```powershell
git clone https://github.com/Raj-tech-1/NeuroRelief_AI.git
cd NeuroRelief_AI
```

### 2. Install dependencies

```powershell
cd neurorelief-backend
npm install
cd ..\neurorelief-ai
npm install
cd ..
```

Python packages for predictions:

```powershell
py -3.13 -m pip install pandas numpy scikit-learn matplotlib seaborn
# macOS/Linux:  python3 -m pip install pandas numpy scikit-learn matplotlib seaborn
```

### 3. Configure the backend

```powershell
cd neurorelief-backend
copy .env.example .env            # macOS/Linux: cp .env.example .env
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Open `neurorelief-backend\.env` in an editor and paste the printed value as `JWT_SECRET=...`. That is the only required setting. If your Python command is not `py -3.13`, also set `PYTHON_CMD` (for example `PYTHON_CMD=python3`). See `.env.example` for the optional settings.

### 4. Start the backend (terminal 1)

```powershell
cd neurorelief-backend
npm run dev
```

You should see `NeuroRelief AI Backend running on http://localhost:8000`. The database file `db/neurorelief.db` is created automatically on first start. Check it at http://localhost:8000/api/health.

### 5. Start the frontend (terminal 2)

```powershell
cd neurorelief-ai
npm run dev
```

Open http://localhost:5173 and register a patient account.

> The frontend always calls `http://localhost:8000/api`, and the backend only accepts requests from `localhost:5173` and `localhost:3000`, so keep these ports.

## Optional setup

### Add demo doctors (so Doctor Connect is not empty)

A fresh database has no doctors. This script creates five **fictional** demo doctors (safe to run more than once). **Stop the backend first** (Ctrl+C), because the database file is rewritten on save.

```powershell
cd neurorelief-backend
$env:DEMO_DOCTOR_PASSWORD='choose-a-password'   # optional: lets you sign in as the demo doctors
node scripts/seed-demo-doctors.js
Remove-Item Env:DEMO_DOCTOR_PASSWORD
npm run dev
```

Demo doctor sign-in emails are `ananya.rao@demo.neurorelief.invalid`, `priya.sharma@…`, `kavitha.nair@…`, `meera.iyer@…` and `nisha.desai@…` (same domain), using the password you chose. Sign in through the **Doctor Portal** option on the sign-in page (`/auth?portal=doctor`).

To create your own doctor account instead, see the usage notes at the top of `scripts/seed-user.js`.

### Voice/chat assistant

Add `GEMINI_API_KEY=...` to `neurorelief-backend/.env` and restart the backend. Without a key the assistant reports that it is not configured; everything else works.

### Enable Report Audit (Windows)

Report Audit is **off** until two things exist: an encryption key and the report tables. Until then the page shows "Report Audit is not available yet". Everything else works without it.

1. **Create the key** (one time) with the PowerShell commands in [`neurorelief-backend/docs/REPORT_ENCRYPTION.md`](neurorelief-backend/docs/REPORT_ENCRYPTION.md#generating-the-key-you-run-this-it-prints-nothing-secret). They write a random key to `%LOCALAPPDATA%\NeuroRelief\secrets\` (outside the project and OneDrive), restrict it to your Windows account and add only its path to `.env`. **Back up that key file somewhere safe:** if it is lost, saved reports cannot be opened.
2. **Add the report tables** with the guarded migration runner (start the backend once beforehand so the database file exists):

   ```powershell
   cd neurorelief-backend
   # If scripts are blocked, prefix each line with:  powershell -NoProfile -ExecutionPolicy Bypass -File
   .\scripts\report-audit-migration.ps1 -Stage Prepare
   ```

   Prepare changes nothing: it backs up the database to `%LOCALAPPDATA%\NeuroRelief\backups\`, migrates a copy and verifies it. It ends with a **RunId**. Then stop the backend (Ctrl+C) and run:

   ```powershell
   .\scripts\report-audit-migration.ps1 -Stage Swap -RunId <RunId> -Approve
   npm run dev
   ```

   The startup log should say `Report Audit key: valid`. To undo, stop the backend and run `-Stage Rollback -RunId <RunId> -Approve`. Details: [`docs/REPORT_AUDIT_MIGRATION_RUNBOOK.md`](neurorelief-backend/docs/REPORT_AUDIT_MIGRATION_RUNBOOK.md).
3. **To share a report**, the patient needs an appointment that the doctor has **accepted** in the Doctor Portal.

Uploaded PDF reports (max 5 MB) are stored encrypted in `%LOCALAPPDATA%\NeuroRelief\report-files` (change with `REPORT_STORAGE_DIR`).

> The migration runner is PowerShell and has only been tested on Windows. On macOS/Linux the rest of the app works; Report Audit stays off.

## Useful commands

| Where | Command | What it does |
|---|---|---|
| `neurorelief-ai` | `npm run dev` | Frontend dev server |
| `neurorelief-ai` | `npm run build` / `npm run preview` | Production build / preview it |
| `neurorelief-backend` | `npm run dev` (or `npm start`) | API server |
| `neurorelief-backend` | `npm run test:report-infra` | Backend tests (use temporary scratch databases, never your data) |
| `neurorelief-ml` | `py -3.13 neurorelief_ml_model.py` | Retrain the model (writes `neurorelief_model.pkl`) |

## API overview

All routes except health, register and login need `Authorization: Bearer <token>`.

- `GET /api/health`: health check
- `/api/auth`: register, login
- `/api/cycles`, `/api/mood`, `/api/scans`: patient records
- `/api/predict`: pain prediction, feedback, calibration, history
- `/api/doctors`: doctor directory, booking, doctor requests
- `/api/assistant`: voice/chat assistant (Gemini)
- `/api/reports`: Report Audit (patient reports, sharing, uploads, doctor inbox and review)

## Troubleshooting

| Problem | Fix |
|---|---|
| `JWT_SECRET is not set` on start | Create `neurorelief-backend/.env` from `.env.example` and set `JWT_SECRET`. |
| `EADDRINUSE` / port 8000 in use | Another backend is already running. Stop it, or find it with `Get-NetTCPConnection -LocalPort 8000`. |
| Frontend shows network errors | Make sure the backend is running on port 8000 and the frontend on port 5173. |
| Predictions fail or fall back | Check `PYTHON_CMD` and that pandas and scikit-learn are installed for that Python. If the model cannot be loaded with your scikit-learn version, retrain it (see Useful commands). |
| Doctor Connect is empty | Run `scripts/seed-demo-doctors.js` (see Optional setup). |
| "Report Audit is not available yet" | Follow "Enable Report Audit", then restart the backend. |
| No doctors to share a report with | The doctor must accept your appointment first. |
| `running scripts is disabled` in PowerShell | Use `powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\<script>.ps1 ...` |

## Security notes

- Never commit `.env`, `*.db` files, backups or the Report Audit key. `.gitignore` already excludes `.env`, `.env.*` and `*.db`.
- The Report Audit key and backups are kept outside the project on purpose. Keep the project out of cloud-synced folders if you store real data.
- This is a development setup (HTTP on localhost). It has not had a security, legal or clinical review and should not be used with real patient data as-is.
