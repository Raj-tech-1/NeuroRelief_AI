// The approved, versioned consent text for letting one doctor see selected health-record categories.
// Same rules as lib/reportConsent.js: single source of truth, English only, pinned by SHA-256 (fail closed if edited).
// A wording change must be a NEW version; existing grants keep the exact text they were recorded with.
import crypto from 'node:crypto'

export const RECORD_CONSENT_VERSION = 'records-consent-v1'
export const RECORD_CONSENT_SHA256 = '94052c3490a4bc5e2a9ece6043609ad93983aaeccf08e513990f9307c598fe55'

export const RECORD_CONSENT_TEXT = [
  'Consent to Share Selected Health Records',
  'I authorize NeuroRelief AI to let the doctor I have selected view the record categories I have chosen, for the date range and purpose I have chosen, in connection with my appointment.',
  'The records may include menstrual-cycle entries, symptoms and pain ratings, wellness entries, AI-generated predictions and therapy session history, depending on my selection. AI-generated predictions are not confirmed medical diagnoses. TENS sessions are entries I recorded myself.',
  'Only the selected doctor can view these records, only until the access expires or I revoke it. Revocation prevents future access through the application but cannot undo information already viewed or retained separately.',
  'An appointment on its own does not give a doctor access to my records; only this consent does.',
  'I have reviewed my selection and the selected doctor, and I voluntarily consent to this access.',
].join('\n\n')

export class RecordConsentError extends Error {
  constructor(code, message) { super(message); this.name = 'RecordConsentError'; this.code = code }
}

const sha256 = text => crypto.createHash('sha256').update(text, 'utf8').digest('hex')
if (sha256(RECORD_CONSENT_TEXT) !== RECORD_CONSENT_SHA256) {
  throw new RecordConsentError('CONSENT_TEXT_CHANGED', 'The approved record-access consent text no longer matches its pinned hash. Add a new consent version instead of editing records-consent-v1.')
}

export function getRecordConsent() {
  return { version: RECORD_CONSENT_VERSION, language: 'en', text: RECORD_CONSENT_TEXT, sha256: RECORD_CONSENT_SHA256 }
}
