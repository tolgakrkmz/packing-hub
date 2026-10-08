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

### Tasks for shift supervisors

The **Tasks** tile is controlled by the account's **View Tasks** permission in
server mode. Administrators and designated supervisors inherit access by default;
an explicit restriction blocks the tile, direct page URLs and all task APIs.
Other operators and observers default to no access. Enable **View Tasks** to give
them a read-only overview of all tasks, history and statistics. This does not grant
assignment, reporting, approval or personnel access. Disabling access revokes the
account's sessions immediately and removes it from new-assignment choices.

In **Accounts**, set an operator's **Shift supervisor (tasks)** flag and team,
and keep **View Tasks** enabled. Use one personal account per supervisor: the
account ID is the responsible person, and the team determines the shift schedule.
Multiple personal accounts may belong to the same team; an assignment is always
to the selected account, not everyone on that team. There is no automatic match
by employee name and no personnel import is needed. This task profile is
independent of production-report permissions and
does not grant personnel, statistics, account or import access. Existing accounts
remain unmarked when the database migrates. Account changes revoke active
sessions; existing assignment snapshots remain in history.

Only administrators assign tasks. A shift task has one responsible supervisor and
uses that team's scheduled shift, with a preview of its start and deadline. Assign
a specific shift or repeat over a period of up to 366 days in the A–D rotation.
Rest days are skipped. Stickers tasks use a specific regular shift, 09:00–17:00
in Europe/Sofia, on the selected date; their recurring calendar is deliberately
not inferred. Existing task snapshots retain their recorded hours. Recurring
plans can be edited for future instances or stopped with a reason. Already
started instances keep their original content, team, owner and deadlines.
Individual unreported shift tasks can be
amended before their deadline; past reports require an explicit reopen and reason.

A global task has one primary owner, optional supervisor participants and a
deadline. Participants add progress/handover notes; only the owner reports its
state. The owner marks it **Ready for review**, then an administrator approves
completion or returns it with a reason. Administrators can amend active tasks,
cancel or reopen them; changes and reasons remain in each task's event history.

The Tasks tile and the Tasks link in the server toolbar show a small count of
work awaiting the signed-in account. Supervisors see started, unreported shift
tasks (including overdue ones), plus pending/in-progress/blocked global tasks
they own or participate in. Future shifts and final reports are excluded. Ready
for review leaves the supervisors' count and enters the administrator's count;
read-only viewers have no action count. Zero hides the badge. Counts refresh on
task changes, reconnection, returning to a tab and every 30 seconds while visible.
The authenticated summary API returns only a count, without task details. A
failed refresh hides the badge until the connection succeeds again.

System browser notifications and Web Push subscriptions are not implemented.

Task clocks use **Europe/Sofia** on the server, including daylight-saving changes.
Night shifts retain their start date. An unreported shift task becomes
**Unreported** 30 minutes after the shift deadline. **Not done** and **Not
applicable** require an explanation. Late reports retain the actual server time
and a late flag. Missed recurring shifts are materialized at the next server read
or write, including after an outage, so no browser needs to remain open.

The task dashboard separates active shift tasks, global tasks, history, recurring
plans and statistics. Period statistics count ended applicable shift tasks,
completed/not-done/unreported results, distinct shifts with missing reports and
late reports per owner. Several missing tasks in one shift count as one missing
shift. Cancelled and inapplicable tasks are excluded from the completion rate.
Consecutive misses are shown separately for not-done and unreported recurring
tasks in the selected period. Global totals use deadline dates and show overdue,
closed and ready-for-review tasks separately.

Task content, assignment snapshots and events are local SQLite tables, included
in normal database snapshots. Supervisor reads are scoped to their assigned tasks
and global participation, with no personnel data or other account roster. Writes
require the active session, CSRF, origin and per-task revision; creation retries
use an idempotency key. Drafts stay in memory across save errors. Tasks are not
part of legacy imports, generic module replacement, report exports or offline
file mode. Deploy the reviewed server code/container to enable them; the legacy
production folder and its live files remain independent.

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
| View Tasks | Allowed | Denied (allowed for designated supervisors) | Denied |

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

In Production and scrap, accounts without permission to create reports see no
New entry panel. The date selector remains available beside the daily total;
monthly progress, team totals and history remain visible. This includes observers
and operators restricted to viewing or correcting existing reports.

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

Individually selected JSON files take priority over same-named copies in the
folder; the folder supplies only missing modules. Equivalent JSON copies are
accepted regardless of object key order. If the folder contains different
copies of a module with no explicit selection, the error identifies the module
filename: select its current JSON file separately and check again. Different
explicitly selected copies also require choosing just one current copy.

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
copy on a separate local disk. This command creates an additional manual snapshot;
scheduled, verified two-copy backups are described below. Use the snapshot command
instead of copying an actively written database.

Deploy reviewed code with `docker compose up -d --build` from the same Compose
project/directory. The named volume survives container recreation. Keep the
previous source revision available for rollback. **Do not remove the volume or
run `docker compose down -v`.** To restore, stop the service, replace its database
with a verified snapshot under the container user's ownership, remove obsolete
WAL/SHM sidecars only while stopped, then restart. Test restore with fictional data
before relying on backups.

### Scheduled backups to two local disks

For plain-language Bulgarian scenarios and the automated/manual coverage matrix,
see [Backup and recovery scenarios](BACKUP-RECOVERY-SCENARIOS.md).

After deploying the reviewed backup-capable image, install the host-side systemd
service from the source checkout. It runs independently of the update timer, every
four hours in UTC; a missed scheduled run executes after the host returns. No
backup, database content, storage path or credential is sent to an external service.

First mount a **separate physical local disk**, with a stable filesystem UUID.
The administrator must confirm that it is physically separate; software checks
different filesystem devices, the mountpoint and the configured UUID on every run.
Two partitions on the same physical disk are not sufficient protection.
Create application-specific private directories on each disk, owned by the image's
Node user (UID/GID 1000), with mode 700. The example paths are placeholders; keep
the real paths and configuration on the host, outside this repository:

```sh
sudo install -d -o 1000 -g 1000 -m 700 /srv/hub-backups /mnt/backup-disk/hub-backups
sudo bash scripts/install-backups.sh /absolute/existing/compose/project /srv/hub-backups /mnt/backup-disk/hub-backups 4
```

The installer requires an existing mounted secondary directory and a successful
first backup before enabling the timer. It records protected local configuration
in `/etc/package-hub-backup.conf` (root-owned, mode 600). Supported intervals are
1, 2, 3, 4, 6, 8, 12 or 24 hours; rerun the installer to change the interval or
intentionally replace the disk. It does not alter the application's Compose file,
existing volume, update service, accounts or live data.

The worker uses the **currently running image** and mounts only its verified named
data volume read-only. It creates a consistent `VACUUM INTO` snapshot, checks SQLite
integrity, foreign keys, the supported schema and required module/task tables,
then flushes it and publishes the completed archive without overwriting a previous
file. The secondary copy passes the same checks and an internal byte digest
comparison; digests and data never enter logs or manifests. Files are mode 600.
Only after both copies verify does rotation retain the newest backup from each of
7 most recent UTC days, 4 ISO weeks and 3 months (the union, at most 14 files per
disk). Unmanaged files and incomplete work are preserved for local review. A
damaged historical managed archive stops rotation until administrator review.

Missing/replaced disks, copy errors and failed verification make the service fail;
previous archives and the last successful timestamp remain. A failed secondary
copy retains the newly verified primary snapshot too. Host preflight failures
create a generic private failure marker; they never masquerade as verified copies.
Overlapping jobs are locked. A timed-out worker is stopped and removed; a worker
left behind by an abrupt host failure blocks the next run until local review.

```sh
sudo systemctl start package-hub-backup.service
sudo systemctl status package-hub-backup.service package-hub-backup.timer
sudo bash /usr/local/libexec/package-hub-backup.sh status
```

Status reports only state, fixed error codes and timestamps. `unknown` means no
verified run; `ok` describes the last completed run, not perpetual protection.
Check the timestamp and timer/service state: failures can make the recovery point
older than four hours. At a healthy four-hour cadence, up to four hours of newer
records may need to be re-entered after loss of the live disk. No automatic UI
notification is added by this maintenance service; the administrator status screen
is a separate task.

Validate physical mounts, permissions, a scheduled run, missing-disk behavior and
actual Docker read-only WAL access locally on the target Linux host before relying
on the service. Development tests use fictional SQLite data and isolated host-tool
boundaries; they do not claim to test real hardware. Keep a protected local copy
of the private Compose `.env`, backup/update configuration and recovery access
instructions on the second disk as well; database archives do not include host
configuration. Do not upload those files or archives to GitHub, Trello or chat.

### Isolated recovery rehearsal and emergency procedure

Use the matching reviewed application image already present on the **local host**.
The rehearsal script accepts an absolute local archive path and an immutable local
`sha256:` image ID. It allocates a uniquely labelled disposable Docker volume,
mounts the archive read-only, restores the database, revokes copied sessions and
starts an isolated loopback server inside the container. No network, host port,
live application volume or private host configuration is mounted. It checks module
reads, accounts/permissions, schedules, database integrity, process health and
unauthenticated API denial. It prints only fixed messages and recovery/startup
durations, then removes its own container and labelled test volume.

```sh
bash scripts/restore-rehearsal.sh /absolute/local/verified-archive.sqlite sha256:LOCAL_IMAGE_ID
```

The archived file must be readable by UID 1000 and have no WAL/SHM/journal sidecars:
use a completed snapshot, never an actively written database. The real archive
stays on the protected host. Rehearsal is repeatable; the image must support archive
schema version 4. Unsupported schemas, invalid data, partial copies, existing
destination files and missing recovery administration fail instead of being
silently migrated or overwritten. A failed recovery destination is retained by
the core command for local review, without a ready marker; the disposable Docker
drill removes its private test copy on exit.

For a persistent recovery copy, Node.js 24+ provides the same local-only core:

```sh
node server/restore-cli.cjs restore /absolute/local/verified-archive.sqlite /absolute/new/private/recovery-directory
```

The parent must exist; the destination must be new or completely empty, owned by
the executing user and mode 700. Output database files are mode 600. The command
never accepts a populated destination. `recovery-ready.json` is a private technical
marker, not a published report. Old sessions are revoked in the **copy**; usernames,
password hashes, permissions, module records, task history and documents are kept.
An authenticated acceptance check still requires the administrator's locally held
credentials; do not put passwords in command arguments, logs or external services.

During an actual incident:

1. Stop new input and inform local users. Disable the backup and automatic update
   timers during controlled recovery. Stop the live service only in the agreed
   maintenance window. Preserve the existing data volume and original archive;
   never run `docker compose down -v` or copy over an active SQLite database.
2. On the protected host, select a completed verified archive and note its time
   against the last confirmed entry. Rehearse it with the matching local image.
   The gap after the snapshot is the potential loss window; do not infer zero loss
   from successful integrity checks. Keep older copies available for comparison.
3. Restore into a **new empty private directory or newly allocated volume** using
   `restore-cli.cjs restore`. Do not reuse the live volume. Preserve UID 1000 and
   mode 700/600 when preparing Docker storage. Never move old WAL/SHM files into
   the restored storage. Keep the recovered database path at `hub.sqlite` in the
   application's `/var/lib/package-hub` volume for backup compatibility.
4. Start the recovered copy in isolation. Sign in with a known recovery
   administrator and check every module, the last confirmed entry, individual
   rights, tasks/recurring schedules and an attachment. Confirm old sessions are
   rejected. Record only technical timings/validation locally. If account access
   is unavailable, use `server/manage.cjs create-admin` interactively **on the
   isolated restored copy**, then validate before exposing it.
5. Switch the controlled deployment to the accepted new storage and matching
   image, then verify user access before reopening input. If the copy is wrong,
   stop the recovered service and return to the preserved previous volume/image
   when healthy, or repeat recovery from an older archive into another new volume.
   Avoid independent parallel writing; reconcile records entered after reopening
   before any subsequent switch or rollback.
6. Restore the protected private Compose `.env`, public-origin/proxy settings,
   backup/update configuration and local recovery access if the old host is lost.
   Keep these separately on the second disk; the database cannot reconstruct host
   configuration. Check the disk UUID and mount, perform a fresh two-copy backup,
   and re-enable the timers only after acceptance. Keep the preserved old storage
   until the recovery has been reviewed.

Automated fictional tests cover authenticated APIs, preserved account rights and
documents, recurring task materialization, old-session revocation and the exact
snapshot boundary. The measured timings are for tiny fictional databases and do
not predict production recovery time. Actual Docker mounts, host replacement,
private configuration recovery and a real archive rehearsal require a local
target-host exercise; no real archive is needed in development or GitHub.

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

## Branding

The shared package mark is a local, scalable SVG in the project amber/teal colors.
Every screen uses it as its browser icon. File-mode pages link home through the
wordmark; server-mode pages use the authenticated toolbar, with role-aware links,
report export, connection status and language controls. Login keeps the same
authentication flow and uses the shared palette. No remote fonts or images are
required. Deploy the `assets` directory with HTML/CSS/JS; retain live data files.

The publication guard permits only the exact reviewed logo source fingerprint.
A logo revision requires source review and an updated `approvedAssets` fingerprint
in `scripts/check-publication.cjs`; arbitrary images remain blocked.

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
Administrators can delete another account after confirmation. Deletion immediately
revokes its sessions and removes it from the account list and assignment choices.
The identity and username remain reserved to preserve task/report history; its
password is discarded. Deleted accounts cannot be restored through account edits.
The signed-in account and the last active administrator cannot be deleted.

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
node scripts/run-server-browser-tests.cjs --branding-only
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
