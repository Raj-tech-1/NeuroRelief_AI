# NeuroRelief AI — Interface & Feature Change Report

**Baseline:** commit `f9d4df6` (Initial commit)
**Current:** branch `report-audit` = commit `6af9c12` (Report Audit + setup guide) **plus** uncommitted working-tree changes
**Scale:** 115 files changed since baseline (+19,435 / −1,575 lines), and a further ~27 modified + ~30 new files not yet committed.

---

## 1. Executive summary

| Area | Initial app | Current app |
|---|---|---|
| Layout | Top navbar + horizontal tab bar, "Welcome to NeuroRelief AI" banner | Left sidebar (drawer on mobile), top header with greeting, notification bell, profile menu, botanical illustration + quote |
| Roles | Patient only | Patient, **Doctor Portal**, Admin placeholder, role-based routing |
| Languages | English hard-coded | English, Hindi, Kannada, Tamil, Telugu (i18n), with per-script fonts and layout tuning |
| Login | Simple two-column card | Redesigned split-screen login with role tabs (Patient / Doctor), rotating quotes, doctor portal mode, remember-me |
| Patient tabs | 7 | 9 (added **Report Audit**, **Device 3D Explorer**) |
| Doctor ↔ patient | Book appointment only | Full care loop: requests, reschedule/propose, notes, chat, follow-ups, consented record sharing |
| Reports | None | Report Audit: create/upload, preview, share with doctor under consent, encrypted storage, doctor verification |
| Backend | cycles, mood, predict, doctors, scans, auth | + reports, care, assistant routes; encryption, audit, migrations, rate limiting, tests |

---

## 2. Global shell and navigation

**Initial** ([Dashboard.jsx](neurorelief-ai/src/pages/Dashboard.jsx), `Navbar`, `TabBar`)
- Top `Navbar` and a horizontally scrolling `TabBar` with 7 tabs: Overview, Cycle, Mood, Symptom, Doctor, Device, Learn.
- A gradient "Welcome to NeuroRelief AI / Your AI-Powered Women's Health Companion" banner with a single initial button that toggled the profile panel.

**Current**
- **Sidebar navigation** with icons, active-item highlight, `aria-current`, logo, tagline, decorative botanical illustration and an italic quote. Becomes a slide-in drawer on small screens.
- **Top header** with a personalised greeting (first name), current-tab title and subtitle (`nav.<id>`, `navSub.<id>`), language selector, notification bell and profile/avatar menu (Settings, Log out).
- **Notification bell**: shows doctor responses (accepted/declined) and, with care-sync, a unified activity feed (appointment events, notes, messages) with unread counts persisted in localStorage; polled every 30 s and on window focus.
- **Floating chat widget** (`PatientChatWidget`) available on every patient tab.
- **Fit-to-screen mode** for Symptom Advisor, Doctor and Device tabs so they fit a laptop viewport without page scroll (new `fit-*`, `sym-*`, `dev-*` CSS utilities and short-viewport media queries).
- New icon set ([icons.jsx](neurorelief-ai/src/components/icons.jsx)) and `font-display` serif for headings.
- Old `Navbar`/`TabBar` are retained only for the secondary pages (`/scan`, `/past-scans`, `/analyze-report`).

**Routing** ([App.jsx](neurorelief-ai/src/App.jsx), [roles.js](neurorelief-ai/src/utils/roles.js))
- Added `ProtectedRoute` with role checks and loop-free redirects; new routes `/doctor` (doctor) and `/admin` (admin placeholder via `RoleHome`).

---

## 3. Authentication page ([AuthPage.jsx](neurorelief-ai/src/pages/AuthPage.jsx))

- **Before:** 900 px two-card layout; hero card with 4 feature tiles; sign-in/sign-up pill toggle; plain email/password/confirm fields.
- **After:** full split-screen design with large hero headline, rotating quote carousel (with nav dots), new botanical illustration (`auth-botanical.svg`), Patient/Doctor role tabs, icon-led fields, show/hide password, remember-me, forgot-password and Google sign-in notices, loading spinner, "or" divider, disclaimer. `?portal=doctor` switches to a doctor-only login (no sign-up). Detects an already-signed-in patient switching to doctor login.
- Session handling moved into a new [session.js](neurorelief-ai/src/services/session.js) and updated `AuthContext`.

---

## 4. Patient tabs — what changed in each

| Tab | Changes |
|---|---|
| **Overview** | Rewritten with translated strings, summary cards (cycles tracked, mood check-ins, upcoming appointment, latest prediction), recent-activity list, quick-action links. Layout adapts for Indic languages (`indic-2col`). |
| **Cycle Tracking** | Redesigned, translated; `PainCalendar` reworked; insights text clamp for long-script languages. |
| **Mood & Wellness** | Redesigned; now embeds the new **Symptom Logger** (type, 0–10 pain intensity, date, area, description; shared with a doctor only via explicit consent). |
| **AI Symptom Advisor** | Rewritten compact "fit-screen" layout (symptom tile grid, tip cards with illustrations) and **Voice Assistant** overlay; backed by new `/api/assistant` route. |
| **Doctor Connect** | Redesigned: hero banner, search + specialisation/availability/sort filters, doctor cards with real photos (5 portraits added), profile drawer, booking flow, My Appointments (upcoming/past, cancel confirm), Quick Actions incl. Emergency (call 112 / nearby hospitals), health tips. Now opens the **Patient Appointment Modal** (reschedule, respond to doctor's proposed time, view notes, share records) and chat. |
| **Report Audit** *(new)* | See section 5. |
| **Device Control** | Rewritten and compacted; connection, battery, TENS intensity/frequency, heat temperature, sessions with before/after pain, history. |
| **Device 3D Explorer** *(new, uncommitted)* | See section 6. |
| **Learn** | Translated, illustrated tip cards (movement, nutrition, sleep, water). |

Secondary pages (`ScanPage`, `PastScansPage`, `AnalyzeReportPage`) remain, routed for patients only.

---

## 5. Report Audit (new feature)

**Patient UI** (`components/reportAudit/*`, [ReportAudit.jsx](neurorelief-ai/src/pages/tabs/ReportAudit.jsx))
- Stats counters, **Create report** (choose date range/sections, live **Preview**), **Upload PDF**, **History**, report detail with activity log, **Share wizard** with versioned consent text and revoke.
- Print/PDF-ready report document (`.rpt` styles, A4 print rules), AI-generated content clearly labelled, disclaimers.
- Shows a placeholder when the backend feature is not configured.

**Doctor UI** ([ReportVerification.jsx](neurorelief-ai/src/components/doctor/ReportVerification.jsx), [ReportReview.jsx](neurorelief-ai/src/components/doctor/ReportReview.jsx))
- Inbox with status filter/search, open shared report, view uploaded file, set verification status, add notes.

**Backend:** `routes/reports.js`, `lib/reportService|Crypto|Consent|Snapshot|Files.js`, DB schemas + migrations, AES-based encryption at rest (`docs/REPORT_ENCRYPTION.md`), private encrypted file store outside OneDrive, 8 MB limit on the upload route only, migration/restore rehearsal scripts and runbook, verification script, and five test suites.

---

## 6. Device 3D Explorer (new, uncommitted)

Files: [Device3DExplorer.jsx](neurorelief-ai/src/pages/tabs/Device3DExplorer.jsx) and `components/device3d/*` (Stage3D, Part, LayerScene, SystemScene, ComponentViewer, models, geometry, specs, simContext, ui).
- Interactive three.js scene (`three`, `@react-three/fiber`, `@react-three/drei` added), lazy-loaded so the bundle cost applies only when opened.
- Views: wearable, full assembly, isometric, **7-layer exploded belt**, component viewer with specs, and a **Working Simulation** timeline.
- Based on the project's own hardware spec (belt 100×900 mm, 5 V silicone heating pad, DS18B20 sensor, ESP32 NodeMCU-32S; TENS shown as a separate commercial unit). Values are illustrative; an on-screen disclaimer states it is an educational prototype. English only by design. Also available to doctors (never Device Control).

---

## 7. Doctor Portal (entirely new)

[DoctorDashboard.jsx](neurorelief-ai/src/pages/DoctorDashboard.jsx) — sidebar-based clinic console.

| Section | Purpose |
|---|---|
| Dashboard | Today's overview, pending requests, reports awaiting review, activity feed |
| Patients *(care)* | Patient list and consented patient records |
| Appointment Requests | Queue with accept/decline, seen/unseen tracking (`RequestQueue`, `RequestRow`) |
| Calendar | Month view of appointments (`DoctorCalendar`) |
| Appointments *(care)* | List + `AppointmentDrawer`: timeline, propose new time, complete, cancel, notes, messages |
| Consultation Notes *(care)* | Create/edit notes, follow-up instructions, summaries |
| Report Verification | Section 5 |
| Patient Messages *(care)* | Per-appointment chat threads |
| Follow-up Centre *(care)* | Open follow-ups |
| Patient Insights *(care)* | Aggregated insights |
| Device 3D Explorer | Section 6 |
| Settings | Doctor profile |

Items marked *care* require the clinical-sync schema; the UI degrades to a `CareUnavailable` state otherwise. Doctor header has notifications and language selector.

---

## 8. Patient ↔ Doctor care synchronisation (new, uncommitted)

- **Appointment lifecycle:** requested → accepted/declined → patient reschedule / doctor-proposed time (patient accepts/declines) → completed / cancelled. Every transition recorded in `appointment_events`.
- **Messaging:** per-appointment encrypted threads; allowed only between the two parties while pending, accepted, or within the follow-up window after completion.
- **Consultation notes & follow-ups:** doctor-authored, visible to the patient.
- **Record sharing:** patient grants a doctor selected categories (cycles, symptoms, pain, mood, predictions, therapy sessions) for a date range, purpose and expiry, under pinned versioned consent text (`records-consent-v1`, SHA-256 checked); revocable. An appointment alone gives no access.
- **Therapy sessions** and **symptoms** logging endpoints.
- Shared slot rules (`appointmentRules.js`: 6 slots, weekdays, 60-day horizon, clash detection) used by booking and rescheduling.
- Backend: `routes/care.js` (~30 endpoints), `lib/clinicalService.js`, `db/clinicalSchema.js` (7 tables incl. `clinical_audit_events`), `scripts/migrate-clinical.js`, tests `care-sync.test.mjs`.

---

## 9. Internationalisation (new)

- `react-i18next` with five locale files (en, hi, kn, ta, te; ~1,460 keys each), `LanguageSelector`, `useFormat` (numbers, dates, weekdays, times), `serverText.js` + `ServerMessage` to localise backend messages, `EnglishOnly` badge for content that is intentionally untranslated.
- CSS adjustments for Devanagari/Kannada/Tamil/Telugu: dedicated Noto fonts, looser line-heights, reduced hero sizes, re-flowed grids.
- `en.json` has ~52 new keys uncommitted (auth, doctor portal, care features) not yet mirrored in the other four locales.

---

## 10. Backend and infrastructure changes

- **New routes:** `/api/reports`, `/api/care`, `/api/assistant`.
- **Auth middleware** hardened (+`authenticateToken`, role checks); `rateLimit` middleware; `auth.js` route tweaks.
- **Database:** `database.js` gains transaction helper and schema guards (`scratchGuard.js`); new report and clinical schemas with `schema_migrations`.
- **Doctors route:** expanded (booking validation via shared slot rules, requests seen/unseen, status updates).
- **Tooling:** `.env.example`, seed scripts (`seed-demo-doctors`, `seed-user`), migration and rehearsal PowerShell scripts, `verify-report-audit.js`, new README/setup guide, `.vscode/settings.json`.
- **Tests:** 6 suites (report api/infra/upload/runner/phase3 + care-sync) with shared harnesses.
- **Dependencies:** frontend added i18next, react-i18next, three, @react-three/fiber, @react-three/drei; backend `package.json` updated.

---

## 11. Commit status

| Stage | Contents |
|---|---|
| `f9d4df6` | Original app |
| `6af9c12` | i18n, new shell, Doctor Portal v1, Report Audit, assistant, redesigned tabs, docs |
| **Uncommitted** | Auth page redesign, Doctor Portal rewrite (sidebar views), care synchronisation (frontend + backend), Device 3D Explorer, `session.js`, notification feed, chat widget, symptom logger, API/service updates |

> Note: the uncommitted work is substantial. Consider committing it (e.g. as separate commits for care-sync, 3D explorer and auth redesign) and mirroring the new `en.json` keys into hi/kn/ta/te.
