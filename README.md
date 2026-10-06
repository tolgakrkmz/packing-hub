# Package Hub

A production dashboard built with plain HTML, CSS and JavaScript. It helps plan
shift teams, assign pair targets, record production and downtime, and review
monthly results. It supports offline file mode and shared server mode.

**Portfolio demonstration: every employee, production record and packing
instruction in this repository is fictional. No company documents are included.**

## Features

- Production and scrap logging with monthly history and totals.
- Line downtime reports with causes and monthly breakdowns.
- Personnel management and a shared rotating shift schedule.
- Pair targets in kilograms and crates, actual output and reasons for missed goals.
- Automatic shift selection at 06:00, 14:00 and 22:00; overnight shifts retain their start date.
- Packing instructions with search and a fictional sample profile.
- Monthly statistics and compact file connection panels.
- Bulgarian and English interface with a remembered language choice.

Bulgarian is the default. Use the BG / EN buttons at the top of any screen to
switch languages without reloading or losing unfinished form input. The choice
is remembered in this browser and applies to every module. Names, notes, document
contents and saved identifiers retain their original text. The demo stores its
language preference separately from the production application.

Source filenames and this README are in English. In offline mode, the pair
targets module opens directly without a role login.

## Shared server mode

Administrators can set individual account permissions to **Role default**,
**Allowed**, or **Denied** in Accounts. Existing accounts inherit role defaults
when the database is upgraded; accounts, reports and sessions are preserved.
Saving account changes revokes its sessions immediately, including live streams.

| Permission | Administrator | Operator | Observer |
| --- | --- | --- | --- |
| Import data | Allowed | Unavailable | Unavailable |
| Export reports | Allowed | Allowed | Allowed |
| Add reports | Allowed | Allowed | Unavailable |
| Correct/delete recorded reports | Allowed | Denied | Unavailable |

Role limits remain enforced even for explicit overrides. Import permission
controls both import workflows independently of report write permissions.
Operators with correction permission can correct/delete production and downtime
entries and correct pair results; goals, downtime reasons, personnel, instructions
and account management retain administrator restrictions. For pairs, creating or
changing an unreported plan, removing an unreported plan, and entering its first
result use the add-report permission. Recorded plans retain validation safeguards.
Operators now need an explicit correction grant to change an already reported
pair result.

The Personnel / Shifts module and its full data API are administrator-only.
Statistics is available to administrators and observers; operators cannot open
it or access its workforce API. Navigation follows these fixed role limits.
Pair planning uses a separate read-only list of active packers with only the
fields needed for selection. Workforce statistics receive aggregate counts,
not personnel identities, notes, settings or movement history. Both read views
refresh automatically after administrator changes to personnel.

The server bar offers JSON exports of production, downtime and pair reports via
authenticated `/api/export/<module>` endpoints. Exports use current server data
and record only action metadata in the audit log. Denying export removes these
controls and blocks the export API; it does not prevent copying information the
account is allowed to view. Instruction attachments keep their separate viewing
behavior. These permissions apply to shared server mode.

The server uses Node.js 24+ and SQLite without npm dependencies. All five module
documents, accounts, sessions and packing attachments live in one local database.
A new database starts empty, without employee seeds, reports or default accounts.
Clients use the same data through a browser, without picking JSON files or
installing an application. Statistics reads the shared module data.

An administrator creates accounts and assigns these roles:

| Role | Access |
| --- | --- |
| Administrator | All modules, corrections, personnel, instructions, goals/reasons and accounts. |
| Operator | Read all modules; append production/downtime; plan and report pairs. Cannot change existing production/downtime, personnel, instructions, goals/reasons or accounts. |
| Observer | Read modules, reports and attachments. Cannot write. |

The server checks authorization on every API write. Passwords use salted scrypt
hashes. Sessions use HttpOnly, SameSite cookies, expire after 12 hours and are
revoked when an account is changed or disabled. HTTPS also uses Secure cookies.
Writes require the configured origin, a session CSRF token and the latest
document/file revision. Stale writes return a conflict instead of replacing
someone else's changes. Pair planning checks the current packer roster and
preserves reported plans and historical members.

After a committed change, connected browsers receive an event and reload the
affected data. Busy report forms finish saving first. Disconnected browsers
reconnect and fetch current data. A code update requires deploying the new
container; open pages then offer a refresh button to preserve unfinished input.
Server/internet outages prevent shared writes. Wait for a confirmed save before
considering an entry recorded.

### CasaOS and a provided HTTPS address

Use this checked source checkout on the Linux CasaOS host, separately from live
production files. Docker Engine and the Docker Compose plugin must be available
on the host. The included Compose file builds the image locally from a terminal.
The Docker image and external connection must be verified on the target server.

1. Install [Tailscale for Linux](https://tailscale.com/download/linux) on the
   **server**, sign in with `sudo tailscale up`, and enable MagicDNS/HTTPS for the
   Tailscale account. Clients only need a browser.
2. Obtain the server's full `*.ts.net` DNS name from its device details. In a local
   `.env` beside `compose.yaml`, set `HUB_PUBLIC_ORIGIN` to that exact HTTPS origin,
   such as `https://demo-hub.example-tailnet.ts.net`, without a trailing slash.
   This example is a placeholder, not a deployed URL. Keep `.env` local.
3. Build and start the empty server:

   ```sh
   docker compose up -d --build
   docker compose ps
   ```

4. Create an administrator interactively in the host terminal. Choose your own
   username; the password is entered invisibly and is never a command argument:

   ```sh
   docker compose exec package-hub node server/manage.cjs create-admin admin
   ```

5. Expose only the app's localhost port using
   [Tailscale Funnel](https://tailscale.com/docs/features/tailscale-funnel):

   ```sh
   sudo tailscale funnel --bg 3000
   sudo tailscale funnel status
   ```

   Complete the first-time Funnel approval. Check that the printed HTTPS address
   matches `HUB_PUBLIC_ORIGIN`; if it differs, correct `.env` and recreate the
   service. Funnel provides an HTTPS `*.ts.net` URL for people without Tailscale;
   `--bg` persists across restarts. Funnel is currently beta and has bandwidth
   limits. Review those limits before relying on it for daily production.
6. Sign in at that address and create operator/observer accounts from Accounts.
   First verify from a phone using mobile data: enter a **fictional** report,
   check another browser's statistics, view an attachment and verify an observer
   cannot save. Reboot the host and check persistence and access.

The app port binds to host `127.0.0.1`, not the LAN. The app runs as an
unprivileged user, with a read-only application filesystem and a persistent
`hub-data` volume. Expose only this app through Funnel. The Docker build context
excludes demo data, databases, environment files, Git history and test artifacts.

### Import all legacy module data

Keep an untouched local copy of the current production folder after the last
entry in the old application. On that computer, sign in as an administrator and
choose **Data import** in the account bar. Select these current JSON files:

| Module | File |
| --- | --- |
| Production and scrap | `production-log.json` |
| Downtime | `line-downtime.json` |
| Personnel, shifts and movement history | `personnel.json` |
| Pair plans and reports | `pair-targets.json` |
| Packing instruction index | `package-instructions.json` |

For packing instructions, also select the `data` folder, `profiles` folder or the
old application folder. A selected folder can supply JSON files at its root or
under `data`. Only files referenced by the instruction index and each profile's
optional `instruction.txt` are uploaded. Nested customer/profile folders are
preserved. Code, unrelated files and backup copies in deeper folders are skipped.
Do not send live files to chat, this source checkout, GitHub, tests or attachments.

Check the preview table, including missing files, settings changes and movement
history. The settings checkbox controls copying the production goal, adding
legacy downtime reasons and importing provided Stickers settings. Existing
reasons are retained. Unselected modules remain unchanged. A full migration needs
all five files and the instruction folders; missing modules show dashes.

Identical IDs/content and identical attachments are skipped. Different records
with the same ID, changed attachments at an existing path, overlapping pair
members or missing referenced attachments block the **whole** import. Legacy
personnel is normalized through the same model as the Personnel screen.
Historical pair snapshots and reports remain valid even for retired members.
Existing site records and movement history are retained.

JSON is limited to 20 MB combined; attachments to 20 MB each, 5000 files and 1 GB
in total. Uploads are staged privately beside SQLite for up to four hours and
can be cancelled. Browser data is not written to localStorage/IndexedDB. Only an
administrator may import, and each upload belongs to its creating administrator.
A changed database or attachment requires a new preview. Confirmation first
creates a consistent private snapshot under `import-backups`, then commits all
selected modules and attachments in one SQLite transaction. Backup failure
blocks the import. Completed/cancelled staging is removed; expired staging is
cleared on later imports. Backup retention remains manual.

Verify all modules and Reports, then enter new data only on the site. Old files
remain an archive; the old application does not synchronize automatically.
The earlier production-only importer remains available at `production-import.html`.

### Backup and updates

Create a consistent local SQLite snapshot before an update. Use a new destination
filename each time. The snapshot contains accounts and module data and must stay
private, outside the source checkout:

```sh
docker compose exec package-hub node server/manage.cjs backup /var/lib/package-hub/backup-before-update.sqlite
docker compose cp package-hub:/var/lib/package-hub/backup-before-update.sqlite /srv/hub-backups/backup-before-update.sqlite
```

Create `/srv/hub-backups` with restricted host permissions first. Keep a protected
copy on a separate local disk. Backup scheduling and retention are manual in this
version. Use the snapshot command instead of copying an actively written database.

Deploy reviewed code with `docker compose up -d --build` from the same Compose
project/directory. The named volume survives container recreation. Keep the
previous source revision available for rollback. **Do not remove the volume or
run `docker compose down -v`.** To restore, stop the service, replace its database
with a verified snapshot under the container user's ownership, remove obsolete
WAL/SHM sidecars only while stopped, then restart. Test restore with fictional data
before relying on backups.

### Automatic updates after merging into main

A host-side systemd timer can check the approved GitHub `main` branch every two
minutes and deploy changes without uploading site data or exposing a webhook.
The source checkout, local `.env`, Docker Engine/Compose and systemd remain on
the CasaOS host. Use the **existing** Compose project and its persistent volume.
Install from a clean `main` checkout on that host:

```sh
sudo bash scripts/install-auto-update.sh /absolute/path/to/clean/source/checkout /absolute/path/to/existing/compose/project
sudo systemctl status package-hub-auto-update.timer
```

The installer identifies the currently running container's Compose project and
checks that the supplied deployment directory owns it. The source checkout may
be separate from the original deployment folder; a root-only build override
selects that clean source without moving the existing `.env` or data. It installs
reviewed updater code in
`/usr/local/libexec` and root-only configuration outside the checkout. The timer
runs after boot and every two minutes after the previous attempt finishes.
Successful changes take the polling interval plus build/startup time; container
replacement causes a short interruption. Open pages then offer the refresh
button described above. An unchanged `main` does not rebuild or restart anything.

Each update requires a clean `main` checkout, the approved repository origin and
a fast-forward history. Changes to `compose.yaml` require manual review and
installation so an automatic update cannot silently change the volume or network
configuration. The updater builds while the old container stays running and
checks startup against an isolated in-memory database. Before replacement it
creates a private SQLite snapshot under the **existing** data volume's
`auto-backups` directory. Build/startup/backup failures cancel replacement.
Snapshots contain site data and accounts; keep them on the host. Retention remains
manual; this timer never deletes backups or sends them to GitHub.

The new container must pass Docker health checks, use the same named data volume
and built image, and answer the local health endpoint. Failed activation attempts
restore the previous image and record the failed source revision. That revision
is blocked on later polls until an administrator intervenes or a newer revision
arrives. Image rollback preserves the current database; it does not undo schema
migrations or restore old data. Releases that change database compatibility need
an administrator-reviewed migration/rollback plan.

Local status and private diagnostics:

```sh
sudo systemctl status package-hub-auto-update.service
sudo journalctl -u package-hub-auto-update.service
sudo cat /var/lib/package-hub-deploy/last-good
```

Detailed build diagnostics remain in `/var/lib/package-hub-deploy/last-run.log`.
The latest failed attempt is retained separately in `last-failure.log` so an
unchanged poll does not erase its diagnostics.
After fixing a failed revision, an administrator may remove the local
`last-failed` marker and start the service again. Pause automatic updates with
`sudo systemctl disable --now package-hub-auto-update.timer`; an already-running
service finishes separately. Updating the installed updater itself requires
rerunning the installer from reviewed `main` source.

The behavior is verified with isolated command-boundary tests for successful
updates, unchanged revisions, locking, local edits, wrong origins, diverged
history, configuration changes, fetch/build/startup/backup failures, failed
health checks, changed volumes and image rollback failure. These tests do not
replace a host-side container update and reboot check.

[Docker Compose update and volume behavior](https://docs.docker.com/reference/cli/docker/compose/up/)
and [systemd timer semantics](https://github.com/systemd/systemd/blob/main/man/systemd.timer.xml)
provide the underlying deployment behavior.

Local development can explicitly allow localhost HTTP:

```sh
HUB_DATABASE=/tmp/hub-demo.sqlite node server/manage.cjs create-admin demo-admin
HUB_DATABASE=/tmp/hub-demo.sqlite HUB_ALLOW_HTTP=true HUB_PUBLIC_ORIGIN=http://127.0.0.1:3000 node server/server.cjs
```

Use only fictional development records. HTTP mode refuses non-localhost origins.

## Run locally in offline mode

1. Download or clone the repository into a separate demo folder.
2. Open `index.html` in Chrome or Edge. No installation or internet connection is required.
3. Connect the corresponding JSON fixtures from `data/` when opening a module.
4. For Pair Targets, select both `pair-targets.json` and `personnel.json`.
5. For Statistics, select the production, downtime, personnel and pair-targets fixtures.
6. For Packing Instructions, select the repository folder containing `data/`.

Offline demo mode has no login or role restrictions. Permissions to read or
write files are provided by the browser and operating system. Use server mode
for account authentication and enforced role permissions.

Only use the fictional demo files. File connections are remembered in IndexedDB
and refresh every 20 seconds. Saving changes modifies the selected local files.
The demo uses separate browser storage names to avoid loading existing production
connections. Browsers without direct file access use manual import/export.

Files are validated for the selected module before loading, refreshing or saving.
Empty, malformed and incompatible JSON leaves the last accepted data intact and
blocks writes until a valid file is connected. Filenames do not identify the
module; supported older personnel formats retain their existing records. Opening
a personnel file or packing index does not rewrite it. New files and indexes
require an explicit create action, which refuses to replace existing content.

Personnel starts without a roster and asks you to select a file. Only people from
that file appear; creating a new file starts with an empty roster. Adding people
and changing settings requires a valid connection. The bundled fictional roster
is available by opening `data/personnel.json`.

## Technical choices

- Plain scripts support opening the project through `file://` without module CORS issues.
- File System Access API for user-selected local files and folders.
- IndexedDB for remembered handles; local storage for manual import/export fallback.
- Shared shift scheduling and a separately validated pair-target data model.
- Production and pair reports stay separate to avoid counting output twice.
- JSON storage is intended for a small local workflow. Multiple writers are not
  coordinated by a transactional server; concurrent saves can still conflict.

## Account management

The Accounts screen shows a compact searchable list with filters for activity and
role. Expand an account to change its role, active status and the four permission
checkboxes: import, export, report creation and report correction/deletion.
Unavailable rights stay disabled according to role limits. Unchanged rights keep
their existing inheritance; Reset permissions to role restores role defaults.
Password changes and new-account creation expand on demand. Saving one account
keeps unsaved edits in other accounts. Controls adapt to narrow phone screens.

## Responsive interface

The shared layout preserves the dark palette and each module's accent color.
The home grid adapts from three columns to two and then one on phones. Forms,
account controls and dialogs fit narrow screens. Buttons have a minimum 44 px
height; mobile input text is at least 16 px. Wide report tables and the shift
calendar scroll inside their own containers. Keyboard focus remains visible,
and reduced-motion preferences disable decorative movement.

Browser checks cover Bulgarian and English at 320, 390, 768 and 1440 px in both
file and server modes, including accounts and import screens in server mode.
These are Chrome checks; Safari/iOS and Android devices still need a manual
check before production deployment.

## Report dates

Production and downtime reports use one date field. Before 10:00, rotating teams
default to yesterday for delayed night reports; selecting Stickers defaults to
today. Changing the date or using Yesterday makes the choice manual and preserves
it when switching teams. The visible date is the date saved in the report.

## Save recovery

Production and downtime keep form input and restore the accepted history and totals
when file reads, permissions or writes fail. A visible status and Try again button
allow another attempt, including deletions, the monthly goal and downtime reasons.
Reports retain the same ID across retries. If a failed close actually saved the
report, retry confirms the existing entry instead of adding another. Form edits
clear the old retry action; changed records are refused before deletion.

## Statistics navigation

The monthly result stays above every statistics section. Switch between Overview,
Production, Pair Targets, Downtime, and Workforce Capacity; only one section is
shown at a time. The last section is remembered separately in demo browser storage.
Choose the monthly year and month at the top. Production and downtime support
monthly/yearly breakdowns. Detailed tables, the daily trend, and pair comparisons
expand on demand. The Files button shows connections and keeps the file panel
closed until requested. Without production records, the monthly result offers a
connection button while the other sections remain available.

## Pair target statistics

New pairs use only active people with the personnel role `Опаковчик` (packer)
from the selected team, including Stickers. Other roles and people without an
assigned role are excluded from the roster, counts and new pair selection.
Existing pairs and reports remain available after personnel roles change.

Statistics reads the same pair-targets file without modifying it. Its independent
month and team filters work even when no production or personnel file is connected.
It shows reporting coverage, success rate, kilograms and crates against reported
targets, the full plan, per-pair deficits, team comparisons and expandable reasons
and reports. Pending plans are excluded from success and output ratios. Both
targets must be met for success. Pair output is never added to production totals.
Mixed packaging remains one report; actual hours and per-line quantities are not
available. Reasons count reports, not downtime minutes.

## Tests

With Node.js 20 or newer:

```sh
node --test tests/*.test.cjs
```

The tests cover shift boundaries, rotation, pair allocation, target validation,
report scope, failure reasons, read-only personnel access, stale file refreshes,
pair statistics including pending plans, weighted ratios and per-pair deficits,
and language preferences, dynamic translations and preserved identifiers.

Server checks require **Node.js 24+**:

```sh
node --test tests/server/*.test.cjs
node scripts/run-server-browser-tests.cjs
```

The second command needs the same Chrome and Playwright installation as the
offline browser runner below and defaults to a **visible Chrome**. Eight flows
cover account creation/login, mobile operator reports and live observer
statistics, personnel and pair reports, shared instructions/attachments,
observer controls and revoked access. Each run uses an isolated temporary SQLite
database and fictional inputs, then removes it. Server tests also check API
permissions, CSRF/origin rejection, stale and simultaneous writes, roster rules,
live events, persistence, backups and login throttling. Docker, Funnel and the
actual CasaOS reboot/restore still require target-host checks.

### Visible browser tests

Install Node.js 20+, Google Chrome and the test dependency in this **demo** checkout:

```sh
npm install --no-save --package-lock=false playwright@1.62.1
node scripts/run-browser-tests.cjs
```

The default opens a visible, separate Chrome profile, slows actions by 350 ms,
and labels the current scenario on screen. Do not click inside the test window
while it runs. The terminal prints PASS/FAIL for each scenario and exits with a
nonzero status if any fails. `--headed` is also accepted; use `--headless` only
when a background run is wanted. Close the browser or stop the terminal to cancel.
The test window closes when the run completes; each run starts with fresh storage.

The ten scenarios exercise the actual pages and scripts through their controls:

| Module | Browser coverage |
| --- | --- |
| Complete reporting flow | Enter tonnage, scrap, automatic/manual kg and crates; write native files; reload; verify daily history, monthly goal, monthly/yearly tables, charts and line/team breakdowns. Check multiple months/years and that pair output does not increase tonnage. |
| Downtime | Overnight duration, Other validation, notes, reason creation/removal, deletion and report totals. |
| Personnel | Add, search, move, deactivate, settings, shift calendar, persisted changes and workforce counts/productivity from production data. |
| Pairs | Packer-only roster, Stickers, plan/edit/remove, prevent reuse, require missed-target reasons, report/correct, history, monthly/team results and deficits. |
| Packing | Create instructions and attachments, native text files, image preview, attachment download, categories/search, local and external bulk imports and copied instructions. |
| File access and recovery | Create/refuse overwrite, cancel, reject malformed/wrong-module JSON, refresh/reload, retain another writer's records, failed read/write and ambiguous close, retained draft and retry without duplication; downtime retry. |
| Manual fallback | Import/export JSON, browser persistence and read-only statistics. |
| Navigation/languages/mobile | All six hub links and BG/EN switching without losing visible input. Connected pages, expanded history, statistics sections and dialogs at 320, 390, 768 and 1440 px; no page overflow, touch button heights and readable mobile fields. |

Only the reviewed demo HTML/CSS/JS is served on a temporary `127.0.0.1` port.
The runner validates served sources with the publication checker and rejects a
production seed. It does not serve the repository data directory or access a
personal browser profile. Fixtures are generated in isolated browser storage;
no real personnel, reports, documents or credentials are needed. External
network requests are blocked. No screenshots or traces are uploaded. Screenshots
are off by default; the server runner accepts `--screenshots=/tmp/hub-demo-previews`
to save fictional account views locally, outside the source checkout.

The test replaces the OS file/directory picker with handles to Chrome's
[origin-private file system](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system).
The DOM, application logic, file reads/writes/closes and IndexedDB handle storage
are real browser APIs. Failed reads/writes are injected at that API boundary.
Assertions read the saved fixture files as well as the visible reports; business
functions are not called directly to skip the UI.

This is broad workflow coverage, not proof of every input combination. Native OS
choosers/permission prompts, the production `file://` launch and Windows network
drive behavior still need a manual run on the target computer using a separate
fictional test folder. Truly simultaneous shared-disk writes are not atomic;
the second-writer scenario checks refresh-before-save, not transaction isolation.

## Publication safeguards

Company and employee data must never be uploaded, including to private repositories.
After cloning, enable the local commit and push checks:

```sh
node scripts/install-hooks.cjs
```

The checks inspect the staged Git content and every outgoing commit, including
older commits beneath a cleaned tip. Only the exact reviewed demo data fixtures
are accepted. Unknown documents, binaries, changed fixtures, non-demo credentials,
and known private-source matches are blocked. In the development workspace,
private references are read locally; their values are never stored in this repo
or printed by the checker. The checks also apply to feature branches.

Automation cannot identify every possible confidential value. Review the source
changes before publication; stop if any content is uncertain. Never bypass the
hooks with `--no-verify`. Local hooks must be installed in every new clone.

## Project structure

- `*.html`: independent application screens.
- `css/`: shared theme and screen styles.
- `js/`: application logic, file access and shared models.
- `data/`: reviewed fictional fixtures only.
- `tests/`: Node.js tests for scheduling, pair targets and file synchronization.
- `server/`: shared SQLite storage, account management and authenticated HTTP API.
- `Dockerfile`, `compose.yaml`: local CasaOS server deployment.

## Publication

This repository contains a sanitized portfolio snapshot. No distribution license
has been selected. Never replace these fixtures with real personnel, customer documents or factory
records in a commit. Removing a file in a later commit does not erase its history.
