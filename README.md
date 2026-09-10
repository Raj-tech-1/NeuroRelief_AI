# NeuroRelief AI

NeuroRelief AI is a wellness companion for menstrual-cycle tracking, mood and symptom logging, pain-severity prediction, and personalized self-care guidance.

> This project is for wellness support and educational use. It is not a medical diagnosis or a substitute for professional medical advice.

## Features

- Account registration and login with JWT authentication
- Cycle tracking with phase, period, fertile-window, and cycle-history data
- Daily mood and wellness check-ins
- Symptom scanning and AI-assisted pain-severity prediction
- Past scan and prediction history
- Personal prediction calibration based on recorded pain feedback
- Doctor directory and wellness guidance
- CSV export for supported data views

## Project Structure

```text
.
├── neurorelief-ai/       # React + Vite frontend
├── neurorelief-backend/  # Express API and sql.js database
└── neurorelief-ml/       # Python training script, dataset, and model artifact
```

## Technology Stack

- Frontend: React 18, React Router, Vite, Tailwind CSS
- Backend: Node.js, Express, JWT, bcryptjs, sql.js
- Machine learning: Python, pandas, scikit-learn, matplotlib, seaborn

## Prerequisites

- Node.js 18 or newer
- npm
- Python 3.14 available through the Windows Python launcher as `py -3.14`
- Python packages: `pandas`, `numpy`, `scikit-learn`, `matplotlib`, and `seaborn`

## Setup

Open two terminals from the repository root.

### 1. Install frontend dependencies

```powershell
cd neurorelief-ai
npm install
```

### 2. Install backend dependencies

```powershell
cd ..\neurorelief-backend
npm install
```

### 3. Install Python dependencies

```powershell
cd ..\neurorelief-ml
py -3.14 -m pip install pandas numpy scikit-learn matplotlib seaborn
```

The repository currently includes `neurorelief_model.pkl`. If the model needs to be rebuilt, run the training script from the ML directory so the artifact is written where the backend expects it:

```powershell
cd neurorelief-ml
py -3.14 neurorelief_ml_model.py
```

## Run Locally

Start the backend in one terminal:

```powershell
cd neurorelief-backend
npm run dev
```

The API starts at `http://localhost:8000`.

Start the frontend in a second terminal:

```powershell
cd neurorelief-ai
npm run dev
```

Open the Vite URL shown in the terminal, normally `http://localhost:5173`.

The frontend is configured to call `http://localhost:8000/api`. The backend allows requests from the default Vite and Create React App local origins.

## Useful Commands

Frontend:

```powershell
cd neurorelief-ai
npm run build
npm run preview
```

Backend:

```powershell
cd neurorelief-backend
npm start
```

## API Routes

All protected routes require a bearer token from login or registration.

- `GET /api/health` - backend health check
- `/api/auth` - registration and login
- `/api/cycles` - cycle records and cycle insights
- `/api/mood` - mood and wellness records
- `/api/predict` - pain prediction, feedback, calibration, and history
- `/api/doctors` - doctor directory
- `/api/scans` - scan records

## Data and Configuration

The backend initializes its local sql.js database automatically. Runtime database files are managed by the backend database module.

Backend environment variables can be placed in `neurorelief-backend/.env`. The server supports `PORT`; it defaults to `8000` when no value is provided.

## Notes

- Prediction requests require `neurorelief-ml/neurorelief_model.pkl`.
- The prediction route runs the Python script from the backend and applies personal calibration after enough feedback sessions.
- If the prediction API is unavailable, the frontend returns a local fallback prediction so the scan flow can still be displayed.
- Never commit passwords, JWT secrets, or other private values from local environment files.
