// AES-256-GCM encryption for report snapshots and doctor notes, using only Node's built-in crypto.
//
// Design (see docs/REPORT_ENCRYPTION.md):
//  - One 32-byte master key, supplied ONLY through the backend environment (REPORT_MASTER_KEY, base64).
//  - Every encryption uses a fresh random 96-bit IV. Ciphertext, IV and 128-bit auth tag are returned separately.
//  - The record's identity (owner, type, version) is bound in as Additional Authenticated Data, so a ciphertext
//    copied onto another patient's record fails authentication.
//  - Decryption fails closed with a generic error. Errors never contain the key, the plaintext or Node's raw message.
//  - Nothing here reads or writes the database, logs, or generates a key.
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const ALGORITHM = 'aes-256-gcm'
export const ENC_VERSION = 1
const KEY_BYTES = 32
const IV_BYTES = 12
const TAG_BYTES = 16
const BASE64_32 = /^[A-Za-z0-9+/]{43}=$/   // exactly 32 bytes, canonical padded base64
const KEY_ID_RE = /^[A-Za-z0-9._-]{1,40}$/

export class ReportCryptoError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'ReportCryptoError'
    this.code = code   // KEY_MISSING | KEY_INVALID | KEY_ID_INVALID | ENCRYPT_FAILED | DECRYPT_FAILED | INPUT_INVALID
  }
}

// The repository root (the folder that contains neurorelief-backend). A key file must not live inside it.
const DEFAULT_PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const MAX_KEY_FILE_BYTES = 256

const isInside = (child, parent) => {
  const rel = path.relative(parent.toLowerCase(), child.toLowerCase())
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}
const realIfExists = p => { try { return fs.realpathSync(p) } catch { return null } }

// Reads the key text from a file kept OUTSIDE the project and OneDrive. Errors never include the file's contents.
function readKeyFile(filePath, env, projectRoot) {
  const unsafe = why => new ReportCryptoError('KEY_FILE_UNSAFE', `REPORT_MASTER_KEY_FILE is not acceptable: ${why}`)
  if (filePath.includes('\0') || !path.isAbsolute(filePath)) throw unsafe('it must be an absolute path.')
  const real = realIfExists(filePath)
  if (!real) throw new ReportCryptoError('KEY_FILE_UNREADABLE', 'REPORT_MASTER_KEY_FILE does not exist or cannot be read.')
  const roots = [projectRoot, env.OneDrive, env.OneDriveConsumer, env.OneDriveCommercial].filter(Boolean)
  for (const r of roots) {
    const rr = realIfExists(r) || path.resolve(r)
    if (isInside(real, rr)) throw unsafe('it is inside the project folder or a OneDrive folder.')
  }
  let stat
  try { stat = fs.statSync(real) } catch { throw new ReportCryptoError('KEY_FILE_UNREADABLE', 'REPORT_MASTER_KEY_FILE cannot be read.') }
  if (!stat.isFile() || stat.size === 0 || stat.size > MAX_KEY_FILE_BYTES) throw unsafe('it must be a small regular file containing only the key.')
  try { return fs.readFileSync(real, 'utf8').trim() } catch { throw new ReportCryptoError('KEY_FILE_UNREADABLE', 'REPORT_MASTER_KEY_FILE cannot be read.') }
}

// Returns { key: Buffer(32), keyId } or throws. The error text never includes the configured value or file contents.
// Configure EITHER REPORT_MASTER_KEY (base64, used by tests) OR REPORT_MASTER_KEY_FILE (absolute path to a file outside the project).
export function loadMasterKey(env = process.env, { projectRoot = DEFAULT_PROJECT_ROOT } = {}) {
  const has = v => v !== undefined && v !== null && String(v).trim() !== ''
  if (has(env.REPORT_MASTER_KEY) && has(env.REPORT_MASTER_KEY_FILE)) {
    throw new ReportCryptoError('KEY_CONFIG_AMBIGUOUS', 'Set only one of REPORT_MASTER_KEY and REPORT_MASTER_KEY_FILE.')
  }
  if (!has(env.REPORT_MASTER_KEY) && !has(env.REPORT_MASTER_KEY_FILE)) {
    throw new ReportCryptoError('KEY_MISSING', 'REPORT_MASTER_KEY_FILE is not configured. Report encryption is disabled.')
  }
  const text = has(env.REPORT_MASTER_KEY_FILE) ? readKeyFile(String(env.REPORT_MASTER_KEY_FILE).trim(), env, projectRoot) : String(env.REPORT_MASTER_KEY).trim()
  const invalid = () => new ReportCryptoError('KEY_INVALID', 'REPORT_MASTER_KEY is invalid: it must be 32 random bytes encoded as base64 (44 characters).')
  if (!BASE64_32.test(text)) throw invalid()
  const key = Buffer.from(text, 'base64')
  if (key.length !== KEY_BYTES) throw invalid()
  if (key.every(b => b === key[0])) throw invalid()   // all-identical bytes are never a real random key
  const keyId = env.REPORT_MASTER_KEY_ID === undefined || String(env.REPORT_MASTER_KEY_ID).trim() === '' ? 'k1' : String(env.REPORT_MASTER_KEY_ID).trim()
  if (!KEY_ID_RE.test(keyId)) throw new ReportCryptoError('KEY_ID_INVALID', 'REPORT_MASTER_KEY_ID may only contain letters, digits, ".", "_" and "-" (max 40).')
  return { key, keyId }
}

// 'valid' | 'missing' | 'invalid' only. Safe to log: it never reveals the value.
export function reportKeyStatus(env = process.env) {
  try { loadMasterKey(env); return 'valid' } catch (err) { return err.code === 'KEY_MISSING' ? 'missing' : 'invalid' }
}

// The AAD ties a ciphertext to its record. Values are integers/enum strings, never health data.
export function buildAad({ patientId, reportType, version = ENC_VERSION }) {
  if (!Number.isInteger(patientId) || patientId < 1 || typeof reportType !== 'string' || !/^[a-z_]{1,40}$/.test(reportType)) {
    throw new ReportCryptoError('INPUT_INVALID', 'Invalid report identity for encryption.')
  }
  return Buffer.from(`nr-report|v${version}|patient:${patientId}|type:${reportType}`, 'utf8')
}

// Record-bound AAD used by the report API: a snapshot is bound to its patient and report id, a review note to its
// share, version number and author. Ids are positive integers, so no health data can enter the AAD.
export function buildRecordAad(kind, ids) {
  const need = names => names.map(n => {
    if (!Number.isInteger(ids?.[n]) || ids[n] < 1) throw new ReportCryptoError('INPUT_INVALID', 'Invalid record identity for encryption.')
    return `${n}:${ids[n]}`
  }).join('|')
  if (kind === 'snapshot') return Buffer.from(`nr-rec|v${ENC_VERSION}|snapshot|${need(['patientId', 'reportId'])}`, 'utf8')
  if (kind === 'note') return Buffer.from(`nr-rec|v${ENC_VERSION}|note|${need(['shareId', 'versionNo', 'authorId'])}`, 'utf8')
  throw new ReportCryptoError('INPUT_INVALID', 'Invalid record kind for encryption.')
}

function assertKey(key) {
  if (!Buffer.isBuffer(key) || key.length !== KEY_BYTES) throw new ReportCryptoError('KEY_INVALID', 'Encryption key must be 32 bytes.')
}

export function encrypt(plaintext, { key, aad }) {
  assertKey(key)
  const data = typeof plaintext === 'string' ? Buffer.from(plaintext, 'utf8') : plaintext
  if (!Buffer.isBuffer(data) || !Buffer.isBuffer(aad)) throw new ReportCryptoError('INPUT_INVALID', 'Invalid input for encryption.')
  try {
    const iv = crypto.randomBytes(IV_BYTES)   // fresh, random, per encryption
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES })
    cipher.setAAD(aad)
    const ciphertext = Buffer.concat([cipher.update(data), cipher.final()])
    return { ciphertext, iv, authTag: cipher.getAuthTag(), alg: ALGORITHM, encVersion: ENC_VERSION }
  } catch {
    throw new ReportCryptoError('ENCRYPT_FAILED', 'Encryption failed.')
  }
}

// Returns a Buffer. Any failure (wrong key, altered data/IV/tag, wrong AAD, bad lengths) throws the same generic error.
export function decrypt({ ciphertext, iv, authTag }, { key, aad }) {
  const fail = () => new ReportCryptoError('DECRYPT_FAILED', 'Could not decrypt: the data is damaged or the key does not match.')
  try {
    assertKey(key)
    const c = Buffer.from(ciphertext), i = Buffer.from(iv), t = Buffer.from(authTag)
    if (i.length !== IV_BYTES || t.length !== TAG_BYTES || !Buffer.isBuffer(aad)) throw new Error('bad envelope')
    const decipher = crypto.createDecipheriv(ALGORITHM, key, i, { authTagLength: TAG_BYTES })
    decipher.setAAD(aad)
    decipher.setAuthTag(t)
    return Buffer.concat([decipher.update(c), decipher.final()])   // final() throws if authentication fails
  } catch {
    throw fail()
  }
}

// Hash of the stored envelope (ciphertext|iv|tag). It does not reveal the plaintext (unlike a plaintext hash,
// which could be brute-forced for guessable content); the GCM tag is what authenticates the plaintext itself.
export function envelopeSha256({ ciphertext, iv, authTag }) {
  return crypto.createHash('sha256').update(ciphertext).update(iv).update(authTag).digest('hex')
}

export function encryptReportSnapshot(snapshot, { key, patientId, reportType }) {
  const json = typeof snapshot === 'string' ? snapshot : JSON.stringify(snapshot)
  const env = encrypt(json, { key, aad: buildAad({ patientId, reportType }) })
  return { ...env, envelopeSha256: envelopeSha256(env) }
}

export function decryptReportSnapshot(row, { key, patientId, reportType }) {
  const plain = decrypt(row, { key, aad: buildAad({ patientId, reportType, version: row.encVersion ?? ENC_VERSION }) })
  return plain.toString('utf8')
}
