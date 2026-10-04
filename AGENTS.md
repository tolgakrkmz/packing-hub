# Publication and Git workflow

Never upload company or employee data, including to private repositories.

- Only reviewed source code and approved fictional demo fixtures may be committed.
- Real personnel, production records, incident notes, customers, packing documents,
  credentials, screenshots and attachments must stay out of every branch and PR.
- Check JavaScript personnel seeds and migration logic as well as JSON files.
- Run `node scripts/check-publication.cjs --staged` and relevant tests before
  committing. Run the publication hook before pushing. Never use `--no-verify`.
- If a check fails or content is uncertain, stop publication and remove the
  private content. Never print private values in diagnostic output or save them
  in public test fixtures or manifests.
- Feature branches are used for substantial changes. Merge into `main` only
  after review and successful checks. The privacy rule applies to all branches.
- After cloning, run `node scripts/install-hooks.cjs` to enable the local hooks.
- This repository is a separate demo copy; do not copy production data into it.
- Deployment to the production computer is manual. That computer has no Git.
