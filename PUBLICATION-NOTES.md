# Portfolio data review

- Fictional data replaces the live JSON files and JavaScript personnel seed.
- Real passwords are replaced with the public demo password; unused shift credentials are removed.
- Real packing documents, product identifiers and customer data are excluded.
- The browser storage namespace is separate from the production application.
- Source filenames and README are English; the interface supports BG / EN with Bulgarian as the default.
- No distribution license has been selected.
- This snapshot is prepared for the public demo repository `tolgakrkmz/packing-hub`.
- The Node.js suite covers the application, fictional fixtures, and publication safeguards.
- Local commit and push hooks inspect the index and outgoing history. Install them after cloning.
- Company and employee data must never be uploaded, including to private repositories.
- Keep this repository separate from the production folder and its backups.
- Push checks still inspect every outgoing commit, including the full history of a new branch.
  Batched Git reads reuse successful checks only within the current invocation, with the
  same private reference tokens and an exact match on blob, path and regular file mode.
  Blob contents are not cached. Incomplete or malformed Git responses block publication.
- Batch metadata covers at most 512 objects at a time; content groups target 8 MiB,
  with individual blobs retaining the existing 32 MiB limit. The successful-check
  cache is bounded and eviction causes rechecking.
- Run `node scripts/run-publication-benchmarks.cjs` locally to measure the complete
  outgoing history at `HEAD`, or pass a full commit ID to compare the same history
  before and after a scanner change. Output contains only pass/fail, commit and file
  counts, Git blob-process count, elapsed milliseconds and peak process RSS in KiB.
