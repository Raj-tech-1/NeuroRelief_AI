// Private, encrypted storage for patient-uploaded PDF reports.
//
// Validation is done here on the server (never trusted from the browser): strict base64, a hard size cap, the PDF header and
// trailer, and a refusal of the PDF features that run code or carry hidden payloads. This is best-effort content screening,
// not an antivirus scan: a compressed object stream can hide a keyword from a plain scan.
// Storage: one AES-256-GCM encrypted file per report (the same key and algorithm as the report records, bound to the
// patient and report id), under a random 128-bit name, in a directory that must be OUTSIDE the project and OneDrive.
// The file name is never sent to a browser and no file is ever served statically.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { encrypt, decrypt } from './reportCrypto.js'

export const MAX_PDF_BYTES = 5 * 1024 * 1024
const MAGIC = Buffer.from('NRF1')   // file format marker: NRF1 | iv(12) | tag(16) | ciphertext
const NAME_RE = /^[a-f0-9]{32}\.enc$/
const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
// Features that execute code, launch programs or embed other files. Matched as whole names (e.g. /JS, not /JSON-like names).
const FORBIDDEN = /\/(JavaScript|JS|Launch|EmbeddedFile|RichMedia)(?![A-Za-z0-9])/

export class FileError extends Error {
  constructor(status, code, message) { super(message); this.name = 'FileError'; this.status = status; this.code = code }
}

// Strict decode + checks. Returns the PDF bytes.
export function decodePdf(b64) {
  if (typeof b64 !== 'string' || b64.length === 0) throw new FileError(400, 'INVALID_FILE', 'Choose a PDF file.')
  if (b64.length > Math.ceil(MAX_PDF_BYTES / 3) * 4 + 4) throw new FileError(413, 'FILE_TOO_LARGE', 'The file is larger than 5 MB.')
  if (b64.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) throw new FileError(400, 'INVALID_FILE', 'The file could not be read.')
  const bytes = Buffer.from(b64, 'base64')
  if (bytes.length > MAX_PDF_BYTES) throw new FileError(413, 'FILE_TOO_LARGE', 'The file is larger than 5 MB.')
  if (bytes.length < 16 || bytes.subarray(0, 5).toString('latin1') !== '%PDF-') throw new FileError(415, 'NOT_A_PDF', 'Only PDF files are accepted.')
  if (!bytes.subarray(Math.max(0, bytes.length - 1024)).toString('latin1').includes('%%EOF')) throw new FileError(415, 'NOT_A_PDF', 'The PDF looks incomplete or damaged.')
  if (FORBIDDEN.test(bytes.toString('latin1'))) throw new FileError(415, 'UNSAFE_PDF', 'This PDF contains active content (scripts, launch actions or embedded files) and cannot be accepted.')
  return bytes
}

// The name shown to people; the browser-supplied name is never used as a path.
export function cleanFileName(raw) {
  if (typeof raw !== 'string') return null
  const base = raw.split(/[\\/]/).pop().replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '').trim()
  if (!/\.pdf$/i.test(base) || base.length < 5 || base.length > 100) return null
  return base
}

const fileAad = ({ patientId, reportId }) => Buffer.from(`nr-file|v1|patientId:${patientId}|reportId:${reportId}`, 'utf8')

// dir must be an absolute path outside the project and outside OneDrive. Nothing is created until the first write.
export function createFileStore({ dir }) {
  if (typeof dir !== 'string' || !path.isAbsolute(dir)) throw new Error('Report file directory must be an absolute path.')
  const root = path.resolve(dir)
  const rel = path.relative(PROJECT_ROOT, root)
  if (!rel.startsWith('..') && !path.isAbsolute(rel)) throw new Error('Report file directory must be outside the project.')
  if (/[\\/]onedrive([\\/]|$)/i.test(root)) throw new Error('Report file directory must be outside OneDrive.')

  const full = name => { if (!NAME_RE.test(name)) throw new FileError(500, 'STORAGE_ERROR', 'Invalid stored file name.'); return path.join(root, name) }
  return {
    // Writes the encrypted file; returns the random storage name.
    write(bytes, { key, patientId, reportId }) {
      const env = encrypt(bytes, { key, aad: fileAad({ patientId, reportId }) })
      const name = `${crypto.randomBytes(16).toString('hex')}.enc`
      fs.mkdirSync(root, { recursive: true, mode: 0o700 })
      const tmp = `${full(name)}.tmp`
      fs.writeFileSync(tmp, Buffer.concat([MAGIC, env.iv, env.authTag, env.ciphertext]), { flag: 'wx', mode: 0o600 })
      fs.renameSync(tmp, full(name))
      return name
    },
    read(name, { key, patientId, reportId }) {
      let raw
      try { raw = fs.readFileSync(full(name)) } catch { throw new FileError(500, 'STORAGE_ERROR', 'The stored file is not available.') }
      if (raw.length < 33 || !raw.subarray(0, 4).equals(MAGIC)) throw new FileError(500, 'STORAGE_ERROR', 'The stored file is damaged.')
      return decrypt({ iv: raw.subarray(4, 16), authTag: raw.subarray(16, 32), ciphertext: raw.subarray(32) }, { key, aad: fileAad({ patientId, reportId }) })
    },
    remove(name) { try { fs.rmSync(full(name), { force: true }) } catch { /* nothing to clean */ } },
  }
}
