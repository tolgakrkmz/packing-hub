# Package Hub

An offline production dashboard built with plain HTML, CSS and JavaScript.
It helps plan shift teams, assign pair targets, record production and downtime,
and review monthly results without a backend or build step.

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

Source filenames and this README are in English. The pair targets module opens
directly without a role login.

## Run locally

1. Download or clone the repository into a separate demo folder.
2. Open `index.html` in Chrome or Edge. No installation or internet connection is required.
3. Connect the corresponding JSON fixtures from `data/` when opening a module.
4. For Pair Targets, select both `pair-targets.json` and `personnel.json`.
5. For Statistics, select the production, downtime, personnel and pair-targets fixtures.
6. For Packing Instructions, select the repository folder containing `data/`.

Some management screens use the public demonstration password **`demo-admin`**.
This is a browser UI toggle, not a security boundary. Permissions to read or
write files are provided by the browser and operating system.

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

## Publication

This repository contains a sanitized portfolio snapshot. No distribution license
has been selected. Never replace these fixtures with real personnel, customer documents or factory
records in a commit. Removing a file in a later commit does not erase its history.
