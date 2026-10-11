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
- Every new PACKAGE-HUB chat that creates or changes anything must use its own
  dedicated branch before making changes, including small fixes, documentation,
  configuration and AGENTS.md updates. Never work directly on `main` or reuse
  another chat's branch. Share a branch across chats only when the user explicitly
  requests it. Read-only chats do not require a new branch.
- Stack tasks within the same chat as separate verified commits in that chat's
  dedicated branch. Merge into `main` only when the user requests it, after review
  and successful checks. The privacy rule applies to all branches.
- For all PACKAGE-HUB work, never use the `codex/` branch prefix. Use standard
  purpose-based prefixes: `feature/`, `fix/`, `hotfix/`, `chore/`, `refactor/`,
  `docs/`, `test/` or `release/`. Feature batches within one chat use `feature/`.
- After cloning, run `node scripts/install-hooks.cjs` to enable the local hooks.
- This repository is a separate demo copy; do not copy production data into it.
- Deployment to the production computer is manual. That computer has no Git.
