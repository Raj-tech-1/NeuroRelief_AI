// Uploaded-PDF report tests. SCRATCH ONLY: fictional in-memory database, random in-memory key, a temp directory for the
// encrypted files (removed on close), ephemeral 127.0.0.1 ports. Nothing here opens the real database or reads .env.
//   Run:  node --test tests/report-upload.test.mjs
import { describe, it, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { makeEnv, confirmAppointment, consentBody, PERIOD } from './helpers/apiHarness.mjs'
import { createFileStore, decodePdf, FileError } from '../lib/reportFiles.js'

const envs = []
const env = async o => { const e = await makeEnv(o); envs.push(e); return e }
afterEach(async () => { while (envs.length) await envs.pop().close() })

const MARK = 'ZZ-PDF-PLAINTEXT-MARKER-91c2'
const pdf = (extra = '') => Buffer.from(`%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n% ${MARK} ${extra}\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n`)
const b64 = b => Buffer.from(b).toString('base64')
const upload = (e, { as = 1, title = 'Outside lab report', fileName = 'lab.pdf', bytes = pdf(), data } = {}) =>
  e.post('/uploads', { as, body: { title, fileName, dataBase64: data ?? b64(bytes) } })
const download = async (e, p, as) => {
  const r = await fetch(e.base + p, { headers: { Authorization: `Bearer ${e.token(as, as === 3 || as === 4 ? 'doctor' : 'user')}` } })
  return { status: r.status, headers: r.headers, bytes: Buffer.from(await r.arrayBuffer()) }
}
const listing = e => fs.readdirSync(e.filesDir)
const sharedUpload = async () => {
  const e = await env(); confirmAppointment(e)
  const up = await upload(e)
  const s = await e.post(`/${up.json.reportId}/shares`, { as: 1, body: consentBody(e) })
  return { e, reportId: up.json.reportId, shareId: s.json.shareId }
}

describe('1. Valid upload', () => {
  it('stores the PDF encrypted, returns no path, lists it as an uploaded report', async () => {
    const e = await env(); const r = await upload(e)
    assert.equal(r.status, 201); assert.equal(r.json.kind, 'uploaded_pdf'); assert.equal(r.json.title, 'Outside lab report')
    assert.ok(!/\.enc|storage|path/i.test(r.text), 'response must not reveal storage details')
    const files = listing(e); assert.equal(files.length, 1); assert.match(files[0], /^[a-f0-9]{32}\.enc$/)
    const onDisk = fs.readFileSync(path.join(e.filesDir, files[0]))
    assert.ok(!onDisk.includes(MARK) && !onDisk.includes('%PDF-'), 'the stored file must not contain plaintext PDF content')
    const list = (await e.get('/', { as: 1 })).json
    assert.equal(list.length, 1); assert.equal(list[0].kind, 'uploaded_pdf'); assert.equal(list[0].status, 'draft')
    const one = (await e.get(`/${r.json.reportId}`, { as: 1 })).json
    assert.equal(one.kind, 'uploaded_pdf'); assert.equal(one.snapshot.file.name, 'lab.pdf'); assert.equal(one.snapshot.file.size, pdf().length)
    assert.equal(one.snapshot.storageName, undefined, 'the storage name is never sent to a browser')
    assert.ok(!e.rows('SELECT hex(ciphertext) AS h FROM report_originals')[0].h.includes(Buffer.from(MARK).toString('hex').toUpperCase().slice(0, 20)))
  })
  it('lets the owner download the identical bytes with safe headers, and audits it', async () => {
    const e = await env(); const r = await upload(e)
    const d = await download(e, `/${r.json.reportId}/file`, 1)
    assert.equal(d.status, 200); assert.ok(d.bytes.equals(pdf()))
    assert.equal(d.headers.get('content-type'), 'application/pdf'); assert.match(d.headers.get('content-disposition'), /^attachment;/)
    assert.equal(d.headers.get('x-content-type-options'), 'nosniff'); assert.match(d.headers.get('cache-control'), /no-store/)
    assert.equal(e.rows("SELECT COUNT(*) AS n FROM report_audit_events WHERE event_type = 'original_downloaded' AND detail_code = 'owner_file'")[0].n, 1)
  })
})

describe('2. Rejected uploads (checked on the server)', () => {
  const cases = [
    ['a PNG renamed to .pdf', { bytes: Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]) }, 415, 'NOT_A_PDF'],
    ['a wrong extension', { fileName: 'lab.png' }, 415, 'NOT_A_PDF'],
    ['no file name', { fileName: '' }, 415, 'NOT_A_PDF'],
    ['an empty file', { data: '' }, 400, 'INVALID_FILE'],
    ['invalid base64', { data: 'not base64!!' }, 400, 'INVALID_FILE'],
    ['a truncated PDF (no %%EOF)', { bytes: Buffer.from('%PDF-1.4\n' + 'x'.repeat(100)) }, 415, 'NOT_A_PDF'],
    ['a PDF with JavaScript', { bytes: pdf('/JavaScript (app.alert(1))') }, 415, 'UNSAFE_PDF'],
    ['a PDF with a launch action', { bytes: pdf('/Launch') }, 415, 'UNSAFE_PDF'],
    ['a PDF with an embedded file', { bytes: pdf('/EmbeddedFile') }, 415, 'UNSAFE_PDF'],
    ['an empty title', { title: '  ' }, 400, 'INVALID_INPUT'],
    ['a too-long title', { title: 'x'.repeat(121) }, 400, 'INVALID_INPUT'],
  ]
  for (const [name, args, status, code] of cases) {
    it(`rejects ${name}; nothing is stored`, async () => {
      const e = await env(); const r = await upload(e, args)
      assert.equal(r.status, status, r.text); assert.equal(r.json.code, code)
      assert.equal(listing(e).length, 0); assert.equal(e.rows('SELECT COUNT(*) AS n FROM report_originals')[0].n, 0)
    })
  }
  it('rejects a file over 5 MB (exactly 5 MB is allowed)', async () => {
    const e = await env()
    const big = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(5 * 1024 * 1024 - 9 - 7, 0x41), Buffer.from('\n%%EOF\n')])
    assert.equal(big.length, 5 * 1024 * 1024)
    assert.equal((await upload(e, { bytes: big })).status, 201)
    const tooBig = Buffer.concat([big, Buffer.from('A')])
    const r = await upload(e, { bytes: Buffer.concat([tooBig.subarray(0, tooBig.length - 7 - 1), Buffer.from('AA\n%%EOF\n')]) })
    assert.equal(r.status, 413); assert.equal(r.json.code, 'FILE_TOO_LARGE')
    assert.equal(listing(e).length, 1)
  })
  it('requires a signed-in patient (no token 401, doctor 403)', async () => {
    const e = await env()
    assert.equal((await e.post('/uploads', { body: { title: 'x', fileName: 'a.pdf', dataBase64: b64(pdf()) } })).status, 401)
    assert.equal((await upload(e, { as: 3 })).status, 403)
    assert.equal(listing(e).length, 0)
  })
  it('says so (503) when no private file storage is configured', async () => {
    const e = await env({ files: false })
    assert.deepEqual((await e.get('/status', { as: 1 })).json, { enabled: true, uploads: false })
    const r = await upload(e); assert.equal(r.status, 503); assert.equal(r.json.code, 'UPLOADS_UNAVAILABLE')
  })
  it('leaves no orphan file if the record cannot be saved', async () => {
    const e = await env({ failAudit: true }); const r = await upload(e)
    assert.equal(r.status, 500); assert.equal(listing(e).length, 0); assert.equal(e.rows('SELECT COUNT(*) AS n FROM report_originals')[0].n, 0)
  })
  it('decodePdf is strict about size and encoding', () => {
    assert.throws(() => decodePdf('A'.repeat(7_000_000)), err => err instanceof FileError && err.code === 'FILE_TOO_LARGE')
    assert.throws(() => decodePdf('abc'), err => err.code === 'INVALID_FILE')
  })
  it('refuses a storage directory inside the project or OneDrive', () => {
    assert.throws(() => createFileStore({ dir: path.resolve('tests', 'x-files') }), /outside the project/)
    assert.throws(() => createFileStore({ dir: 'C:\\Users\\Someone\\OneDrive\\Desktop\\files' }), /OneDrive/)
    assert.throws(() => createFileStore({ dir: 'relative/dir' }), /absolute/)
  })
})

describe('3. Doctor eligibility for sharing an uploaded report', () => {
  const tryShare = async (status, body) => {
    const e = await env(); e.db.run("UPDATE appointments SET status = ? WHERE appointment_id = 1", [status])
    const up = await upload(e); const r = await e.post(`/${up.json.reportId}/shares`, { as: 1, body: body ?? consentBody(e) })
    return { e, r }
  }
  it('accepted: allowed, bound to the appointment', async () => {
    const { e, r } = await tryShare('accepted'); assert.equal(r.status, 201)
    assert.equal(e.rows('SELECT appointment_id FROM report_shares')[0].appointment_id, 1)
  })
  for (const st of ['pending', 'declined', 'cancelled']) {
    it(`${st}: refused (403 NOT_ELIGIBLE), nothing shared`, async () => {
      const { e, r } = await tryShare(st); assert.equal(r.status, 403); assert.equal(r.json.code, 'NOT_ELIGIBLE')
      assert.equal(e.rows('SELECT COUNT(*) AS n FROM report_shares')[0].n, 0)
    })
  }
  it("another patient's doctor / appointment is refused, as are invalid ids", async () => {
    const e = await env(); confirmAppointment(e); const up = await upload(e)
    for (const body of [consentBody(e, { doctorId: 2, appointmentId: 2 }), consentBody(e, { appointmentId: 2 }), consentBody(e, { doctorId: 2 }), consentBody(e, { appointmentId: 9999 }), consentBody(e, { doctorId: 'x' })]) {
      const r = await e.post(`/${up.json.reportId}/shares`, { as: 1, body }); assert.ok([400, 403].includes(r.status), `${r.status} ${r.text}`)
    }
    assert.equal(e.rows('SELECT COUNT(*) AS n FROM report_shares')[0].n, 0)
  })
  it('consent is still required for an uploaded report', async () => {
    const e = await env(); confirmAppointment(e); const up = await upload(e)
    assert.equal((await e.post(`/${up.json.reportId}/shares`, { as: 1, body: consentBody(e, { consentAccepted: false }) })).status, 400)
  })
})

describe('4. Access to the shared file', () => {
  it('the selected doctor sees the metadata and downloads the identical PDF, and can review it as usual', async () => {
    const { e, shareId } = await sharedUpload()
    const open = (await e.get(`/inbox/${shareId}`, { as: 3 })).json
    assert.equal(open.kind, 'uploaded_pdf'); assert.equal(open.snapshot.file.name, 'lab.pdf'); assert.equal(open.snapshot.storageName, undefined)
    const d = await download(e, `/inbox/${shareId}/file`, 3)
    assert.equal(d.status, 200); assert.ok(d.bytes.equals(pdf())); assert.match(d.headers.get('content-disposition'), /^attachment;/)
    assert.equal(e.rows("SELECT COUNT(*) AS n FROM report_audit_events WHERE detail_code = 'doctor_file'")[0].n, 1)
    assert.equal((await e.post(`/inbox/${shareId}/status`, { as: 3, body: { status: 'under_review' } })).status, 200)
    assert.equal((await e.post(`/inbox/${shareId}/status`, { as: 3, body: { status: 'changes_requested', note: 'Please upload a clearer scan' } })).status, 200)
    assert.equal((await e.get(`/shares/${shareId}`, { as: 1 })).json.notes[0].text, 'Please upload a clearer scan')
  })
  it('another patient, an unrelated doctor and a patient token on the doctor route get a generic 404/403', async () => {
    const { e, reportId, shareId } = await sharedUpload()
    assert.equal((await download(e, `/${reportId}/file`, 2)).status, 404)
    assert.equal((await download(e, `/inbox/${shareId}/file`, 4)).status, 404)
    assert.equal((await download(e, `/inbox/${shareId}/file`, 1)).status, 403)
    assert.equal((await download(e, `/${reportId}/file`, 3)).status, 403)
    for (const bad of ['abc', '0', '-1', '9999']) { assert.equal((await download(e, `/${bad}/file`, 1)).status, 404, bad); assert.equal((await download(e, `/inbox/${bad}/file`, 3)).status, 404, bad) }
  })
  it('a generated (non-upload) report has no file', async () => {
    const e = await env(); const p = await e.post('/preview', { as: 1, body: PERIOD })
    const r = await e.post('/', { as: 1, body: { ...PERIOD, digest: p.json.digest } })
    assert.equal((await download(e, `/${r.json.reportId}/file`, 1)).status, 404)
  })
  it('revoking ends the doctor\'s file access and report contents; cancelling the appointment does too', async () => {
    const { e, shareId } = await sharedUpload()
    assert.equal((await e.post(`/shares/${shareId}/revoke`, { as: 1 })).status, 200)
    assert.equal((await download(e, `/inbox/${shareId}/file`, 3)).status, 404)
    const view = (await e.get(`/inbox/${shareId}`, { as: 3 })).json
    assert.equal(view.limited, true); assert.equal(view.snapshot, undefined)
    const b = await sharedUpload()
    b.e.db.run("UPDATE appointments SET status = 'cancelled' WHERE appointment_id = 1")
    assert.equal((await download(b.e, `/inbox/${b.shareId}/file`, 3)).status, 404)
    assert.equal((await b.e.get(`/inbox/${b.shareId}`, { as: 3 })).json.snapshot, undefined)
  })
  it('the owner can still download their own file after revoking', async () => {
    const { e, reportId, shareId } = await sharedUpload()
    await e.post(`/shares/${shareId}/revoke`, { as: 1 })
    assert.equal((await download(e, `/${reportId}/file`, 1)).status, 200)
  })
  it('detects a tampered or swapped file instead of serving it', async () => {
    const { e, reportId, shareId } = await sharedUpload()
    const f = path.join(e.filesDir, listing(e)[0]); const raw = fs.readFileSync(f); raw[raw.length - 1] ^= 1; fs.writeFileSync(f, raw)
    for (const [p, as] of [[`/${reportId}/file`, 1], [`/inbox/${shareId}/file`, 3]]) {
      const d = await download(e, p, as); assert.equal(d.status, 500); assert.ok(!d.bytes.includes(MARK))
    }
    const second = await upload(e, { bytes: pdf('second') })
    const files = listing(e); const other = files.find(n => n !== path.basename(f))
    fs.copyFileSync(path.join(e.filesDir, other), f)    // a different (valid) file swapped into place
    assert.equal((await download(e, `/${reportId}/file`, 1)).status, 500)
    assert.equal(second.status, 201)
  })
})

describe('5. Optional title for a generated report', () => {
  it('uses the patient title; the default stays when none is given; bad titles are refused', async () => {
    const e = await env()
    const save = async title => { const p = await e.post('/preview', { as: 1, body: { ...PERIOD, title } }); if (p.status !== 200) return p; return e.post('/', { as: 1, body: { ...PERIOD, title, digest: p.json.digest } }) }
    const named = await save('October 2026 Health Report'); assert.equal(named.status, 201); assert.equal(named.json.title, 'October 2026 Health Report')
    const plain = await save(undefined); assert.match(plain.json.title, /^Health summary \d{4}-\d{2}-\d{2} to /)
    assert.equal((await save('x'.repeat(121))).status, 400)
  })
})
