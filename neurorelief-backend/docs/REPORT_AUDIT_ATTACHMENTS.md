# Report Audit: doctor-returned attachments (NOT implemented)

Status: **not supported by the backend, so there is no attachment UI.** The doctor review screen only says that returning reviewed files is not available yet. Nothing pretends to upload or save a file.

## What exists
- `report_versions` (migration 001) already has a `reviewed_attachment` kind with `storage_name`, `attachment_name` and related columns and constraints. The table is a schema placeholder only.
- `report_audit_events` has event types reserved for versions.

## What is missing (needed before any attachment UI)
1. Service functions and routes, for example `POST /api/reports/inbox/:shareId/versions` (doctor upload) and `GET /api/reports/.../versions/:n/file` (doctor and patient download). None exist in `routes/reports.js` or `lib/reportService.js`.
2. A larger, route-specific JSON body limit (the global limit is 100 KB) or multipart handling, with a 5 MB decoded cap.
3. Validation of the file type by magic bytes (PDF, PNG, JPEG only), filename sanitising and a per-share limit.
4. A private storage directory outside the web roots, the repository and OneDrive, with temp-file-then-rename writes and cleanup if the database insert fails.
5. Authorised downloads only (access rules as for notes: addressed doctor or owning patient, share not revoked, appointment still confirmed), sent as `attachment` with `nosniff` and `no-store`, fetched with the Authorization header (never a token in the URL).
6. Audit events for upload and download, and tests (bad magic bytes, SVG/HTML, oversize, bad base64, traversal names, access matrix, cleanup on failure).

Whether attachments may be stored encrypted is a separate decision and is not part of this note.
