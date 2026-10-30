// The approved, versioned consent text for sharing a report with a doctor.
//
// - This module is the single source of truth. The browser never supplies the text: it only sends the version
//   it was shown, and the server records the text defined here.
// - The text is pinned by SHA-256. Editing it without creating a new version makes this module refuse to load
//   (fail closed), so an approved wording can never be changed silently. A wording change must be a NEW version
//   (consent-v2, ...) added alongside; existing shares keep the exact text they were recorded with.
// - Only English is approved. Translations must not be recorded as consent until they have been reviewed and added
//   here as their own versions/languages.
import crypto from 'node:crypto'

export const CONSENT_VERSION = 'consent-v1'
export const CONSENT_LANGUAGE = 'en'
export const CONSENT_SHA256 = '1324b9936739a5b0a3e2c204a3952c8c4cb63b9fd9be5c0f1accdf452ceb60b0'

export const CONSENT_TEXT = [
  'Consent to Share Medical Wellness Report',
  'I authorize NeuroRelief AI to share the selected report and its included health information with the doctor I have selected, for the purpose of reviewing the report and providing feedback.',
  'The report may contain information recorded in my account, including menstrual-cycle and wellness records, questionnaire responses, and AI-generated predictions where available. AI-generated predictions are not confirmed medical diagnoses.',
  'The selected doctor may access the report and its permitted review history while sharing remains authorized. I can revoke future access at any time. Revocation prevents future access through the application but cannot undo information already viewed, downloaded, or retained separately.',
  'This report is system-generated and is not clinician-verified until the selected authorized doctor explicitly completes the review.',
  "I have reviewed the report and the selected doctor's identity, and I voluntarily consent to sharing them for this purpose.",
].join('\n\n')

export class ConsentError extends Error {
  constructor(code, message) { super(message); this.name = 'ConsentError'; this.code = code }
}

const sha256 = text => crypto.createHash('sha256').update(text, 'utf8').digest('hex')
if (sha256(CONSENT_TEXT) !== CONSENT_SHA256) {
  throw new ConsentError('CONSENT_TEXT_CHANGED', 'The approved consent text no longer matches its pinned hash. Add a new consent version instead of editing consent-v1.')
}

export function getCurrentConsent() {
  return { version: CONSENT_VERSION, language: CONSENT_LANGUAGE, text: CONSENT_TEXT, sha256: CONSENT_SHA256 }
}

const cleanName = (value, what) => {
  if (typeof value !== 'string' || value.trim() === '' || value.length > 200) throw new ConsentError('CONSENT_INPUT_INVALID', `Invalid ${what} for consent record.`)
  return value.trim()
}

// Builds the values stored on a report_shares row. `acceptedVersion` is what the client says it showed; it must match.
// doctorName / reportTitle must come from the server's own records (doctor_profiles / report_originals), never from the client.
export function buildConsentRecord({ acceptedVersion, doctorName, reportTitle }) {
  if (acceptedVersion !== CONSENT_VERSION) throw new ConsentError('CONSENT_VERSION_MISMATCH', 'The consent text has changed. Please review the current consent and try again.')
  return {
    consent_text_version: CONSENT_VERSION,
    consent_language: CONSENT_LANGUAGE,
    consent_text: CONSENT_TEXT,
    consent_text_sha256: CONSENT_SHA256,
    consent_doctor_name: cleanName(doctorName, 'doctor name'),
    consent_report_title: cleanName(reportTitle, 'report title'),
  }
}
