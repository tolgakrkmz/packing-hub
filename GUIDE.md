# Package Hub guide

[← Project overview](README.md)

Setup, module behavior, deployment and verification reference.

- [Shared server mode](#shared-server-mode)
- [Offline demo](#run-locally-in-offline-mode)
- [Technical choices](#technical-choices)
- [Tests](#tests)
- [Publication safeguards](#publication-safeguards)

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

### Concurrent reports and safe retries

Production, downtime and pair forms send an operation for one report. Independent
reports from two devices are retained without retrying a whole module. Editing or
deleting a report checks the version captured when it was opened. A conflicting
change keeps the draft in the open page; **Review current record** displays the
server's version before an explicit new attempt. A deleted report cannot be
silently recreated by a stale edit. Pair removal continues to use cancellation
with a reason and preserves history.

Each attempt has a stable operation ID. SQLite commits the report, its version
and a confirmation receipt together. Retrying an interrupted response returns
the same receipt without another write, audit event or notification. The result
also includes current module data, so replaying an old receipt never rolls back
a later correction. The client accepts a receipt only when its operation ID,
report ID, action, confirmed status and action-specific message match the
attempt. An unrelated receipt keeps the result unconfirmed and the draft
available for a retry with the same operation ID.
Changing an unconfirmed draft retains its report identity
and requires review if the original attempt already committed. All module view,
creation and correction flags are checked again on the server, including retries.

The status distinguishes a server-confirmed result, an unconfirmed response,
a rejected change and a conflict. Drafts remain in the open page; closing the
page does not provide durable offline draft storage.

The new-version notice shows the current and available versions. Its update
button waits for active writes. Production, downtime, pairs, task editor/action,
personnel/settings and instruction form/bulk drafts require an explicit choice
to return to the form or discard unsaved fields and update. An unconfirmed report
operation also requires that choice, even with an empty form. Confirmation checks
for active writes again. This guard keeps drafts in memory only; discarding fields
does not undo a change already accepted by the server.

In server mode the same protection covers the module selector, page links and
sign out. Returning to the form keeps fields, attachments and the current module
selection; accepting discard leaves without a second warning. Active saves block
these actions and are checked again at confirmation. Pristine editors and fields
returned to their accepted values do not warn. Account forms, import selections,
notification preferences and unconfirmed history restores also participate.
Browser reload, tab close and back navigation use the browser's own unload
warning when a draft or pending save exists. Browser support and user interaction
determine whether that warning appears; it cannot guarantee recovery after the
browser or operating system terminates the page. No draft content is persisted.

The account menu always contains **Version and updates**: the loaded page
version, the last server version confirmed over the live connection, the time
of that check (Europe/Sofia) and one state — checking, up to date, update
available or no connection. A reconnect shows "checking" until the server
confirms its version again, and a lost connection keeps the last confirmed
version with a note that it may be out of date. Report history has no live
connection and states that it does not check automatically. When an update is
available, the menu button uses the same guarded update as the notice; it never
reloads on its own.

```sh
node --test tests/server/version-update.test.cjs tests/report-save-recovery.test.cjs
node scripts/run-server-browser-tests.cjs --headless --version-update-only
node scripts/run-server-browser-tests.cjs --headless --version-status-only
node scripts/run-server-browser-tests.cjs --headless --unsaved-navigation-only
```

Deploy the reviewed server and HTML/CSS/JS together. Startup adds private SQLite
version, receipt and report-history tables and initializes versions for existing reports; it
preserves report data and accepts older backups through additive migration.
Imports and legacy whole-module writes update the same record versions. Exported
JSON and offline files keep their existing format. Keep live data files local.

Verification with fictional fixtures:

```sh
node --test tests/server/report-operations.test.cjs tests/server/client.test.cjs
node scripts/run-server-browser-tests.cjs --headless --report-operations-only
```

The production form accepts non-negative safe whole numbers for kilograms,
crates and the monthly goal. Scientific notation such as `1e3` means `1000`;
fractions, negative values, incomplete input and unsafe totals stop the write
and retain the draft. Empty quantity fields keep their existing zero default.
The breakdown preview and increment buttons use the same numeric rules.
An edited or rejected monthly goal stays in the field across refreshes until
its write is confirmed; background updates still update the saved goal.
Stored legacy reports are not rewritten by this form validation.

Run the shared quantity flow in both modes:

```sh
node --test tests/production-quantities.test.cjs tests/report-save-recovery.test.cjs
node scripts/run-browser-tests.cjs --headless --quantities-only
node scripts/run-server-browser-tests.cjs --headless --quantities-only
```

### Page addresses

The server home page uses `/`; screens use paths such as `/production-log`,
`/statistics`, `/tasks`, `/admin-panel` and `/login`. Direct navigation and reload
work on every approved screen. Old `.html` bookmarks redirect to the clean path
with their query strings and browser fragments retained. A trailing slash on a
known screen also redirects to its canonical path. The former production-import
screen continues to open `/data-import#production`.

Page permissions and sign-in checks apply to both URL forms. Redirects do not
create duplicate activity visits. Static assets and APIs keep their existing
paths, and unknown routes return 404. The server rewrites page links when serving
HTML; offline HTML files retain their working local links. Deploy the updated
server and client together; no database migration or data-file changes are needed.

```sh
node --test tests/server/routes.test.cjs
node scripts/run-server-browser-tests.cjs --headless --routes-only
```

### Tasks for shift supervisors

The **Tasks** tile is controlled by the account's **View Tasks** permission in
server mode. Administrators and designated supervisors inherit access by default;
an explicit restriction blocks the tile, direct page URLs and all task APIs.
Other operators and observers default to no access. Enable **View Tasks** to give
them a read-only overview of all tasks, history and statistics. This does not grant
assignment, reporting, approval or personnel access. Disabling access revokes the
account's sessions immediately and removes it from new-assignment choices.

In **Accounts**, set an account's **Shift supervisor (tasks)** flag and team,
and keep **View Tasks** enabled. Use one personal account per supervisor: the
account ID is the responsible person, and the team determines the shift schedule.
Multiple personal accounts may belong to the same team; an assignment is always
to the selected account, not everyone on that team. There is no automatic match
by employee name and no personnel import is needed. This task profile is
independent of production-report permissions and
does not grant personnel, statistics, account or import access. Existing accounts
remain unmarked when the database migrates. Account changes revoke active
sessions; existing assignment snapshots remain in history.

Administrators inherit **Can assign tasks**. An account manager can enable it for
selected operators or observers in **Admin panel → Accounts**. This includes
task viewing unless **View Tasks** is explicitly disabled. Delegated accounts
can assign specific shifts, recurring shifts and global tasks, with the same
assignee checks, preview, deadlines and retry protection as administrators.
The flag grants no account, personnel, import, report-write or supervisor rights.
Separate **Manage Tasks** and **Review Tasks** flags control editing/cancellation/recurrence and approval/return. **Report assigned tasks** controls reporting and progress for the responsible account or participants. Every role can receive these flags.
Revoking the flag ends active sessions immediately. Existing tasks and their
assignment history remain intact; old accounts keep their existing defaults.
Supervisors with assignment permission also see tasks they created for others;
reporting, participation and reminder counts still concern their own assignments.

A shift task has one responsible supervisor and
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
state. The owner marks it **Ready for review**, then an account with review permission approves
completion or returns it with a reason. Accounts with task management permission can amend active tasks,
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

### Shift leads wall

`/wall` is an informal page for shift leads; it is not a work tool and does not
replace Tasks or Global problems. A post has up to 500 characters and/or one
photo, then reactions (🍺 😂 🔥 👍, one of each kind per person, pressing again
removes it) and short comments. The feed is newest first with **Show more**.
Authors delete their own posts and comments; only administrators delete others'.
Posts, comments, reactions and photos are removed automatically after 90 days.

`canViewWall` allows reading and reacting, `canPostWall` posting and commenting;
both default to shift leads (task supervisors) only. Any other account,
administrators included, needs an explicit grant in Accounts. The home tile
and module menu show **new** for other people's posts since the wall was last
opened. A new post creates the optional **New wall posts** notification, which
each person can turn off. Photos use the task-photo checks (JPEG without
metadata, at most 300 KB and 1280 px) and their own `wall_photos` table. To keep
the disk and archives small, each person can add at most 5 photo posts per day
and all wall photos together are capped at 200 MB. The
offline file version hides the module.

```sh
node --test tests/server/wall.test.cjs
node scripts/run-server-browser-tests.cjs --headless --wall-only
```

### Team spot-ratings

After the first confirmed pair result of a shift in **Teams & targets**, a
shift lead gets a **How did they do today?** dialog with up to three people who
were in a non-cancelled pair of that shift. Never-rated and longest-unrated
people come first, so a team is covered within a few weeks. Each person needs
👍 / 👌 / 👎; the reason from a fixed list is optional. The dialog cannot be
skipped: Escape does not close it, and after a reload or on another device it
returns until every person shown is rated. The pair result itself is already
saved and is never changed by the rating. Each lead answers once per shift, and
only within the pair-reporting window and for the account's own team; a pair
cancelled later drops its people from an open prompt.

`canRateTeam` (default: shift leads) gives ratings for the own team only.
`canViewRatings` (default: administrators) shows the **Team ratings** tab in
**Statistics** (it also needs `canViewStatistics`; without the right the tab is
not shown). Like the pair statistics it has a team filter and 30/90 days,
cards for the number of ratings, 👍 / 👌 / 👎 shares and attendance, a team
comparison, optional reasons counted per team only, and a per-team list of
people with their shares, a **little data** flag below 5 ratings and shifts
present/absent. Pair targets are not repeated; they stay in the pair statistics. Absent means a team shift with pairs where the person was
in none; no absence reason (such as sick leave) is recorded or shown, and the
rating is never computed from attendance. Rated people do not see ratings in the
app; an access request is handled by an administrator outside the app. Data lives in
`team_ratings` and `team_rating_prompts`, which are part of backups and restore.
The offline file version hides the feature.

```sh
node --test tests/server/team-ratings.test.cjs
node scripts/run-server-browser-tests.cjs --headless --team-ratings-only
```

### Notifications on Android and iPhone

Accounts have separate receiving flags for task assignment, changes/returns,
reports/progress, review, approval/cancellation, upcoming deadlines and overdue
work; new production and downtime reports and their corrections; pair changes;
instructions; database/disk/backup/update warnings and recovery. Configure these
in **Accounts → Notifications** for any role. Flags never grant module viewing
or task action permissions. Admins inherit all receiving flags; operators and
observers inherit task flags, with eligibility still constrained by task rights
and assignment. Other categories require an explicit receiving flag. A user can
turn off any permitted type in **Notifications → Settings**. Current rights are
rechecked when listing the inbox and before push delivery.

The toolbar bell opens a local inbox showing the latest three notices with unread
count, read/all-read actions and links to authorized modules. **More notifications**
loads three older notices at a time; the unread count covers all eligible history.
Rows retain 90 days, up to
1,000 per account. Events committed before notification installation are not
replayed; cursors and deadline markers survive restart. New reports, corrections
and unchanged saves are distinguished. Task notices go to the responsible account
and participants, report/progress to the assigner, and ready-for-review to
reviewers. The action's author is excluded from task notices. Reminders run on the
server every 30 seconds, 30 minutes before the deadline and once overdue; shifts
keep their existing 30-minute reporting grace. Recurring instances are materialized
without a browser. System component checks run every five minutes, notify on state
changes including unknown state, and report recovery when all checks are OK.

**Web Push is optional.** Android uses a supported browser. iPhone requires
**iOS 16.4+**, **Add to Home Screen**, and opening from that icon. The app includes
a standalone manifest and a notification-only service worker with no private
page, data or photo caching. Device settings show unsupported, blocked,
unconfigured, off and on states. Native permission is requested only after a
button click. An already granted browser permission still needs explicit device
opt-in after account revocation or a key change.

Home Screen installation uses the same reviewed logo as an opaque 180 px PNG
`apple-touch-icon` on every page, including login, plus 192/512 px PNG manifest
icons. The notification worker also uses the public 192 px PNG. Ship `assets/`,
the manifest, HTML and server changes together. After updating an existing iPhone
installation that still shows the letter icon, remove that Home Screen app,
add it again from Safari, open the new icon, sign in and enable notifications
for that installation. Check the logo in both the Home Screen and a test notice
on the actual phone; desktop browser tests cannot confirm iOS installation UI.

After enabling a device, **Test notifications** sends a payload-free notice only
to that owned device, at most once per 30 seconds. It does not create tasks,
production reports or inbox rows. Provider acceptance is not proof of delivery;
confirm the notice on the phone, including with its screen locked, and open it.

The shared-design invitation appears after 30 visible seconds on a page, only
when a permitted type is enabled, push is configured, no current subscription
exists, and the device supports push or the iPhone installation instructions.
It waits while editing a form or another dialog is open. **Later**, close and
Escape postpone it seven days; **Do not remind me** stops invitations for that
account on this browser. Settings can re-enable reminders, also after seven days.
At most one invitation appears per browser-tab session. The deferral is shared
across tabs and survives navigation/reload. A blocked browser permission leads
to instructions, with no repeated native permission request. Browser storage
restrictions still limit invitations in the loaded page, but cannot preserve a
choice across reloads when both storage mechanisms are unavailable.

Push requests have **zero message payload**. The service worker always displays
only a generic Bulgarian/English notice and opens the authenticated inbox. No
employee names, quantities, notes, photos, account IDs or task content are sent to
push providers or displayed on the lock screen. Device endpoints and generated
keys remain in private local storage. The queue combines pending notices per
device, retries transient failures up to eight attempts with increasing delay,
and removes 404/410 subscriptions. This is best-effort delivery; the local inbox
remains the durable channel. Browser push providers necessarily process the device
endpoint and the public application identification.

Signing keys must remain stable and private. Generate a fresh local file without
printing its key (the command refuses to overwrite an existing file):

```sh
node scripts/configure-push.cjs .env.push
docker compose --env-file .env --env-file .env.push up -d --build
```

Run these commands in the existing Compose deployment directory. The file supplies `HUB_PUSH_PRIVATE_JWK` and a public project URI for
`HUB_PUSH_SUBJECT`; it belongs only on the local deployment host and never in
Git/Trello. Retain it across updates, with the private deployment settings. Manual
Compose commands must load both files as above. The current auto-updater and its
installer also load `.env.push` when present in the deployment directory; rerun
the installer from reviewed `main` to update an older installed script. This
release changes `compose.yaml`, so the first deployment is manual. The
HTTPS address must have a certificate trusted by the phone. The server needs
outbound HTTPS to supported browser push hosts; opening the inbox also requires
access to the application. Requests accept only known browser push domains,
reject redirects, and time out after ten seconds. No inbound public port or
cloud copy of the database is required. Device opt-in and category choices survive
page reload, reopening, ordinary session expiration and server restart with the
same database and signing keys. An automatic sign-in redirect keeps the browser
subscription; the next login to the same account binds it to the new session
without another enable click or native permission request. A failed device check
shows an unavailable state and retries while visible or on returning to the app;
it never treats a connection error as opting out or replaces the subscription.
Explicit logout removes
devices registered to that session, and account changes/deactivation/deletion
remove all its subscriptions.
An already queued provider notice can still arrive after logout; its text is
always generic and access to the inbox remains authenticated.

Deploy the server, HTML/CSS/JS and manifest together, preserving the local SQLite
volume, live files and signing configuration. No employee or production-data
migration is needed. Verify actual Android and iPhone delivery on the local HTTPS
deployment; automated tests use fictional accounts and simulated providers and
do not establish physical-device delivery.

```sh
node --test tests/notification-prompt.test.cjs tests/server/notifications.test.cjs
node scripts/run-server-browser-tests.cjs --headless --notifications-only
node scripts/run-server-browser-tests.cjs --headless --notification-targets-only
```

The inbox's **Open** link uses the shared teal button design. New notifications
carry a local link to the affected report, downtime record, pair, instruction
profile or task. Opening it selects the matching period, list page and history
group, expands instruction content and highlights the record in amber with
keyboard focus. System notifications highlight their corresponding status card.
The selection runs once after authorized data loads; subsequent refreshes retain
the highlight without repeatedly scrolling or changing the user's filters.

Report and instruction identifiers are delivered through a private SQLite
`notification_targets` table and removed from that table after inbox generation
in the same transaction. They never enter the administrative audit's detail
field, Web Push payloads or browser persistence. Existing module and task access
checks still apply. Deleted or unavailable records show a translated message
with a link back to the inbox. Older report/instruction notifications which were
created without a record identifier continue to open their module; a precise
record cannot be recovered reliably from those older events.

Deploy the updated server and client sources together. The new SQLite table is
created additively; preserve the live database volume and production data files.

Task clocks use **Europe/Sofia** on the server, including daylight-saving changes.
Night shifts retain their start date. An unreported shift task becomes
**Unreported** 30 minutes after the shift deadline. **Not done** and **Not
applicable** require an explanation. Late reports retain the actual server time
and a late flag. Missed recurring shifts are materialized at the next server read
or write, including after an outage, so no browser needs to remain open.

The task dashboard separates active shift tasks, global tasks, history, recurring
plans and statistics. History has Reported, Unreported and Cancelled buttons
with counts; only the selected group's tasks are displayed. The selection survives filtering,
refresh and switching task views within the page. Each group shows the most
recently assigned task first, regardless of its deadline or report time. Tasks
assigned at the same instant use the newest deadline first, including recurring
shifts from the same schedule. Not-done and
not-applicable reports remain in Reported;
returned or reopened tasks move to Unreported until a new report is submitted.
Cancelled tasks appear only in Cancelled, including those that retain an earlier
report. Reopening a cancelled task moves it to Unreported.
Owner and search filters apply to all three groups. Unreported includes all dates
so older tasks without a report remain trackable; its date controls are hidden.
Reported, Cancelled and statistics use the selected period, which defaults to
today and the two preceding calendar days and can be expanded manually.
Period statistics count
ended applicable shift tasks, completed/not-done/unreported results, distinct shifts with missing reports and
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

### Task photos: Problem / Solution

New assignments have **Requires photos** checked by default. Leave it checked to
require one or more **Problem** photos at assignment and exactly the same number
of new **Solution / current state** photos with each owner report. Uncheck it for
tasks that can be assigned, reported and completed without photos. The task card
and history show this requirement.
The server enforces the stored setting; reporting cannot disable it.

For tasks requiring photos, each owner report requires matching new
**Solution / current state** photos, including not-done, not-applicable, blocked
and in-progress reports. Participant progress notes remain text notes. Global
completion requires reviewer approval and, when selected, the owner's photographed
report. Managers can change the setting when editing; enabling it requires an
available set of Problem photos. Changes to the photo set and requirement are
recorded in history. Recurring plans pass the setting to future shifts; already
created shifts keep their own setting.
Older tasks without this setting retain the previous photo requirement. Old
review reports requiring a photo must be returned for a new report before approval.
Existing history and statistics are preserved.

Choose multiple local images or use **Take photo** repeatedly on a phone. Add or
remove individual selections before saving, up to 10 photos per set. Reports show
the selected and required count. Existing single-photo tasks require one solution;
legacy tasks with no Problem photo require one fresh solution. All photos remain
subject to task-scoped access, snapshots, storage limits and retention.
The browser re-encodes each image as JPEG, removes camera metadata and limits it
to 1280 pixels on the longest edge
and 300 KB. Inputs are limited to 20 MB and 40 megapixels; formats must be decodable
by that browser (JPEG, PNG and WebP are supported by the tested Chrome). Review the
preview before saving. The server also checks JPEG structure, dimensions and size.
This establishes attached evidence; it cannot establish when the original photo
was taken or whether the photographed work was actually performed.

Cards show Problem and the latest Solution; event history retains earlier photos,
including replaced problem images. Recurring shifts share their problem image
without copying its bytes. Photos use authenticated task-scoped URLs, the same
viewing rules as their task and `Cache-Control: no-store`. Draft images remain in
memory until saved or the dialog closes. Task creation and report retries use
idempotency keys: a lost response can be retried without duplicate photos/events.
Images and the task change commit in one SQLite transaction; a failed upload,
stale revision, revoked session or storage refusal cannot mark work reported.

Photos are removed **six calendar months after a final outcome**: completed,
cancelled, not-done or not-applicable. Reopening before expiration keeps prior
evidence and restarts retention on the next final outcome. Active, unreported,
blocked, in-progress and ready-for-review tasks retain their photos. An expired
or stopped recurring plan retains its photos while any associated unfinished
shift still references them. Cleanup runs at startup, hourly and on task reads
and writes; an outage is caught up on restart. Text history remains after cleanup
and shows that its photos expired. Reopening after expiration requires new
evidence; deleted image bytes cannot be recovered through the task screen.

`HUB_TASK_PHOTO_RETENTION_MONTHS` defaults to **6** (1–24 allowed), and
`HUB_TASK_PHOTO_LIMIT_MB` to **512** (1–4096 allowed). Compose passes these settings
through; recreate the container after changing them. The task screen shows
usage and policy. Saving refuses a photo if its storage cap would be exceeded or
the database filesystem has less than 128 MB reserve plus space for the new
write. Active evidence is never deleted merely to fit the cap. Deleted SQLite
pages are reused for future writes; the database file may retain its allocated
size. Backups include photos and consume additional disk space. Older backup
copies retain images until normal backup retention removes those copies;
restoring a copy applies the task-photo cleanup policy on startup. No production
images belong in this source repository, test fixtures, screenshots or Trello.

Deploy the server and client together. Photo storage is an additive local table;
no live file replacement, legacy import or employee-data migration is needed.
Test using generated images and fictional accounts:

```sh
node --test tests/server/task-photos.test.cjs tests/server/tasks.test.cjs
node scripts/run-server-browser-tests.cjs --headless --tasks-only
```

Account managers configure permissions as module cards in **Admin panel → Accounts**.
Roles supply defaults; every flag can be explicitly allowed or denied for every
role, including operator and observer. Resetting restores inheritance. Existing
accounts retain their defaults and saved overrides without a data migration.
Saving changes revokes the account's sessions immediately, including live streams
and requests still reading a body or hashing a password.

| Module | Separate permissions |
| --- | --- |
| Production | View, add reports, correct/delete reports, change target |
| Downtime | View, add reports, correct/delete reports, manage reasons |
| Pairs | View, plan/first result, correct recorded results |
| Personnel | View, manage |
| Instructions | View, manage index and attachments |
| Statistics | View reports and aggregate workforce statistics |
| Tasks | View, assign, report assigned work, manage, approve/return |
| Accounts | View accounts/permissions, manage accounts/permissions |
| Activity | View visits and action history |
| System status | View, request backup |
| Transfer | Import data, export reports |

Actions inherit module viewing unless viewing is explicitly denied. An explicit
view denial blocks the page, data API and that module's actions even for admins.
Common add/edit report flags remain supported for existing accounts; production,
downtime and pairs inherit them until a module-specific override is set. Settings
have separate flags. Pair validation, immutable cancellation history and ownership
checks still apply regardless of role. Task profiles and teams are available to
all roles; new assignees need a profile, team and effective reporting access.
Account management grants authority to change all permissions; at least one active
account must retain this right. The last administrator is also retained for the
existing recovery workflow.

Pair planning receives only the active-packer fields needed for selection.
Statistics receives aggregate workforce counts and uses its own authorized
report-data endpoints; it grants no access to full personnel records. Both read
views update after personnel changes. Module navigation follows effective rights.

The header has one **Admin panel** link for accounts with any permitted panel
module. Only available cards appear. Transfer tabs retain selected files and
previews. Import is independent of normal write permissions, includes viewing
of importable modules unless explicitly denied, and rejects a denied module at
creation, preview and application. Exports also require viewing the chosen report.
The old `production-import.html` redirects to the production tab.

JSON downloads use the authenticated `/api/export/<module>` endpoints for
production, downtime and pairs. Exports use current server data and record only
action metadata in the audit log. Denying export removes these controls and blocks
the export API; it does not prevent copying information the account is allowed to
view. Instruction attachments keep their separate viewing behavior. These
permissions apply to shared server mode.

The server uses Node.js 24+ and SQLite without npm dependencies. All five module
documents, accounts, sessions and packing attachments live in one local database.
A new database starts empty, without employee seeds, reports or default accounts.
Clients use the same data through a browser, without picking JSON files or
installing an application. Statistics reads the shared module data.

An account manager creates accounts with these initial role defaults:

| Role | Default access |
| --- | --- |
| Administrator | All modules, corrections, personnel, instructions, goals/reasons and accounts. |
| Operator | Read production, downtime, pairs and instructions; add reports and plan pairs; export reports. |
| Observer | Read production, downtime, pairs, instructions and statistics; export reports. |

In Production and scrap, accounts without permission to create reports see no
New entry panel. The date selector remains available beside the daily total;
monthly progress, team totals and history remain visible. This includes observers
and operators restricted to viewing or correcting existing reports.

The server checks authorization on every API write. Passwords use salted scrypt
hashes. Sessions use HttpOnly, SameSite cookies, expire after 14 days without use and are
revoked when an account is changed or disabled. Page loads and saves extend
the session; background polling and live updates do not. HTTPS also uses Secure cookies.
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

### Private account instructions

A temporary demonstration can use its own instruction index and nested files,
owned by one existing active account. Keep the entire input folder local and
outside Git, including its customer names, company logos and PDF attachments.
The folder contains `data/package-instructions.json` and the referenced files
under `data/profiles/<folderName>/`. Each profile may also have `instruction.txt`.

Use Node.js 24+ and explicitly select the existing server database:

```sh
HUB_DATABASE=/var/lib/package-hub/hub.sqlite node server/manage.cjs install-account-instructions demo-preview /private/local-bundle
```

The command imports only indexed attachments and optional instruction text,
rejects missing files, escaped paths, symlinks and hard-linked files, and replaces this account's
previous private bundle atomically. It does not create an account or change shared
instruction records. Its output contains counts only. Reload the account's pages
after installation; an open instruction page can also use **Refresh**.
The source and its directories must be controlled by the executing user or root
and must not be writable by other users. Sticky temporary ancestors are allowed.

The owner uses the existing profile search, customer labels, text and download
buttons. Other accounts retain the shared instruction index and cannot retrieve
private files through direct URLs. Instruction-viewing permission and active
sessions remain required. Private instruction accounts have read-only instructions
and data imports disabled while the private bundle is installed; the configured
account permissions remain unchanged in storage.

For Docker Compose, run from the existing Compose project and stream the bundle's
`data` directory into a private temporary folder as the container's runtime user.
This keeps ownership suitable for reading and cleanup on the read-only image with
its `/tmp` tmpfs. Import it with the same command inside the container, then remove
the input copy after a successful import. Keep the source folder outside the
publishing checkout and image:

```sh
docker compose exec -T package-hub mkdir -m 700 /tmp/account-instructions
tar -C /private/local-bundle -cf - data | docker compose exec -T package-hub tar --no-same-owner -xf - -C /tmp/account-instructions
docker compose exec package-hub node server/manage.cjs install-account-instructions demo-preview /tmp/account-instructions
docker compose exec package-hub rm -rf /tmp/account-instructions
```

Deleting the account removes its private index, directories and file BLOBs in the
same SQLite transaction that revokes access, while preserving shared instructions
and the account's historical identity. Reopening the database does not recreate
the bundle. Existing backups and already downloaded documents keep their copies;
account deletion applies to the active server database.

```sh
node --test tests/server/account-instructions.test.cjs
node scripts/run-server-browser-tests.cjs --headless --account-instructions-only
```

### Flexible packing instruction folders

**Bulk import** accepts customer folders containing profile folders, flat profile
folders and documents placed directly in a customer folder. It discovers deeper
folders too. Attachments below an identified profile stay with that profile and
retain their relative paths. Profile identifiers keep letters and leading zeroes.

Choose automatic detection or explicitly select a folder containing customers,
one customer's folder or one profile's folder. Review the displayed source paths
and edit the customer, number, name or category before importing. Unrecognized
numbers receive an internal identifier. When selecting one profile folder, enter
the customer to keep its destination separate from other customers. Equal profile
numbers for different customers remain separate records; an already indexed folder
is skipped during repeat imports. This import adds new folders; it does not replace existing ones.

Search includes customer names, profile numbers, names and attachment filenames.
Images open in the gallery; PDFs and other documents retain their download links.
Folder selection requires a browser with directory-picker support. In shared
server mode, imported attachments are available to accounts with instruction
viewing permission, including mobile devices.

```sh
node --test tests/instruction-folders.test.cjs
node scripts/run-browser-tests.cjs --headless --packing-only
node scripts/run-server-browser-tests.cjs --headless --packing-only
```

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
The production-only importer is the **Production import** tab on the shared
screen; `production-import.html` redirects there for authorized administrators.

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

### Scheduled backups on the primary disk

An explicit single-disk mode is available when a second physical disk cannot be
provided. It creates and verifies consistent SQLite archives independently of
code updates, with the same 7 daily / 4 weekly / 3 monthly retention policy.
The archive contains accounts, module data, tasks and uploaded documents.
**These archives can be lost together with the live database if the disk fails.**
The administrator screen always shows this limitation as a warning; it never
claims an independent second copy or an entirely successful protection summary.

After deploying the reviewed image, create an application-specific private host
directory and install the service on the existing Compose project:

```sh
sudo install -d -o 1000 -g 1000 -m 700 /srv/hub-backups
sudo bash scripts/install-backups.sh --single /absolute/existing/compose/project /srv/hub-backups 4
```

The installer writes `BACKUP_MODE=single` in the protected local configuration,
without secondary disk fields. It verifies the first archive before enabling the
schedule. The worker mounts only the existing database volume read-only and the
primary archive directory. A failed snapshot or rotation preserves earlier
recovery points and the last successful timestamp. Manual backups use the same
service after installing the maintenance adapter described below. The UI shows
**Primary disk**, the local archive time, and **No independent copy**.

Two-disk mode remains the default for existing configurations and CLI callers.
A missing or failed second disk never switches an existing two-disk setup into
single-disk mode automatically. Run the installer explicitly to change modes.
Restoration uses the same isolated rehearsal and emergency procedure for both
modes; the rehearsal does not overwrite the live database.

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
stays on the protected host. Rehearsal is repeatable; the image must support the
archive schema version (4 or 5). A version 4 archive is moved to row storage when the
application first opens it, after a private copy in `migration-backups/`. Unsupported schemas, invalid data, partial copies, existing
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

### Administrator system status

The authenticated header opens **Admin panel**, whose System status card requires
the status-viewing flag. Backup requests require a separate backup flag. Both can
be delegated to any role; direct page and API access enforce the same rights.
Tasks remain on the home screen, with pending counts also in the Tasks heading.
The page uses the shared Package Hub theme and supports BG/EN and small screens.
The Bulgarian [practical scenarios and test coverage](SYSTEM-STATUS-SCENARIOS.md)
explain how this task complements backup and recovery.

The page checks database access with a small schema read and the space available
to the database's user. Complete database integrity scans remain part of backup
verification, rather than running on every screen poll. Concurrent status
requests share the entire check.
The check also verifies access to the same regular database file the server
opened. A missing, replaced, empty or linked file cannot be hidden by SQLite's
cached schema. It warns
below 1 GiB or 10% free space. Backup timestamps, the second disk's mount/UUID and
update results come from an optional local host adapter. Backups become overdue
after their configured interval plus 15 minutes. Unknown, failed and overdue
checks are distinct; a failed refresh hides the previous successful summary.
Browser requests stop waiting after 20 seconds and allow a fresh check. Restoring
the screen from the browser's back/forward cache hides the old summary until it
has been checked again. A stale or aborted response cannot overwrite that check.
There are no public archive links, host paths, revisions, account details or log
contents in the status response. `/healthz` keeps its minimal public response.

After installing and accepting the configured backup service, install the adapter
on the Linux host during a planned deployment. It needs `/usr/bin/python3` 3.8+
and uses only the Python standard library, existing host tools and the installed
backup service:

```sh
sudo bash scripts/install-maintenance.sh
sudo docker compose --project-directory /absolute/existing/compose/project -f /absolute/existing/compose/project/compose.yaml -f /etc/package-hub-maintenance.compose.yaml up -d --no-build --no-deps package-hub
```

Use the existing project's exact name and any existing local build overrides
when applying that command. Deploy the reviewed status-capable image first.
Preserve the existing named data volume. The adapter installs a protected Unix
socket, activated by systemd, and an optional read-only directory mount for the
application. It adds no network listener, timer, external notification or Docker
socket inside the application. Its only operations are status reads and starting
`package-hub-backup.service`; API request data cannot supply commands or paths.
The application never mounts the backup disks or private host configuration.
Install while the backup service is idle. Preflight rejects an active backup,
unsafe or linked configuration/worker/unit files, and a missing service. Re-running
the installer refreshes an already active adapter with `try-restart`; a failed
copy, reload, enable or restart never reports a successful installation.
Status reads identify the existing running application through its exact Docker
Compose project and service labels. They do not open the deployment directory,
so a project under a home directory works with the adapter's `ProtectHome=true`
restriction intact. Missing, ambiguous or mismatched containers remain unknown.
For the socket activation contract, see the official
[systemd socket documentation](https://github.com/systemd/systemd/blob/main/man/systemd.socket.xml).

**Create backup** returns an asynchronous status, then the screen polls progress.
Concurrent requests and an active scheduled backup are refused. A manual request
invalidates any older in-flight status snapshot; the screen
reads again after the request rather than reusing an old idle result.
Success requires a newly confirmed archive for the configured mode, with canonical
matching timestamps and no error code. Two-disk mode also requires a matching
verified secondary copy; single-disk mode requires no secondary timestamp. A lost reply does not imply that the host action was cancelled: the
screen checks status and never retries a POST automatically. A failed attempt
to create the worker thread leaves a failed, retryable job. Closing the browser does not cancel the host
service. Missing configuration leaves the relevant cards unknown and the action
unavailable; the standalone/offline application offers no maintenance controls.
An unavailable manual service or an unconfirmed manual result also prevents an
entirely successful overall summary. The adapter limits simultaneous connections
to eight and gives each status/preflight operation a shared ten-second command
budget, with at most five seconds per command. A timed-out disk check remains
unknown. The application bounds and validates the adapter's HTTP/JSON responses.

The auto-update script now records a private fixed-state `last-attempt` marker,
including failures before build/deployment, while `last-good` retains the actual
successful deployment time. No-op update checks do not claim a new deployment.
Older installed updater scripts must be replaced with the reviewed version using
the existing installer. The updater preserves the installed maintenance Compose
override. Changes to either Compose source require a reviewed manual deployment.

Validate socket ownership/access, actual Docker reads, manual and scheduled
overlap, disk removal, update failure and reboot locally before acceptance. The
automated tests use fictional state and local command boundaries; the Chrome
workflow checks rendering, roles, warnings, manual requests, reconnect, BG/EN and
320/390/768/1440 px layouts:

```sh
node scripts/run-server-browser-tests.cjs --status-only --headless
```

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
wordmark; server-mode pages use the authenticated toolbar, with role-aware links
to modules and Import & export, connection status and language controls. Login
keeps the same authentication flow and uses the shared palette. No remote fonts or images are
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
role. Expand an account to change its role, active status and permissions grouped
into collapsible module cards. All flags are available for all roles. Unchanged
rights keep their inheritance; Reset permissions to role restores role defaults.
Password changes and new-account creation expand on demand. Saving one account
keeps unsaved edits in other accounts. Controls adapt to narrow phone screens.
Account managers can delete another account after confirmation. Deletion immediately
revokes its sessions and removes it from the account list and assignment choices.
The identity and username remain reserved to preserve task/report history; its
password is discarded. Deleted accounts cannot be restored through account edits.
The signed-in account, last active administrator and last effective account manager cannot be deleted.

### Own password and devices

Every signed-in account has **Change password** in the shared toolbar
(`/account-password`). The owner confirms the current password and enters the new
one twice (12–128 characters, different from the current one). A successful change
signs out every other device and its push subscriptions; this device receives a new
session. Wrong current passwords are limited to 10 attempts per account in 15 minutes.

Passwords set by an account manager are temporary: a new account and a reset of
another account's password require a change at the next sign-in. Until then pages
redirect to `/account-password`, and every other API returns
`PASSWORD_CHANGE_REQUIRED`. A manager changing their own password on the Accounts
screen sets a lasting password. Existing accounts are not forced to change.

**Sign out of all devices** ends every session and push subscription of the account,
including the current device. Other accounts stay signed in. Rights, roles and the
last-administrator protections are unchanged. Passwords never reach the audit
journal; it records only `password-change` and `logout-all`.

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

Login, tonnage, tasks and end of shift work with the keyboard alone. Every
control and dialog has an accessible name, text meets WCAG AA contrast and the
selected shift is underlined and exposed as `aria-pressed`, not only coloured.
After a save, an error or a closed dialog, focus returns to the control, the
retry button or the status message instead of the page body. The accessibility
suite checks this for BG/EN, an administrator and a restricted operator, at
320, 390 and 640 px (400% and 200% browser zoom of a 1280 px window):

```sh
node scripts/run-server-browser-tests.cjs --headless --accessibility-only
```

## Report dates

In authenticated server mode, production uses the assigned account team and
the server's Europe/Sofia clock to select the current production date, including
the previous date while an overnight shift or its four-hour reporting window is active. This
server selection is retained when choosing the team again. Manual dates and
explicit shift links retain their selected date.

Local-file production and downtime reports use one date field. Before 10:00, rotating teams
default to yesterday for delayed night reports; selecting Stickers defaults to
today. Changing the date or using Yesterday makes the choice manual and preserves
it when switching teams. The visible date is the date saved in the report.

## Assigned-shift reporting window

Assign each reporting account its team in Accounts, independently of the task
supervisor checkbox. Team assignment does not grant task responsibilities or
module permissions. Existing accounts without a team require configuration.

Ordinary server production, pair planning, targets and pair results require the
assigned team and dated rotation, from shift start until **four hours after its
end**. The deadline is exclusive and uses the server's Europe/Sofia shift
boundaries plus four elapsed hours. Before the shift starts, on a rest day, for
another team or outside the dated reporting window, writes are rejected.
A 06:00–14:00 shift can report until 18:00; a 22:00–06:00 shift retains its starting
date and can report until 10:00 the next day, including daylight-saving changes.

Ordinary staff can create only **one tonnage record per team and production
date**. Another operation, a concurrent device or a whole-document replacement
cannot add a duplicate. An existing tonnage record does not lock pair planning,
target changes or pair results: those continue independently within the same
reporting window and normal permissions. A completed pair result still requires
correction rights to change. Existing historical duplicates are preserved.
Create, correction, delete and restore operations, including legacy document
replacements, check every changed source and destination scope. Production goal
changes alone retain their separate permission.

Stickers normally works weekdays, 09:00–17:30. An administrator with production
settings permission can select a rest-day date and Stickers in Production,
expand Extra shift, and authorize its start/end times with a mandatory reason.
The dated authorization applies to tonnage, pairs and targets with the same
four-hour deadline; revocation
blocks subsequent ordinary writes. Authorization is stored in SQLite and its
changes are audited. Times skipped by the spring clock change are rejected.
Pair planning still validates the dated roster; an extraordinary shift requires
the stored administrator authorization and regular shift code.

Administrators retain their existing workflows and normal module rights.
Exceptional out-of-window or other-team production needs a reason recorded with
the report and audit event. Creating an administrator production record opens
the explicit reason dialog. Administrative imports retain their separate,
previewed import workflow and permission. Local-file mode has no authenticated
server enforcement.

There is no manual temporary late-report unlock. Old authorization data remains
local but cannot extend the automatic four-hour window. Both forms display the
server-checked deadline; an unavailable check disables saving. The server checks
again on every actual write and rejected writes retain the form draft. A
confirmed operation may be safely retried after the deadline or after the one
allowed tonnage entry, retrieving its receipt without another report.

## Save recovery

Production and downtime keep form input and restore the accepted history and totals
when file reads, permissions or writes fail. A visible status and Try again button
allow another attempt, including deletions, the monthly goal and downtime reasons.
Reports retain the same ID across retries. If a failed close actually saved the
report, retry confirms the existing entry instead of adding another. Form edits
clear the old retry action; changed records are refused before deletion.

## Statistics navigation

All mass quantities in Statistics are displayed in tonnes (`t`), rounded to one
decimal place with no trailing zeroes: 1250 kg is shown as 1.3 t and 1 kg of scrap
as 0 t. Calculations retain the full stored kilogram values. This includes
production and pair tables, charts, totals, targets, deficits and workforce
productivity. Counts, percentages and durations retain their units. All report
entry fields remain in kilograms; stored reports and JSON import/export formats
remain compatible. No data migration is needed.


The monthly result stays above every statistics section. Switch between Overview,
Production, Pair Targets, Downtime, and Workforce Capacity; only one section is
shown at a time. The last section is remembered separately in demo browser storage.
Choose the shared year and month at the top. The monthly result, pair reports,
line breakdown and workforce capacity use that same period across sections and
data refreshes. The initial selection is the current month; all twelve months
are selectable, including empty ones. Connecting an older source or removing
its last report never switches the chosen period. Years include available
production, downtime and pair reports, the current year and the selected year.
Production and downtime retain their annual breakdowns by month and their
all-years views, with the scope stated in each heading. Pair output stays separate
from production totals. Detailed tables, the daily trend, and pair comparisons
expand on demand. The Files button shows connections and keeps the file panel
closed until requested. Without a connected production source, the monthly result offers a
connection button while the other sections remain available.

## Pair target statistics

Cancel an unreported pair with a required reason: **Left the shift**, **Cleaning**,
**Doing other work**, or **Other** with an explanation. Cancellation preserves
the pair, its original targets, reason and time in shift/monthly history, and
releases its members for a new pair in the same shift. Cancelled pairs cannot be
edited, reported or removed; reported pairs retain their correction workflow.
Server cancellation requires report-creation permission and the current revision.
Existing pair files remain compatible. Deploy the updated client and server
together; older clients' pair deletion requests are rejected by the updated server.
Cancelled targets are excluded from active totals, pending counts, completion
rates and deficits. Monthly statistics show cancellations separately, including
months containing only cancelled pairs.

Focused browser checks in both modes:

```sh
node scripts/run-browser-tests.cjs --headless --pair-cancellation-only
node scripts/run-server-browser-tests.cjs --headless --pair-cancellation-only
```

These cover required reasons, retained drafts after failed writes or conflicts,
reassignment, saved history, cancelled-only statistics, server permission limits
and Bulgarian/English dialogs at 320, 390 and 1440 px using fictional data.

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

## Administrator activity log

In server mode, **Admin panel → User activity** opens the
account journal. The page and API require activity-viewing permission. It shows
the last successful sign-in or page visit for each account, including inactive
and deleted accounts, and a newest-first history filtered by account, period
and action. Load older records in pages of 50. Times use the viewing device's
local timezone. Last visits are independent of the history period; they are
not online status or time spent in the application.

Successful page requests and explicit sign-outs are recorded from this version
onwards. Existing sign-ins, saved changes, task actions, imports and exports
remain visible. Background polling, event streams, static assets, HEAD requests
and refused actions do not create visits. The log stores only timestamp,
account identifier, action and module, with account names resolved from the
existing account database. It does not store report bodies, attachment contents,
passwords, tokens or IP addresses. The existing journal remains in the private
SQLite database and its local backups; it is never a source fixture.

No database format change or data import is needed. Older history cannot
reconstruct past page visits. The offline file-based application does not
collect account activity. Deploy the server and client together.

Focused verification with fictional accounts and an isolated database:

```sh
node --test tests/server/activity.test.cjs
node scripts/run-server-browser-tests.cjs --headless --activity-only
```

## Administrator panel

Accounts with administrative viewing rights, import rights, report-correction
rights, or an explicitly delegated export grant have one **Admin panel** link.
The panel contains Accounts, User activity, System status, Import / export and
Report history. Each card and its API enforce their own permissions.
Default operators and observers retain a direct **Export reports** entry;
their normal export permission does not grant access to the admin panel.
A denied admin-panel GET/HEAD returns HTTP 403 and a friendly BG/EN page in the
application design, including clean, legacy and trailing-slash addresses.
Unauthenticated requests still redirect to login.

The transfer card appears only when the account has import or export permission.
Opening the transfer or history card from a report module keeps that module
selected. The shared header highlights the admin panel while visiting its modules.

### Private report history and recoverable deletion

In server mode, **Admin panel → Report history** shows the versions of one
production, downtime or pair record. Access requires that module's viewing and
correction permissions. Operators and observers without an explicit correction
grant cannot read history through either the screen or API. Editing an existing
production/downtime report or pair plan, correcting a completed pair report, deleting and
restoring require a nonblank reason of at most 1000 characters. Ordinary first
pair reporting and plan cancellation keep their existing permissions and reason
rules. The dialog preserves the reason and operation ID across interrupted retries.

History is intended for occasional incident review. Opening the page or changing
its filters makes no history request. **Show records** loads at most 25 list items,
optionally for one report date; **More records** requests the next page. A direct
record link loads only that record. Version summaries are paged in groups of 20;
before/after snapshots load only when expanded, once per version during that review.
The API caps requested pages at 50. Lists project metadata in SQLite rather than
constructing all report snapshots in JavaScript. This page opens no SSE connection,
notification polling, task polling or push invitation timer. Updates are manual;
server authorization and session validity are checked on every request. Capturing
history during report changes remains atomic, so an incident can be investigated
afterwards. Desktop uses a record sidebar; phone layouts stack the list and review.

SQLite commits the report, its previous/new snapshots, version, account, time,
reason, technical audit metadata and receipt in the same transaction. Snapshots
and correction reasons never enter the general activity log, report exports or
SSE messages. Existing records begin with their current version; past corrections
before installation cannot be reconstructed. The first new correction retains
the prior content. History is included in private database backups.

Deleted IDs are reserved. Create, whole-document PUT and imports cannot silently
reuse them. Restore checks the deleted record's version and correction rights,
uses a protected snapshot and adds the record once. A newer live record or a
stale version returns a conflict; refresh and review are required before a new
attempt. Pair restores preserve historical members and cancelled plans without
replanning against today's roster; active membership conflicts in the same shift
are rejected. Statistics read only the live document, so historical snapshots and
repeated receipts do not double-count results. Bulk imports append new records
and preserve existing report content; conflicting IDs remain refused.

Deploy the reviewed server and HTML/CSS/JS together and preserve local live data.
Offline JSON mode keeps its existing format and does not provide protected server
history. Period locking and approval workflows are outside this feature.

Verification with fictional fixtures:

```sh
node scripts/run-server-browser-tests.cjs --headless --admin-panel-only
node --test tests/server/report-history.test.cjs tests/server/imports.test.cjs
node scripts/run-server-browser-tests.cjs --headless --report-history-only
node scripts/run-server-browser-tests.cjs --headless --permissions-only
```

## Tests

### Critical-function coverage and repeatable audit

Run from the reviewed **demo repository**, using Node.js 24+ (including child
processes and Git hooks). Browser checks additionally need Chrome and
Playwright 1.62.1. Use an installed dependency through `NODE_PATH`, or the local
installation described below. Every browser run uses a separate profile and
every server run uses fictional data in a temporary SQLite database.

```sh
node scripts/run-critical-tests.cjs                # all unit and server tests
node scripts/run-critical-tests.cjs --browser     # also all distinct browser suites
node scripts/run-critical-tests.cjs --browser-only
node scripts/check-publication.cjs --staged
```

The runner uses the same Node executable for child processes, prints a result
for each suite and returns nonzero if any suite fails. Browser totals are
**suite invocations**, not assertion counts: twelve offline and thirty-seven server
invocations. When `tests/browser/report-history.cjs` is present after integration
of that feature, its `--report-history-only` server flow is included too (one
additional invocation). Default browser flows and focused flows are
complementary; a successful default run alone does not cover report-operation recovery,
statistics cache behavior, transfer permissions or task history in full.

The audit completed on 12 October 2026 started from `main` baseline `d91bb63`
(508 existing Node tests). With the eleven lifecycle/boundary additions, the
final runner passed **273 unit + 246 server = 519 Node tests**, with no failures,
skips or cancellations, and **6 offline + 15 server browser invocations**.
The combined command reported **23 suite runs passed; 0 failed**. Validation
used Node.js 24.19.0, Chrome 154.0.8037.99 and Playwright 1.62.1 with allowed
loopback sockets. Browser corrections cover pending search results, the
correction-only account form, toolbar readiness/navigation and versioned icons.

| Important behavior | Existing behavioral coverage | Audit additions / remaining boundary |
| --- | --- | --- |
| Authentication, module permissions, CSRF, origin, active sessions | `server/api`, `permissions`, `module-permissions`, `routes`, browser permissions/account revocation | `server/session-lifecycle`: exact expiry, independent logout, login racing disable/delete, stale password update, all-session password revocation; `server/self-service-password` and browser `--account-password-only`: temporary password gate, own change, rate limit, sign-out from all devices; `server/account-avatars` and browser `--account-center-only`: avatar menu, account page, owner-only profile photo |
| Durable reports, conflicts, retries and atomic rollback | `server/report-operations`, `client`, `report-save-recovery`, `file-sync`, browser report operations | Existing coverage retained; lost responses, competing edits and receipt persistence already tested |
| Import/export validation and isolation | `data-validation`, `server/imports`, `api`, `permissions`, browser data transfer | `server/import-lifecycle`: newest approval only, complete upload replacement, owner quota/expiry, changed create retry; browser import card selection survives a pending search and authorized transfer navigation uses the admin panel or direct export entry |
| Backup/restore and refusal of unsafe recovery | `server/backups`, `restore`, host/install/CLI tests; `BACKUP-RECOVERY-SCENARIOS.md` | Existing failure injection and complete recovery coverage retained; physical target-host recovery remains a separate deployment check |
| Production/downtime totals and statistics freshness | `server/statistics`, `statistics-cache`, browser statistics period/cache/request counts | `server/statistics-boundaries`: leap day, year/month partition, fractional kg, zero report, all five shifts |
| Pair targets, shift rotation, pending/cancelled plans and weighted deficits | `pair-targets`, `pair-targets-statistics`, browser cancellation and statistics | Existing coverage retained; includes daylight saving, roster changes and missed-result reasons |
| Tasks, recurring shifts, deadline/grace, review, photos and permissions | `server/tasks`, `task-photos`, browser tasks/assignment/history/photo variants | Default plus focused history suite; uses server clock and isolated fictional evidence |
| Instructions, translations, navigation and responsive layouts | `instruction-folders`, `i18n`, browser packing/routes/branding/lists/static assets | Specific imported-card selector replaces a transient multi-result selector; branding checks versioned favicon/install-icon URLs |
| System health, host maintenance, notifications, audit and publication | maintenance/host/notification/activity/publication tests and focused browser suites | Host-service installation, real push delivery, Docker restart and independent physical backup media need target-host verification |

This is a behavioral coverage matrix, not a statement of line/branch coverage
or a substitute for target-host acceptance. A blocked port (`EPERM` on local
HTTP/Unix sockets), missing Chrome/Playwright or Node older than 24 is an
environment limitation; rerun with the required environment before claiming
server/browser success. Never point tests or publication diagnostics at
production data, save private fixture values, or use a personal browser profile.

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
offline browser runner below and defaults to a **visible Chrome**. Fourteen workflows
cover account creation/login, mobile operator reports and live observer
statistics, personnel and pair reports, shared instructions/attachments,
observer controls and revoked access. Each run uses an isolated temporary SQLite
database and fictional inputs, then removes it. Server tests also check API
permissions, CSRF/origin rejection, stale and simultaneous writes, roster rules,
live events, persistence, backups and login throttling. Docker, Funnel and the
actual CasaOS reboot/restore still require target-host checks.

The shared statistics period has focused browser checks in both modes:

```sh
node scripts/run-browser-tests.cjs --headless --statistics-only
node scripts/run-server-browser-tests.cjs --headless --statistics-only
```

These use fictional sources with different months and years, empty selections,
source refreshes and annual scopes, in Bulgarian and English on phone and desktop.

The shared import/export screen has focused browser checks in both modes:

```sh
node scripts/run-browser-tests.cjs --headless --transfer-only
node scripts/run-server-browser-tests.cjs --headless --transfer-only
```

These check JSON downloads, retained file selections and previews, the legacy
redirect, keyboard navigation, Bulgarian/English layouts from 320 to 1440 px,
import/export permission combinations and the disabled offline controls.

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

## Performance measurements

Use Node.js 24+, the browser-test Playwright dependency and an isolated Chrome
profile. The benchmark serves only reviewed demo source, generates fictional
records in browser storage and an in-memory SQLite database, and blocks browser
requests outside its loopback origins. It never opens production data or a
personal browser profile and does not record screenshots or traces.

```sh
node scripts/run-performance-benchmarks.cjs
node scripts/run-performance-benchmarks.cjs --quick
node scripts/run-targeted-read-benchmarks.cjs
node scripts/run-static-asset-benchmarks.cjs
node scripts/run-browser-tests.cjs --headless --i18n-only
node scripts/run-browser-tests.cjs --headless --lists-only
node scripts/run-server-browser-tests.cjs --headless --lists-only
node scripts/run-browser-tests.cjs --headless --statistics-only
node scripts/run-server-browser-tests.cjs --headless --statistics-only
node scripts/run-server-browser-tests.cjs --headless --static-only
```

The full run compares 200 and 2000 reports/tasks at CPU rates 1 and 4, in BG and
EN. `--quick` repeats only 2000 records at CPU rate 4. Output is JSON lines with
environment metadata and median timings from five samples after a warm-up.
Automatic browser intervals are disabled during measurement; unchanged file
refresh is exercised explicitly. Server maintenance remains active.

`scriptMs` measures the invoked action. For debounced searches this is only the
input dispatch, not the later rendering cost. `resultsMs` waits for the actual
search results to replace the list, including the debounce delay. `settledMs`
also waits for mutation callbacks and two animation frames after results arrive.
It has a frame-duration floor and is not a complete user latency metric.
`renderedCards` and `renderedRows` record the DOM counts for each sample.
`observerMs` measures mutation callbacks and is
already part of the action/settled timings; do not add it again. Backend timings
cover a store read plus JSON serialization or the task summary function, without
HTTP transport or concurrent clients. CPU rate 4 simulates slower processing;
loopback networking has no throttling. These are development measurements, not
results from a physical phone or the live installation.

Initial measurements on 11 October 2026 used Chrome 154.0.8037.99, Node 24.19.0,
1440×900 and main commit `7450b15a37f6ebaa482d0b996cea15d44b00cb37`.
At CPU rate 4, English timings in milliseconds were:

| Action | 200 records | 2000 records |
| --- | ---: | ---: |
| Statistics: change month | 72 | 93 |
| Statistics: unchanged file refresh | 95 | 167 |
| Production: rebuild history | 257 | 1962 |
| Production: change one status label | 92 | 711 |
| Tasks: search global tasks | 298 | 3146 |

The old translator traversed the entire document for every observed change. At
2000 records, its callback consumed approximately 690 ms even for one status
label. Incremental translation now handles only added subtrees, changed text and
changed presentation attributes. A full pass remains necessary at initialization
and when changing language. The focused real-DOM regression verifies BG/EN
roundtrips, dynamic updates, excluded data, stable option/input values and that an
unrelated 1000-element subtree is not visited for a small update.

The repeat run with 2000 records at CPU rate 4 measured:

| Action | Before BG / EN (ms) | After BG / EN (ms) |
| --- | ---: | ---: |
| History: change one status label | 262 / 711 | 32 / 31 |
| Statistics: unchanged file refresh | 82 / 167 | 79 / 90 |
| History: rebuild all rows | 1572 / 1962 | 1345 / 2006 |
| Tasks: search global tasks | 2830 / 3146 | 2480 / 3154 |

Small changes no longer scale with the total document size: the history status
label callback fell from 246/690 ms to 0.1/0.6 ms in BG/EN. The large English
history/search operations are effectively unchanged within run variation. Do not
interpret the small-update improvement as an equivalent whole-application speedup.

Step 2 creates production rows only for expanded months. The latest month opens
initially; other months create their table when opened and release it when closed.
Expanded states survive refreshes. Month counts and tonnage still use every report.
Tasks, task history, recurring plans and instruction profiles show 50 matching
cards per page. Search and category/owner/date filters operate on the entire
dataset and reset the page; refresh clamps or retains the current page. Text
search waits 150 ms after the last input. Opening an instruction while a search
is pending applies the results first, preserving its preview.

A fresh control run at `3f7f66181501972989227bff3dd6ab2473465282` and the
step 2 repeat used the same fictional 2000-record dataset, Chrome/Node versions,
viewport, CPU rate 4 and five-sample medians. Both runs used the updated search
measurement, so the new debounce is included in the comparison:

| Action (`settledMs`) | Before BG / EN (ms) | Step 2 BG / EN (ms) |
| --- | ---: | ---: |
| History: rebuild with latest month open | 1297 / 1843 | 68 / 80 |
| Tasks: search global tasks | 2631 / 3003 | 237 / 251 |

The history fixture has 25 reports in its latest partial month: the DOM now
contains 25 report rows instead of 2000, plus every month header. Search creates
50 cards instead of 2000/1111 for the two queries. Opening additional months adds
their rows; opening every month can still recreate the large DOM. The backend
still returns the full datasets. These results describe those measured actions,
not a whole-site speedup or live-server performance.

Validation covers every page without missing/duplicate records, totals, filter
resets, empty results, refresh clamping, lazy month edit/delete controls, previews
during pending searches, keyboard focus and BG/EN layouts at 320–1440 px. The
existing offline workflows, task/photo/history/permission browser scenarios,
server instruction imports and 116 related unit/API tests passed.
Step 3 caches production, downtime, personnel and pair calculations in memory.
Each calculation retains at most 48 recent period keys. Accepted source snapshots
are treated as read-only; replacing a source invalidates its cached results.
Monthly forecasts and workforce measurements also include the local calendar day
in their keys, and goal changes invalidate the monthly result. The calculations
and units retain their existing formulas.

Rendering tracks the last displayed inputs separately from the calculation cache.
Changing only the month preserves the annual tables. Navigating between sections
preserves charts, tables and open disclosures when their inputs are unchanged.
Production, personnel, downtime and pair refreshes update their dependent regions;
returning to an earlier period still renders that period, even if its calculations
are already cached.

A fresh step 3 control at `665b5927a3bf27a4571e163de666730731cac339` and
the repeat used the same 2000-record fixture, CPU rate 4 and five-sample medians:

| Action / metric | Before BG / EN (ms) | Step 3 BG / EN (ms) |
| --- | ---: | ---: |
| Change month (`settledMs`) | 52 / 73 | 29 / 34 |
| Change section (`settledMs`) | 57 / 70 | 31 / 30 |
| Repeated calculation batch (`scriptMs`) | 46 / 44 | 0.4 / 0.3 |
| Unchanged production file refresh (`settledMs`) | 74 / 93 | 71 / 87 |

The calculation batch invokes six aggregate functions ten times without DOM
rendering, after warm-up. It demonstrates reuse rather than a user interaction
latency. Section dispatch fell from 34/33 ms to 0.9/0.9 ms; its two-frame timing
still has a presentation floor near 30 ms. Unchanged file refresh is effectively
unchanged within run variation: a newly parsed snapshot still invalidates its
dependent calculations. Detecting unchanged files and coordinating refreshes
remain for step 4.

Validation includes 41 related unit tests and both offline/server browser
statistics scenarios. They check exact totals and units, source/goal/roster
changes, team filters, empty-data recovery, local day rollover, BG/EN and retained
DOM nodes in unaffected regions. Existing offline workflows also cover file
connections, fallback import/export and responsive statistics.
Further work is tracked in [the performance card](https://trello.com/c/U3DEltWF).

Step 4 compares the actual local file text, preserving the accepted snapshot when
its bytes are unchanged. Same-size edits are still detected. Server refreshes
compare the returned data while updating record versions and checking access on
every request. Ordinary overlapping refreshes share one pending read, one
acceptance and one render. Local files are still read, and the server still sends
the full response; this is not a network-payload reduction.

Polling pauses while the browser page is hidden. Returning visible requests the
latest data. Server change notifications share a queue across modules using the
same callback; a change arriving during a read schedules a follow-up read. Busy
saves and task dialogs defer background updates, and closing a task dialog
refreshes the list. Existing EventSource authentication/revocation remains active.
Fresh checks before a save or explicit conflict review bypass an older pending
read. Local writes retain their independent disk validation and invalidation of
stale reads. No new persistent cache is introduced.

Unchanged task cards and counters retain their DOM. Local-day changes still
update statistics, and task start/due/grace boundaries still update available
actions and overdue totals. Instruction refresh and server file-change events
reload attachment caches even when the index itself is unchanged. Instruction
refresh renders once instead of twice.

A fresh control at `6afdbc185df202d89de99d42937a1a06ade48b19` and the
step 4 repeat used 2000 fictional records, CPU rate 4 and five-sample medians:

| Unchanged production file refresh | Before BG / EN (ms) | Step 4 BG / EN (ms) |
| --- | ---: | ---: |
| Invoked action (`scriptMs`) | 58.5 / 52.8 | 6.8 / 6.2 |
| Action plus two frames (`settledMs`) | 72.3 / 85.7 | 31.2 / 30.6 |
| Mutation callback time (`observerMs`) | 6.5 / 19.0 | 0 / 0 |

The benchmark invokes the same explicit refresh plus `renderAll()` in both runs.
Preserved source identities allow the latter to reuse the existing displayed
results. The two-frame timing retains its presentation floor; these figures are
not a whole-site or live-installation speedup.

Validation includes 108 related unit tests, full offline workflows and focused
server statistics/lists, task/photo/history/permission, report-operation conflict
and retry, instruction-import and notification scenarios. Browser regressions
verify one read for three concurrent refreshes, retained DOM and source identity,
no periodic reads during simulated hidden visibility, fresh results on resume,
unchanged-data day rollover, BG/EN and protected task drafts. Unit regressions
also cover same-size edits, invalid-data recovery, reconnection, stale errors,
busy writes, attachment reloads and change notifications during slow reads.

Step 5 adds authenticated read-only period projections at
`/api/statistics/period/{production-log|line-downtime|pair-targets}?month=YYYY-MM`.
Production and pair statistics receive detailed records only for the selected
month. Compact production/downtime summaries and available-year metadata still
cover every report, so annual totals and year selectors remain complete.
Downtime receives detailed records for the selected year, or every year with
`scope=all`, because the existing reason and record views need those details.
The legacy full-document statistics routes remain available.

The server caches only the latest revision of each of these three documents in
memory. Every request still checks the current session and module access, and a
document revision change rebuilds its period buckets and summaries. No cache
files are written. Browser refreshes coalesce only identical period URLs and
reject responses for an older selection. Scope changes wait for outstanding
monthly reads. A failed request retains the accepted snapshot and shows a retry
message; manual refresh clears it after all sources match the selected period.
Statistics projections cannot be written through the client synchronization API.
Offline statistics continue to calculate from the complete local files.

Task badges use SQL counts instead of parsing every task into JavaScript.
Review-only counts use a status index; reporting counts retain owner/participant
assignment and shift-start checks, including mixed review/report permissions.
`/api/notifications/summary` returns only the unread count. Its query excludes
read rows, respects current category permissions and rechecks task visibility;
the inbox still uses its paginated content endpoint. Notification event/reminder
maintenance remains active on both endpoints.

On 11 October 2026, the new targeted-read benchmark compared both authenticated
HTTP routes against the same generated dataset in an in-memory database. The
selected partial month contains 25 reports. These are five-sample warm medians
including the response body and client JSON parse, without network throttling:

| Production records | Full response / period response | Full / period time (ms) |
| --- | ---: | ---: |
| 200 | 36,924 / 4,572 bytes | 4.96 / 2.75 |
| 2000 | 372,644 / 6,107 bytes | 16.02 / 2.64 |

The 2000-record period response is 98.4% smaller while retaining exact annual
totals. The first period request after a revision change also parses and indexes
the whole source; its single measured sample was 11.98 ms, which is not a stable
cold-request estimate. Larger selected months and all-year downtime detail can
still return substantial data.

With 2000 generated tasks and up to 1000 retained inbox rows, the notification
counter response was 13 bytes versus 560 bytes for the three-item inbox page.
HTTP medians were 78.65 versus 107.10 ms. Existing maintenance still scans task
events and dominates much of that time. Task counter function medians were
0.14 ms for review, 4.34 ms for reporting and 4.71 ms for mixed permissions.
The separate unchanged quick benchmark compared the previous step at
`e6aeab50a26ba0cc922ff18e9c9af400d76fc004`: the same 2000-task empty review
queue fell from 43.7 to 0.2 ms. That comparison measures the function without
HTTP and does not represent reporting accounts or whole-site speed.

Validation includes 150 related unit/API tests and browser statistics, inbox and
offline workflows. It covers exact annual/monthly totals, units, empty periods,
cache invalidation, out-of-order responses, scope changes during reads, request
failure and manual retry, BG/EN, retained unaffected DOM, access denial and
read-only projections. Counter parity tests cover 2000 mixed tasks, participants,
shift boundaries, read notifications, missing/moved targets and revoked rights.

Step 6 prepares static delivery once at server startup from the existing reviewed
source allowlist. A deterministic version hash covers only those public source
files and their paths. Served HTML links JavaScript, CSS and public images with
`?v=<version>`; the injected navigation logo uses the same version. CSS image
references and manifest icons also receive versioned URLs. A source change gets
a different version on the next server start. Offline HTML/CSS/JS files retain
their original relative links; version rewriting happens only on the server.

An exact current-version URL receives `public, max-age=31536000, immutable`.
Plain, stale or ambiguous version URLs receive `public, no-cache` and must
revalidate. The manifest and notification worker always revalidate, keeping their
stable URLs and the worker's root scope. Each available representation has its
own strong ETag; matching `If-None-Match` requests return 304 with no body.
HTML pages, login/redirects, the account/session bootstrap, APIs, task photos,
attachments and errors continue to use `no-store`. The notification worker still
has no fetch handler or Cache Storage entries.

Text responses of at least 256 bytes get precomputed gzip (level 6) and Brotli
(quality 5) variants when compression reduces their size. Responses negotiate
the client's supported coding and quality preferences, including exclusions and
an uncompressed fallback. `Vary: Accept-Encoding`, representation-specific ETags
and encoded `Content-Length` keep cached variants distinct. GET and HEAD share
the same headers; HEAD has no body. PNG files stay in their existing encoded
form. Compression and HTML transformations run once in memory at startup, rather
than on each request. No API, session or private-file compression is added.
The header behavior follows [HTTP semantics](https://www.rfc-editor.org/rfc/rfc9110.html#section-12.5.3)
and [cache directives](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Cache-Control).

The static benchmark measured the same 29 public resources referenced by the
statistics page, before step 6 at `f61b2eb45beda1396d08abd592ee5f97341d08df`
and after the change. It used Node 24.19.0, Chrome 154.0.8037.99, loopback HTTP,
five-sample medians and an isolated fictional login:

| Static response bodies | Before | Step 6 |
| --- | ---: | ---: |
| Uncompressed | 380,696 bytes | 380,699 bytes |
| gzip requested | 380,696 bytes | 109,056 bytes |
| Brotli requested | 380,696 bytes | 102,871 bytes |
| Conditional repeat | Full bodies, no 304s | 0 body bytes, 29 responses with 304 |

Brotli reduces this measured static payload by 73.0%, and gzip by 71.4%.
Sequential loopback request medians stayed near 13–16 ms; they do not demonstrate
a meaningful latency improvement on this fast local connection. HTTP body sizes
exclude headers. The benchmark also performs real browser navigations without
Playwright routing, which would disable the HTTP cache. First-load resource
transfer fell from 384,088 to 105,772 bytes. A repeat navigation fell from 28
static requests and 384,088 bytes to zero static requests/transfer, with all 28
resource entries reused from the browser cache. HTML, session and API requests
still run; this is not a zero-request page load or a live-installation result.

Validation includes 177 related unit/API tests and browser checks for lossless
decompression, weighted/excluded encodings, validators
across encodings, GET/HEAD/304 headers, stale/duplicate version parameters,
no-store behavior on real synthetic photos and attachments, session revocation,
module access, navigation, statistics and notifications. A real-browser fixture
changes releases at the same origin while its cache is warm: it loads new code
without manually clearing the cache. A second account receives its own fresh
bootstrap while reusing public source files.

### Final measurements — 11 October 2026

The completed six-step implementation at
`744ee8f2b21b40c97161ed77a384d6e384d630f2` was measured again with a
clean worktree, Chrome 154.0.8037.99, Node 24.19.0 and a 1440×900 viewport.
The full browser, targeted-read and static-asset benchmarks ran sequentially,
without regression tests running alongside them. Every dataset and account was
fictional. Each timing is a median of five warm samples on loopback networking;
the full browser run completed with zero page errors.

Final browser timings below are `settledMs`, including mutation callbacks and
two animation frames. Each cell shows BG / EN milliseconds. Task search includes
the 150 ms debounce and waits for actual results. Timings near 31 ms have a
two-frame presentation floor; they do not mean the action itself takes 31 ms.

| Records / simulated CPU rate | Change month | Unchanged refresh | Open latest history month | Change history label | Task search |
| --- | ---: | ---: | ---: | ---: | ---: |
| 200 / ×1 | 32.9 / 30.9 | 30.8 / 31.4 | 31.0 / 30.7 | 30.9 / 30.8 | 173.6 / 175.7 |
| 200 / ×4 | 30.4 / 33.7 | 30.7 / 31.0 | 56.4 / 64.3 | 30.2 / 31.5 | 231.5 / 245.0 |
| 2000 / ×1 | 31.0 / 31.0 | 31.6 / 32.1 | 31.7 / 31.0 | 31.2 / 31.6 | 174.1 / 176.5 |
| 2000 / ×4 | 31.2 / 33.3 | 31.9 / 30.9 | 68.6 / 77.0 | 30.4 / 31.2 | 238.0 / 250.5 |

The comparable 2000-record, CPU rate 4 actions changed as follows:

| Action (`settledMs`) | Before BG / EN (ms) | Final BG / EN (ms) |
| --- | ---: | ---: |
| Change month | 73.6 / 92.6 | 31.2 / 33.3 |
| Unchanged production file refresh | 82.3 / 166.6 | 31.9 / 30.9 |
| Rebuild history with latest month open | 1571.5 / 1961.7 | 68.6 / 77.0 |
| Change one history status label | 261.8 / 711.2 | 30.4 / 31.2 |
| Search global tasks, including results wait | 2631.2 / 3003.2 | 238.0 / 250.5 |

The first four controls are the initial main run at `7450b15`.
Search uses the fresh `3f7f661` control with the updated results-aware measurement,
rather than comparing input dispatch alone against a debounced search. The final
history DOM contains the selected month's 25 rows rather than all 2000; all month
headers and totals remain available. Search creates 50 cards per page and filters
all records. Opening every history month can still create a large DOM.
At CPU rate 4, the unchanged-refresh action itself measured 6.0 / 6.2 ms,
with zero mutation callbacks, and section dispatch measured 0.9 / 1.0 ms.

The final authenticated HTTP measurements retained exact production totals:

| Production records | Full / selected-month body bytes | Full / selected-month median (ms) |
| --- | ---: | ---: |
| 200 | 36,924 / 4,572 | 4.61 / 2.51 |
| 2000 | 372,644 / 6,107 | 16.25 / 2.72 |

The selected month has 25 detailed reports in both fixtures; the 2000-record
response is 98.4% smaller. The single first period request measured 12.59 ms and
includes indexing the source revision; it is not a stable cold-request estimate.
With 2000 tasks and 1000 retained inbox rows, the counter/inbox bodies were
13 / 560 bytes, with HTTP medians of 85.28 / 112.41 ms. Notification maintenance
remains active and is still a material cost. Task summary function medians were
0.13 ms for review, 4.29 ms for reporting and 4.66 ms for mixed permissions.

The same 29 public static assets measured 380,699 bytes uncompressed,
109,056 bytes with gzip and 102,871 bytes with Brotli. Compared with the pre-step-6
380,696-byte payload, gzip saves 71.4% and Brotli 73.0%. Conditional repeats
returned 29 responses with 304 and no response bodies. Sequential HTTP medians
were 17.23 / 14.74 / 14.55 ms for identity / gzip / Brotli; these local timings
do not demonstrate a meaningful network-latency improvement.
The real browser's first static-resource transfer was 105,772 bytes. On repeat,
all 28 resource entries used the cache: zero static requests reached the server
and static transfer was zero. HTML, session and API requests still execute.

Final regression validation passed all 177 related unit/API tests and all ten
offline browser workflows, including BG/EN and responsive navigation.

These measurements cover the stated actions and fixtures, rather than a
whole-site speedup. CPU rate 4 is a processing simulation, not a physical phone;
there is no network throttling, live-installation measurement or concurrent-client
load test. Production files and the manual production installation were untouched.
These measurements were recorded on the dedicated feature branch before the
user-requested integration into main. Trello completion follows the verified
merge and push to main.

### Task performance (12 October 2026)

Task cards now retain their DOM nodes and decoded photos when another task
changes. The cache holds at most the current page's 50 cards and checks the full
item, language, timezone and start/due boundaries before reusing a card. Date
formatters are reused per timezone; search reads the filter controls once per
render. Search still has the existing 150 ms debounce.

Photo previews load when they approach the viewport (150 px margin), with
asynchronous decoding and fixed display space. Scrolling, pagination, editor
previews and history dialogs all activate their images; the full viewer opens
the original evidence. Browsers without IntersectionObserver retain native lazy
loading. This reduces early downloads, without changing photo quality or adding
stored thumbnails.

Previously every authorized photo request scanned all task records for retention
cleanup. The server now reuses the cleanup decision until the earliest exact
retention deadline or a database write. Local writes, rolled-back writes, writes
from another connection and backwards clock changes invalidate that decision.
The decision is recorded only after a successful transaction. Task visibility,
photo association and photo bytes are read for each request; authenticated photo
responses still use `Cache-Control: no-store`.

Repeat the comparison from this demo repository with Node.js 24+, Chrome and the
Playwright dependency described above:

```sh
node scripts/run-task-performance-benchmarks.cjs --baseline=2d6dab3
node scripts/run-task-performance-benchmarks.cjs
node scripts/run-server-browser-tests.cjs --headless --task-performance-only
```

The baseline option extracts the selected local commit to a temporary directory;
both versions use the same measurement script and generated fixture. No checkout
is modified. Each run uses an isolated Chrome context and in-memory SQLite,
2,000 fictional global tasks with 10 events each, and four generated noise JPEGs
on each of the first 50 cards (200 photos, 241,278 bytes each). No production data,
personal browser profiles, screenshots or traces are used. External browser
requests are blocked. Node was 24.19.0, Chrome 154.0.8037.99; viewport 1440 × 900.

Values below are medians of seven samples after a warm-up. Browser timings use
CPU rate 4; server method timings use the host CPU without throttling. The two
comparison series ran before/after sequentially. The first-viewport request count
is sampled 800 ms after the 50 cards appear, before scrolling; payload estimates
exclude HTTP headers. Results time ends when the DOM update is observed; settled
time additionally waits for two animation frames and includes translation work.

| Measurement | Before A | After A | Before B | After B |
| --- | ---: | ---: | ---: | ---: |
| 20 authorized photo method calls, ms | 595.3 | 10.0 | 1845.7 | 12.9 |
| First-viewport photo requests | 12 | 4 | 12 | 4 |
| First-viewport photo payload, KiB | 2827.5 | 942.5 | 2827.5 | 942.5 |
| Repeat current list, BG results / settled, ms | 97.9 / 187.0 | 32.9 / 151.6 | 365.3 / 589.1 | 41.5 / 179.1 |
| Repeat current list, EN results / settled, ms | 114.6 / 179.4 | 55.4 / 154.0 | 164.0 / 258.2 | 68.7 / 183.6 |
| Search, BG results / settled, ms | 223.4 / 279.6 | 183.4 / 242.6 | 314.0 / 480.9 | 189.8 / 258.8 |
| Search, EN results / settled, ms | 261.7 / 315.3 | 200.5 / 251.1 | 246.9 / 300.9 | 216.2 / 283.1 |

Machine load varied substantially. An extra standalone after-run recorded a
35.3 ms photo batch and BG search at 388.6 / 714.6 ms, so these timings are not a
latency guarantee. The consistent result is fewer initial photo requests and
less repeated task scanning/card construction. CPU rate 4 is a simulation, not
a physical phone. This measures loopback, not a live server, slow network,
recurring-schedule load or concurrent-client capacity. The task API still sends
all accessible task records and events; this change does not add API pagination
or history-on-demand.

Validation: 531 unit/server tests passed. Browser suites `--tasks-only`,
`--lists-only` and `--task-performance-only` passed, covering evidence upload,
compression, multiple photos, viewers, reports, history, assignment and permissions,
retention, paging, search, refresh, drafts, BG/EN and widths 320/390/1440. New
regressions verify deferred scrolling, unchanged-card reuse after another card
changes, current history/action handlers, exact due boundaries, native fallback,
cleanup invalidation across database connections and exact photo expiration.

Integration with exact notification links restores focus and reveals the linked
task after the complete view is attached, including history sections assembled
off-DOM. A regression refreshes a neighboring task and verifies that the reused
linked card retains focus and loads its photo after automatic scrolling.

### English translation startup (19 October 2026)

The translator previously combined all ~2000 English keys into one regular
expression. Chrome compiled it on the first English translation of every page,
which took about 170 ms on the host CPU. Matching now uses an index of keys by
first character, built on first English use. The rules are unchanged: whole
words, a key space matches any whitespace run, leftmost match first, then the
longest key. `tests/i18n.test.cjs` compares the new matcher against the former
regular expression on every key with boundary, whitespace and combination variants.

Headless Chrome 155 at CPU rate 4 on offline `file://` pages, medians of five fresh
contexts, `main` at `6035862` before / after:

| Page | First BG → EN switch (ms) | Page load with EN saved (ms) |
| --- | ---: | ---: |
| Statistics | 774 / 52 | 1275 / 633 |
| Production log | 766 / 31 | 1149 / 385 |
| Home | 758 / 18 | 1149 / 505 |

Bulgarian pages no longer build the expression at all. They still load
`js/i18n-en.js` (about 45 KB with Brotli, cached by version). These are local
measurements, not results from a physical phone or the live installation.

### Page load profile (19 October 2026)

Every server page was profiled in headless Chrome 155 at CPU rate 4, signed in to
an isolated SQLite database with 2000 generated fictional production reports,
downtime entries, pairs and tasks. Two causes recurred:

- `Number#toLocaleString` and `Date#toLocaleString` create a new formatter on
  every call (about 17–80 µs each in Chrome). Statistics, production, downtime and
  pair rows now reuse `Intl.NumberFormat` / `Intl.DateTimeFormat` instances with the
  same locale and options, so the text is identical by specification.
- In Bulgarian the translator visited the whole page and observed every DOM change
  without translating anything. It now does so only while English is selected; a
  switch back to Bulgarian restores the original text once and stops observing.

JavaScript CPU time per page load (profiler samples for the application's own
scripts, median of three runs, before / after):

| Page | ms | Page | ms |
| --- | ---: | --- | ---: |
| Statistics | 440 / 200 | Production log | 118 / 77 |
| Pair targets | 135 / 110 | Personnel | 119 / 87 |
| Tasks | 102 / 83 | Line downtime | 80 / 67 |
| Home | 45 / 29 | Other 11 pages, total | 577 / 384 |

All 18 pages together: 1616 / 1037 ms. The longest statistics task fell from
about 270 ms to 95 ms. Unchanged on purpose: per-render formatters in access and
status messages, the server permission model, and data comparison on server refresh,
where each remaining cost is a few milliseconds of real time.

### Report storage growth (19 October 2026)

Production, downtime and pair reports are stored as one JSON document per
module in `documents`. This evaluation measured that layout with generated
fictional data; no production database was opened or changed.

```sh
node scripts/run-storage-benchmarks.cjs
node scripts/run-storage-benchmarks.cjs --quick
```

The script uses a temporary SQLite file (WAL) created by the normal server,
deliberately generous volumes of 5 production, 8 downtime and 12 pair reports
per day, and one history row per report. A write is one complete
`reportOperation` create by an administrator; backup is the regular `VACUUM
INTO` snapshot plus archive verification. Values are medians of five samples
after a warm-up on a local Intel Mac (Node 24.22.0, `darwin-x64`), without a
Docker volume or concurrent clients.

| Years | Reports (prod / downtime / pairs) | Database | Backup | Write prod / downtime / pairs | Read pairs |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1 | 1,825 / 2,920 / 4,380 | 11.3 MiB | 0.20 s | 74 / 101 / 450 ms | 29 ms |
| 3 | 5,475 / 8,760 / 13,140 | 33.4 MiB | 0.61 s | 217 / 327 / 2,154 ms | 157 ms |
| 5 | 9,125 / 14,600 / 21,900 | 55.6 MiB | 1.00 s | 483 / 612 / 3,814 ms | 150 ms |

The pair document reaches 11.3 MiB after five years. Database size and backup
time grow linearly and remain acceptable. Write time is the real problem: every
write runs synchronously on the Node event loop, so a multi-second pair write
blocks every other request. An equivalent indexed row insert plus history row
took 0.27 ms at every size.

A CPU profile shows that SQLite I/O is not the main cost. Each write parses the
whole document several times through `get()`, compares every entry with
`isDeepStrictEqual`, runs one `report_versions` statement for every existing
entry in `updateDocument()` and validates the whole module again.

#### Row storage (schema version 5)

Report records are stored one per row in `report_entries(kind, id, position,
data)`. The module document keeps its metadata (`goalTons`, `reasons`,
`module`, `schemaVersion`) and revision, with `entries: null` as a placeholder
that preserves the original key order. `get(kind)` rebuilds the same
`{...metadata, entries}` object in the original order, so the API, statistics,
JSON export/import, offline files and notification logic are unchanged.

Migration rules, chosen so that no record can be lost:

- A report document whose `entries` is still an array is a legacy module and is
  authoritative. It is moved to rows when the store opens (and lazily on the
  next read if a document is written directly, for example by tests).
- The move runs in a savepoint. The rebuilt module must serialize to exactly the
  same JSON as the original; otherwise it rolls back and the module stays in the
  legacy layout, which keeps working. Revisions and record versions do not change.
- Before moving any non-empty legacy module in a file database, the store writes
  a private `VACUUM INTO` copy to `migration-backups/pre-report-entries-*.sqlite`
  beside the database (mode 0600). If that copy fails, the store refuses to start.
- Writes change only the affected rows. Positions are kept while surviving
  records stay in order and new ones are appended; any other order renumbers all
  records. Production and pair writes still validate the whole module.
- Backup verification and restore accept version 4 and 5 archives and validate
  the rebuilt modules. A damaged row makes an archive invalid.
- Older application versions stop at start-up on a migrated database (they
  expect an array) instead of showing empty modules. To roll back, restore the
  pre-migration copy or a version 4 archive; writes made after the migration
  are only in the newer database and archives.

Measured after the change with the same benchmark (load average about 10, so
compare with the interim row below only roughly):

| Years | Database | Backup | Write prod / downtime / pairs |
| --- | ---: | ---: | ---: |
| 1 | 13.0 MiB | 0.35 s | 48 / 66 / 252 ms |
| 3 | 38.4 MiB | 0.67 s | 153 / 246 / 602 ms |
| 5 | 64.0 MiB | 1.74 s | 260 / 478 / 1,540 ms |

The database is about 15% larger because of the row index. Writes no longer
serialize the whole module, but they still rebuild and validate it, so they
remain linear. Constant-time writes need the next step: `reportOperation`
validating only the affected record and its shift scope.

#### Interim optimization (implemented)

Without changing the storage format, the write path now:

- freezes implicit versions of untracked legacy records with one SQLite
  `json_each` statement instead of one statement per existing record;
- reuses the document already read by `reportOperation()` and `put()` in the
  same transaction instead of parsing it again in `updateDocument()`;
- computes notification targets once and skips the whole-document comparison
  when a record has already changed;
- looks up previous pair records through a map instead of a linear search per
  record, which removes quadratic pair validation.

The same benchmark compared the previous commit and this change back to back.
The machine was under load from other work (load average 10–20), so absolute
values are higher than in the first table; compare only within a row.

| Years | Write prod: before → after | Downtime: before → after | Pairs: before → after |
| --- | ---: | ---: | ---: |
| 1 | 107 → 62 ms | 132 → 106 ms | 681 → 335 ms |
| 3 | 291 → 193 ms | 450 → 271 ms | 3,710 → 1,089 ms |
| 5 | 579 → 297 ms | 856 → 391 ms | 5,460 → 2,359 ms |

Writes are roughly two to three times faster and pair writes no longer grow
quadratically, but every write remains linear in module size. Row storage is
still required for constant-time writes at five years of pair data.

## Planned shift transfers

Status: implemented. Production deployment uses a separate manual copy. Trello:
[planned shift transfers](https://trello.com/c/09ZI3cLS).

### Required behavior

An administrator plans a person's move from any production team A/B/V/G to
another team or to/from Stickers in Personnel → Edit person. The source
assignment remains effective until the selected date. The target assignment
then applies automatically, including after a restart or while no client is
open. No scheduled job needs to rewrite the roster: readers resolve the
assignment for the requested date.

The user requires a maximum of **6 consecutive working days** across the
transition, including days preceding the transfer. A date that creates a
seventh consecutive working day is rejected by the UI and server. This is a
schedule check; actual overtime, attendance and payroll are not recorded here.
The interface describes planned working days and does not promise wages.

### Calculation rules

- A working day is the local date on which a scheduled shift starts. A night
  shift belongs to its start date and finishes the following morning. A move
  never interrupts that shift at midnight.
- All calendar calculations use Europe/Sofia. Date stepping uses calendar
  days, not elapsed blocks of 24 hours, including daylight-saving changes.
- The first selectable date is tomorrow, avoiding reassignment of a shift
  already under way. Search the following **32 dates** (inclusive of that
  first date). The administrator can choose a later search start.
- Compare every candidate against staying in the original assignment over
  the **same 64-day window**, starting at the search start. This keeps the
  displayed gain/loss comparable and covers at least 32 days after each move.
  Show the window explicitly; do not imply a lifetime or monthly wage result.
- Reject overlapping shifts and display the interval between the last old shift
  and the first new shift. The user explicitly declined a general minimum of
  12 hours. A rest day is required where otherwise a seventh consecutive working
  date would occur; recommend a different effective date with a valid rest day
  rather than silently deleting a scheduled working day.
- Count consecutive working dates across the complete assignment timeline,
  checking at least six days on each side of every changed boundary. Rest
  dates reset the count. A night shift's end does not create another working
  date. Changes in section without a change in rotation still count as work.
- Recommend the earliest valid candidate with no reduction in working days.
  If none exists, show the smallest reduction and all relevant warnings. If
  all dates fail the hard checks, show that no allowed date was found; never
  save a rejected date through an override.

### Data and integration

Use personnel schema **4**, accepting legacy schemas 1–3 on input. Preserve
the initial category/team as a baseline and add an ordered, bounded per-person
`transfers` array of `{effectiveDate, category, team}` (maximum 256 entries; no history is truncated). Resolving a date applies
the latest transfer starting on or before it. Normalization, export and import
retain these fields. Existing fictional fixtures remain unchanged. Old clients
must reject schema 4 rather than silently drop the timeline.

Allow **one pending future transfer per person**. The editor can replace or
cancel that pending transfer, with fresh validation. Completed transfer history
is immutable through ordinary editing. Changing team/category in Edit person
uses this flow; name, role and note edits retain their current behavior. Initial
assignment of a new person is unchanged. Inactive people do not get a new
transfer plan; their previous history remains stored.

The shared personnel model resolves assignments and provides a pure transfer
planner using the existing shift rotation. Personnel summaries use the current
date; the selected-day roster uses that day's assignment. Pair planning resolves
the roster on the pair's production date, in both browser and server validation.
Already saved pair snapshots are not rewritten. Workforce statistics continue
to show the current roster, now resolved by date. Narrow roster endpoints retain
only the assignment fields their consumers need; notes and the personnel change
log remain private to the personnel permission boundary.

Validate structure and transition rules in the shared file validator and again
against fresh data on server writes/imports. Preserve past transfer history;
reject stale revisions and attempts to bypass the dated transfer through a raw
team change. Keep the current permissions, transactional writes and rollback.
Failed saves keep the editor's draft and produce fixed error text without private
values. Future dates apply from the model's date resolution, not from a timer or
database mutation at midnight. Visible screens refresh at the local day boundary
and on returning to the page; the server checks dates independently.

### Editor and acceptance

The existing Edit person dialog includes a transfer section with target assignment,
search start, recommendations, chosen effective date, the comparison window,
old/new working days, longest consecutive run, rest interval and a daily preview.
Show the current and pending assignment separately. Save/replan/cancel are
explicit actions, guarded against double submits and concurrent changes. Use
the project's dark styling, accessible controls, BG/EN text and phone layout.

Verify all directed combinations of the four production rotations and Stickers,
and moves between automatic/manual sections. Tests must distinguish allowed six
days from rejected seven days, count work preceding the transfer, cover nearby
completed transfers, night boundaries, weekends, month/year/leap-day/DST changes,
fixed-window comparisons and the absence of valid candidates. Cover persistence,
date-based activation, cancellation, stale writes, import retention, malformed
timelines and direct API bypass attempts. Browser checks cover Personnel and pair
rosters in offline/server mode, 390 px and desktop, BG/EN and denied permissions.

Implementation touches the shared personnel/shift models, data validation,
Personnel editor, pair planning, workforce counts, restricted roster endpoints,
store/import validation, translations and focused tests. It introduces no payroll
or attendance subsystem and performs no deployment or production-data migration
during development. Run publication checks and relevant tests before each commit
and push. Merge only on the user's request; the card remains unfinished until
the completed changes are merged and pushed to main.

### Using the editor and validation

Open Personnel → Edit person and choose the target section/team. The current
assignment and any pending plan appear separately. Select a search start, choose
one of the recommended dates or a permitted date in that search period, inspect
the comparison and save. Changing the pending destination/date replaces that
plan. Use Cancel planned transfer to remove only the future plan. Name, role and
note edits preserve it, including plans more than a month away.

New personnel saves use schema 4, including edits to legacy input. All clients
reading that shared file must use this version; older validators intentionally
reject schema 4. A future transfer becomes effective from its date without a
write, revision change or running browser. This feature checks the scheduled
rotation; actual attendance, overtime and payroll remain outside the data model.
The 256-entry history limit rejects further additions and never discards entries.

Validation on the reviewed fictional fixtures: 697 unit/server tests pass.
Focused offline and server browser flows cover planning, 6/7-day rejection,
persistence, distant plans, replacement, cancellation, failed writes, concurrent
editing, double submission, keyboard focus, BG/EN and 390/1440 px layout.
A cancellation/replan that has become effective while its dialog was open is
rejected with its draft retained; Stickers preview hours are checked in both
directions. A failed midnight workforce read is retried before accepting the day. They
also plan pairs from the dated roster and refresh current workforce at Sofia
midnight in a UTC browser. Existing offline/server personnel, statistics,
transfer/import and default workflows pass (10 offline scenarios and 14 online
workflows in the default runners). No production data was used or published.

## Shift closeout: design specification (2026-10-15)

**Implemented.** The shared server-mode
screen is `/shift-closeout`, available from a permanent toolbar button beside
the module selector. It has no separate tile on the home page.
Supervisors see their assigned team; administrators may select all teams.
The account editor exposes its viewing permission and the two reminder flags;
notification settings allow each recipient to disable either reminder category.
An account without an assigned team receives a configuration message.

The toolbar button is visible on every authenticated page with closeout access.
It shows an amber count of missing tonnage plus pending pairs in the current
account's shift, or green "All reports entered" when both permitted sections
are complete. Rest/upcoming shifts, unavailable reads and incomplete module
access stay neutral. A partial view never displays an overall missing count.
The button refreshes every 30 seconds and on report/account changes,
links to the exact scope and uses the existing unsaved-navigation guard.

Choose the production date, team and shift to inspect entered/missing tonnage,
reported/pending/cancelled pairs and cancellation reasons. Report links retain
that exact scope. Current shift uses server-side Europe/Sofia intervals.
The screen refreshes on report changes and every 30 seconds; a failed read
marks retained values stale. Pair results never replace or add to tonnage.
If an explicit pair link is invalid, selecting a valid date/shift, Current shift
or a history record discards the rejected link context and restores reporting.

Reminder activation and per-recipient phase state are stored additively in the
existing notification-state table. Deploy the server and client together;
existing production, pair and personnel documents need no conversion. The
first activation skips historical reminder deadlines. Existing device opt-in
and payload-free push delivery continue to apply.

Validation with fictional fixtures: 738 unit/API tests passed (333 client/unit,
405 server). Focused closeout, notifications, notification-targets, navigation,
routes, report-operations, closeout-indicator and unsaved-navigation browser suites passed, as did
the offline quantities flow. These include midnight/DST in a UTC browser,
late zero-tonnage reports, cancellation, opt-out, scope races, stale reads,
account/module restrictions, BG/EN and narrow-screen layout.

The specification and implementation plan below retain the reviewed requirements.

### Purpose and expected reports

Shift supervisors and administrators need one screen showing whether a working
shift has its mandatory production report and whether its planned pairs have
results. This check is independent of task completion and never adds pair output
to production totals.

- A working shift is the existing dated team rotation in `ShiftSchedule`,
  including the existing weekday Stickers schedule. The rotation determines
  the shift number, start and end; no new per-line production plan is required.
- Every working team shift requires at least one valid saved production entry
  with the same production date and team (`shift` in production entries).
  An explicitly saved zero-tonnage entry counts as entered. Several entries
  still satisfy one obligation; their presence never creates extra obligations.
- Every active planned pair in the exact date/team/shift scope needs a saved
  result. A zero result counts as entered under the existing pair validation.
  Cancelled pairs are not applicable and show their saved cancellation reason.
  With no pairs planned, show "No pairs planned"; do not invent missing pairs.
- A rest day is not applicable and identifies the rotation as its reason.
  A missing production entry on a working shift is never excused by having no
  planned pairs. Downtime records remain event-based and create no obligation.
- Before the shift starts, identify it as upcoming rather than overdue.
  During and after it, show entered/missing report states; overdue applies
  only after the end plus the ten-minute grace period.

### Shared screen and navigation

Add a server-mode `shift-closeout` screen, linked from the work-module
navigation. It has a production-date selector, a shift selector, a permitted
team selector and a Current shift action. The default is the current shift
in Europe/Sofia; an overnight shift retains the date on which it started.
Stickers uses its separate 09:00-17:30 weekday interval.

The summary shows mandatory tonnage as entered or missing, plus counts of
planned, reported, pending and cancelled pairs. The list identifies each
unreported pair using the existing pair presentation and offers a Report action.
Keep cancelled pairs visible with their reason. A production action opens the
production form; a pair action opens the relevant pair scope and record.
Both destinations preserve the explicit date/team/shift, including delayed
night reports, instead of replacing them with the destination's live defaults.

The screen reads a dedicated authenticated API rather than downloading the
personnel file. It refreshes on relevant server changes and periodically while
open. A failed read shows an error and marks any retained display as stale;
it cannot become an empty or completed shift. Read-only screen actions never
write reports or change existing production, pair or personnel file schemas.
Bulgarian and English copy, keyboard access and narrow-screen layout follow
the existing application patterns. File-mode report forms keep working.

### Access and report visibility

Add an explicit closeout-view permission to the shared client/server permission
model and account editor. Default access is for administrators and the existing
shift-supervisor account profile; explicit denial takes precedence. Ordinary
operators and observers receive no default access. Supervisors are scoped to
their assigned team; administrators may select all teams. An account without
an assigned supervisor team sees a clear configuration message, not all teams.

The API validates dates, team, shift and account scope. Existing production and
pair view permissions still apply to their respective sections and links.
An inaccessible section is labelled unavailable and its records, counts and
report status are omitted; inaccessible data never appears in reminder text.
Reporting actions additionally require the destination's existing creation
permission. Knowing an API URL or notification target cannot grant access.

### Missing-report reminders

Extend the durable local notification service, which already ticks without an
open browser. Do not use a new external notification service. Existing optional
device delivery remains subject to the user's opt-in and module permissions.

For each working date/team/shift, calculate its closeout status from committed
production and pair records. Send at most one combined pre-end reminder and
one combined overdue reminder per eligible account:

- Pre-end: from ten minutes before the end until the end, only while a visible
  required report is missing.
- Overdue: from ten minutes after the end, only while a visible required
  report is still missing. After a server interruption this event may catch up
  until 24 hours after that shift's end; older shifts remain inspectable on the
  screen without producing a backlog of notifications.
- Persist deduplication by reminder phase, production date, team, shift and
  recipient. Repeated ticks, restarts and notification retention do not resend
  the same event. A new missing pair or a deleted report does not reset it.
- Persist the feature's first activation time. Do not replay reminder events
  whose due time predates activation. Subsequent restarts preserve that time.
- Notify the team's active supervisor accounts and entitled administrators.
  Expose separate configurable pre-end/overdue categories in the existing
  notification preferences and account permissions. Respect closeout access,
  team scope, module visibility and preference changes before delivery.
- Use generic reminder text and a validated link to the selected closeout
  scope. Resolve the current status when opened. A late report clears its
  current missing state and suppresses a future reminder when nothing remains
  missing; an already delivered event remains a historical reminder.

All comparisons use the existing Europe/Sofia shift intervals, including
midnight, timezone-independent browser behavior and daylight-saving changes.
No reminder is generated for a rest day or for cancelled pairs alone.

### Implementation boundaries and acceptance checks

Use one shared closeout calculation for the API and reminder scheduler so they
agree on missing reports. Reuse `ShiftSchedule`, committed report validation,
the permission model, durable notifications, clean server routes and the
existing client connection/navigation patterns. Any new storage is additive
notification state; preserve live report documents and their history.

Verify exclusively with fictional fixtures:

1. Working shifts require tonnage even without pairs; rest days do not.
   Saved zero tonnage, multiple entries and a late entry have correct states.
2. Planned pairs without results are missing; reported zero results count;
   cancellation removes the obligation and retains its reason.
3. Date, team and shift scopes do not mix records; pair output is never
   added to production totals or used as a replacement production report.
4. Night shifts keep their start date, Stickers has its own end time, and
   pre-end/overdue thresholds work in Europe/Sofia from a UTC browser and
   across daylight-saving boundaries.
5. Combined reminders fire at the two defined thresholds, deduplicate across
   repeated ticks/restarts, skip pre-activation history and respect the catch-up
   window, late reports, disabled categories and revoked permissions.
6. API, page, notification and destination access follow account/team/module
   rights, including malformed scopes and direct navigation attempts.
7. Screen filters, destination prefilling, background refresh, stale/error
   handling, Bulgarian/English copy, keyboard access and mobile layout work.
8. Existing report, pair, task, notification and permission behavior remains
   covered by relevant regression tests. Run the publication check and relevant
   tests before each commit and push; merge only when requested. Keep the
   Trello card unfinished until the completed feature is merged and pushed.

## Shift closeout implementation plan (2026-10-15)

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development or superpowers:executing-plans to
> implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Give shift supervisors and administrators one accurate missing-report
screen and two durable reminders for mandatory tonnage and pending pair results.

**Architecture:** A focused server module calculates one shift summary from
committed production and pair entries. An authenticated read service applies
account/team/module scope; both the screen and existing notification scheduler
consume that service. Existing forms accept explicit closeout scope links.

**Tech Stack:** Plain HTML/CSS/JavaScript, Node.js 24+, existing SQLite store,
node:test and the existing Playwright browser harness; no new dependencies.

**Spec:** The preceding "Shift closeout: design specification (2026-10-15)"
section in this file. This plan uses the same publication-approved document.

### Global constraints

- Every working team shift requires at least one valid saved production entry.
- Europe/Sofia; overnight shifts retain their start date; Stickers 09:00-17:30.
- Pre-end: ten minutes before the end until the end. Overdue: ten minutes after
  the end until 24 hours after the end. Persist the first activation time.
- Respect existing report/module permissions and the assigned supervisor team.
- Preserve live report documents and their history. Use fictional fixtures only.
- Use this chat's `feature/shift-closeout-01a13dd6` branch. Before each commit
  and push, run publication checks and relevant tests without bypassing hooks.
- Merge only when requested; the Trello card stays unfinished until the feature
  is complete, merged and pushed to main.

### Review focus

1. A late response for an old filter must not replace the newly selected shift
   (Task 4 browser test).
2. A date/team link must survive automatic night-date selection and asynchronous
   pair data loading without changing the requested scope (Task 3 browser test).
3. Revoking team or module access must hide old reminder targets in both inbox
   listing and unread count (Task 2 notification test).
4. Midnight and a daylight-saving night must produce the same scope in a UTC
   browser and the server (Tasks 1 and 4 tests).
5. Empty data, inaccessible data and failed reads must remain distinct; no
   inaccessible report status or false success may appear (Tasks 1 and 4 tests).

### Task 1: Closeout calculation and authenticated API

**Files:** Create `server/shift-closeout.cjs` and
`tests/server/shift-closeout.test.cjs`; modify `js/permission-model.js` and
`server/server.cjs`. Existing account editing consumes permission groups.

**Interfaces:** Export `summarizeShift(scope, sources)` and
`createShiftCloseout(store, {now = Date.now} = {})`.
`scope` is `{date, team, shiftCode}`; `sources` is
`{productionEntries, pairEntries, now}`. Summary fields are `scope`,
`interval: {start, end} | null`, `phase` (upcoming/working/ended/overdue/rest),
`production: {state, entryCount}`, and `pairs: {planned, reported, pending,
cancelled, entries}`. Production state is entered/missing/not-applicable.
Each pair entry is `{id, members:[{id,name}], state, reasonKey, reasonText}`;
state is reported/pending/cancelled. Pair counts satisfy
planned=reported+pending+cancelled.
The service exposes `read(input, user)` and `reminderCandidates(at, user)`.
`read` also returns permitted teams, server time and section availability;
inaccessible production/pair values are null. Reminder candidates contain only
`{scope, phase: 'due' | 'overdue', dueAt, target}`; `target` is
`date/team/shiftCode`, used as an opaque, encoded local notification target.

- [x] Write failing tests: a scheduled team with no pairs still has missing
  production; adding `{date, shift:team, tonnage:0, brak:0}` makes it entered;
  duplicate reports leave one satisfied obligation. A wrong date/team report
  does not satisfy it. Pair fixtures cover pending, zero result and cancellation.
- [x] Add tests for rest days, upcoming shifts, Stickers weekends, start dates
  before 06:00, and the night starting 2026-10-24 across Sofia's autumn clock
  change. Test 400 for invalid dates/teams/codes and mismatched working scopes.
- [x] Run `node --test tests/server/shift-closeout.test.cjs`; verify failure for
  the missing implementation, then implement the two exports using the existing
  `shiftSchedule` export and committed documents. Do not read personnel.
- [x] Add `canViewShiftCloseout` to permission groups; inherit it for admin and
  taskSupervisor profiles only, unless explicitly overridden. Restrict non-admin
  supervisors to taskTeam; a missing team returns a configuration state. Check
  existing production/pair view flags separately, and creation rights for links.
- [x] Wire GET `/api/shift-closeout` to `read(url.searchParams, currentUser())`.
  Test login, GET-only routing, explicit denials, cross-team requests, partial
  module visibility and account updates without leaking hidden section counts.
- [x] Run the new suite plus `tests/server/permissions.test.cjs` and
  `tests/server/module-permissions.test.cjs`; run publication checks, then commit
  as `feat: add scoped shift closeout status API`.

### Task 2: Durable combined reminders

**Files:** Modify `server/notifications.cjs` and `js/notification-model.js`;
create `tests/server/shift-closeout-notifications.test.cjs`; extend
`tests/server/notification-targets.test.cjs` where category iteration requires it.

**Interfaces:** Consume Task 1's `reminderCandidates(at, user)` and `read`.
Register `shiftCloseoutDue` and `shiftCloseoutOverdue` with module
`shift-closeout` and flags `canReceiveShiftCloseoutDue` and
`canReceiveShiftCloseoutOverdue`. Both use existing `href(type, target)`;
the closeout page validates the encoded target before requesting its scope.

- [x] Write failing controlled-clock tests for exactly end-10 minutes and
  end+10 minutes, no event outside the defined windows, and one combined event
  when both tonnage and several pairs are missing. Assert no event when all
  visible obligations are satisfied or only cancelled pairs remain.
- [x] Test repeated sync, service/database restart, retention, activation cutoff,
  report deletion without resending, a late report before the second threshold,
  and the 24-hour overdue catch-up limit. Pre-end delivery never catches up
  after the end. Include night and Stickers intervals from Task 1.
- [x] Run `node --test tests/server/shift-closeout-notifications.test.cjs` and
  observe missing-category/behavior failures. Then extend the existing sync
  transaction and notification_state with activation and per-recipient phase
  keys. Reuse emit and push queue; do not create report or task records.
- [x] Default reminder rights to admin/supervisor accounts with closeout access;
  preserve explicit denials and category opt-out. Apply current target access
  in inbox list, summary and delivery eligibility. Test team reassignment,
  inactive/deleted accounts, module revocation and inaccessible-section-only
  missing reports. Generic text contains no pair names or quantities.
- [x] Run the new suite and existing notifications, notification-targets and
  security-push-boundaries server suites; run publication checks, then commit
  as `feat: remind supervisors about missing shift reports`.

### Task 3: Explicit report destination context

**Files:** Create `js/report-scope.js` and `tests/report-scope.test.cjs`;
modify `js/production-log.js`, `production-log.html`, `js/pair-targets.js`,
`pair-targets.html`, `scripts/run-server-browser-tests.cjs` and
`scripts/run-critical-tests.cjs`; create `tests/browser/shift-closeout.cjs`.

**Interfaces:** Export browser/CommonJS `HubReportScope.parse(search)` returning
null when no closeout scope exists, or validated `{date,team,shiftCode}`.
Links use `?date=YYYY-MM-DD&team=...&shiftCode=N`; a pair may append the existing
`target` parameter. Invalid explicit scope returns a visible error and never
falls back silently. Existing target-only notification links retain precedence
for their actual record; the pair client rejects conflicting explicit scope
after loading the target record rather than mixing it with the requested scope.
Export `exerciseShiftCloseout({admin, hub, base, device, expect, setTime})` from
the browser test. Add `--shift-closeout-only` to the existing server harness and
critical-runner mode list; initially this exercises destination flows only.

- [x] Write failing parser tests for real calendar dates, approved teams,
  shift numbers and malformed/duplicate query values.
  Run `node --test tests/report-scope.test.cjs`, then implement the parser.
- [x] Apply explicit production context through the existing date/shift
  selection flow after initialization, preserving automatic behavior when no
  scope was supplied. Preserve a requested pair scope through live initialization
  and async file loading; existing target revelation still selects its record.
- [x] Add browser assertions: open yesterday's night scope before and after
  06:00, open a pending pair after delayed loading, and save to the requested
  context. No action automatically writes or discards a draft.
- [x] Run parser and report-date-selection unit suites, existing report-operation
  and notification-target browser flows, and the new destination flow through
  `--shift-closeout-only` runner. Run publication checks, then commit as
  `feat: preserve explicit shift context in report forms`.

### Task 4: Shared closeout screen and browser coverage

**Files:** Create `shift-closeout.html`, `css/shift-closeout.css` and
`js/shift-closeout.js`; modify `index.html`, `js/server-connection.js`,
`js/i18n-en.js` and `tests/browser/shift-closeout.cjs`.

**Interfaces:** Consume GET `/api/shift-closeout` through `HubServer.json`,
Task 3 destination links and the existing `HubServer.watch(module, refresh)`.
Extend Task 3's `exerciseShiftCloseout` test with screen flows. Its harness uses
only a temporary database and fictional accounts, and permits UTC browser
contexts for closeout tests without changing the other suites' timezone.

- [x] Add failing browser checks for supervisor/admin access, denied ordinary
  accounts, assigned-team filters, entered/missing tonnage, pair counts and
  cancellation reasons. Run the new harness and confirm missing-screen failure.
- [x] Build the filter/summary/list screen using safe DOM text for record
  content. Render unavailable sections without counts; offer reporting actions
  only with creation rights. Keep requested filters in the URL; Current shift
  derives Sofia time from the API rather than the browser's timezone.
- [x] Add permission-filtered home/navigation entries. Refresh every 30 seconds
  and on production, pair and account changes. Use request sequencing so old
  responses cannot replace a newer scope. Show retained data as stale on read
  failure; an initial failure displays no successful summary.
- [x] Test race-controlled filter responses, a failed read/retry, late report
  refresh, notification links, UTC browser midnight/DST, BG/EN, keyboard access
  and 320/390/1440 px layouts. Preserve draft navigation guards in destinations.
- [x] Run `node scripts/run-server-browser-tests.cjs --headless --shift-closeout-only`
  plus navigation, notification-targets and report-operations focused browser
  suites. Run routes and i18n unit/server suites and publication checks, then
  commit as `feat: add supervisor shift closeout screen`.

### Task 5: Integration review and delivery

**Files:** Update this guide with implemented behavior and validation evidence;
review the entire branch and any affected existing tests.

- [x] Review each specification acceptance check against its actual test and
  implementation, including explicit permission denials, catch-up/activation,
  revoked reminder targets, empty pairs and mandatory tonnage. Correct gaps.
- [x] Run `node scripts/run-critical-tests.cjs` and the focused closeout,
  notifications, notification-targets, navigation, routes, report-operations
  and unsaved-navigation server browser suites. Confirm offline report-date
  behavior with its existing unit tests and offline quantity/browser workflow.
- [x] Document actual behavior and exact validation results; remove the
  specification's "not implemented" notice only after implementation verifies.
  Run publication checks and relevant tests, then commit the delivery notes.
- [x] Review the outgoing diff and run the publication hook plus relevant tests
  before pushing the dedicated branch. Report commit links and remaining work.
  Do not merge without the user's request or mark Trello done before main is
  updated with the verified complete feature.

## Publication

This repository contains a sanitized portfolio snapshot. No distribution license
has been selected. Never replace these fixtures with real personnel, customer documents or factory
records in a commit. Removing a file in a later commit does not erase its history.
