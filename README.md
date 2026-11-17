# Commonplace

One place for every note: phone, Google Drive, Gemini, Google Home and paper notebooks. Live at https://candlebird.github.io/commonplace/.

- A single `index.html` with no build step (plus `sw.js` and `manifest.webmanifest` so it installs as an app). GitHub Pages serves `main` as-is.
- Google sign-in through the Crusade Dataslate's Firebase project. Notes are private to the account that wrote them: the
  access rules for `notes/*` and `notePhotos/*` are in the Dataslate repo's `firestore.rules`.
- Installed on Android, it appears in the share sheet (Gemini, Docs, Keep, Chrome…). Shared text arrives as `?title=&text=&url=`.
- Imports pasted text, `.txt`/`.md`/`.html` files, Google Keep Takeout `.json`, and its own JSON backups. Photos of paper pages
  can be read with tesseract.js (loaded on demand from jsDelivr) so their text is searchable.

## Data

`notes/{id}`: `{ owner, title, body, labels[], source, notebook, pinned, archived, trashed, hasPhoto, ocr, capturedAt, createdAt, updatedAt }`.
`source` is one of phone, keep, drive, gemini, home, paper, web, other. An empty `notebook` means the note is in the Inbox.
Tags are the `labels` plus any `#hashtags` in the title or body.

`notePhotos/{id}`: `{ owner, data }`, a JPEG data URL shrunk to fit under 700 KB.
