# Security review — demo source only

Review dates: 2026-10-12 and 2026-10-13. Initial baseline: `3020f95bdc457a1198ef8e6013bee55c90ca9143`.
Final branch: `feature/security-validation-20261012`.
The initial test agent prepared the baseline and HTTP coverage on
`feature/security-fixes-20261012`; the coordinator continues from those commits
in a separate branch after both auxiliary chats were stopped.

## Scope and execution

Only reviewed demo source and fictional generated accounts are tested. HTTP
tests bind to `127.0.0.1` on ephemeral ports. Databases and generated uploads
are temporary. Web Push transport is mocked; no external scanners, tunnels,
production documents or production databases are used.

Use Node 24 for `node --test tests/*.test.cjs` and
`node --test tests/server/*.test.cjs`. The restricted sandbox refused loopback
sockets (`EPERM`), so those HTTP tests are run with local socket permission.
That first environmental refusal is not an application vulnerability.

Baseline with Node 24 and local socket permission: client/source suite
**273/273 passed**; server suite **264/264 passed**, zero failures, skips or
cancellations. The exact document allowlist addition passed **15/15** publication
regressions, including private-token, binary, symlink and unapproved-path refusals.

## Existing security coverage

| Area | Existing regression coverage | Additional review |
| --- | --- | --- |
| Login/session/cookie | `api`, `session-lifecycle`, `accounts-delete` | malformed login bodies, rate-limit boundaries |
| Roles/IDOR | `permissions`, `module-permissions`, `tasks`, `task-photos`, `notifications`, `imports` | forged identifiers and unchanged state |
| CSRF/Origin | HTTP `api`, `permissions`, `notifications`, `tasks` | missing/null Origin and token mismatches |
| XSS/CSP | secure headers in `api`; publication SVG pinning | hostile data, script bootstrap and attachment headers |
| Imports/uploads/traversal | `imports`, `import-lifecycle`, `task-photos`, `api` | malformed encoded paths and boundary sizes |
| SQL injection | prepared store/account queries; activity filter validation | login and query injection inputs |
| SSRF/Web Push | allowed provider hosts, payload-free signing, mocked retries in `notifications` | deceptive hosts and redirects |
| Request limits/errors | body limits and generic errors in `api`, image quotas | overflow HTTP behavior and sanitized failures |

## Finding register

### Additional checks without a reproduced defect

`tests/server/security-http.test.cjs`: **9/9 passed**. Checks real HTTP behavior:
oversized JSON returns `413` without mutation; malformed/non-object JSON and
unsupported media are refused; SQL-like usernames return the same generic login
failure; missing/null/hostile/prefix Origins and cross-session CSRF are rejected;
encoded traversal and malformed paths disclose no file content; notification
JSON accepts exactly 4096 bytes and refuses 4097; internal failures return only
`SERVER_ERROR`; case aliases share account throttling; spoofed forwarding headers
cannot evade the connection IP limit. These are coverage additions, not findings.

No finding is marked fixed without a failing regression followed by a passing
run. Each entry records SEC-ID, priority, file/line, expected/actual behavior,
demo reproduction, risk, minimal fix, regression result and status.

The expanded batch adds three findings below. A successful role, URL, quota or
recovery check is coverage evidence and is not recorded as a vulnerability.

### SEC-001 — P2 — legacy personnel history interprets dates as markup

- **Location:** `js/personnel.js:420-427` (`renderLog`); the baseline rendered
  `fmtDateBg(m.date)` directly in all five history templates.
- **Expected / actual:** dates must appear as text. A legacy date containing a
  harmless bold marker instead created DOM elements in the history panel.
- **Demo reproduction:** accept an otherwise empty schema-3 personnel document
  whose `moveLog` contains migration, settings, create, update and untyped legacy
  records with the date `<b data-demo>Fictional date</b>`. Open the personnel panel
  in an isolated browser. Before the fix, five `[data-demo]` elements appeared.
- **Risk:** stored HTML injection from an imported/selected personnel file or an
  authorized personnel write. The offline page has no server CSP; unescaped
  markup creates an XSS risk there. Server CSP blocks inline script but does not
  prevent markup insertion. The regression uses only an inert element marker
  and does not claim that script execution or data exfiltration was tested.
- **Minimal solution:** escape the formatted date once per row before HTML
  interpolation. Preserve legacy history, normal date formatting and raw data.
- **Regression:** `tests/security-personnel.test.cjs` reproduced five failing
  cases before the fix; **6/6 passed** after it. The server Chrome regression
  failed with expected 0 / actual 5 inserted elements before the fix. Both server
  and offline `--headless --security-only` browser suites passed afterward;
  browser assertions also verified unchanged personnel data.
- **Independent check:** the coordinator reran the regression against the
  original renderer: five cases failed and the normal-date case passed. After
  applying the escaping fix, all six cases passed.
- **Status:** fixed and independently verified.

### SEC-INPUT-01 — P2 — empty JPEG tables accepted as task evidence

- **Location:** `server/task-photos.cjs:30-58`; the original parser set table
  presence flags for DQT/DHT markers without validating their bodies.
- **Expected / actual:** an image with empty required tables must be refused.
  A generated 33-byte JPEG with empty DQT and DHT segments was accepted as a
  one-pixel task photograph even though its required tables were absent.
- **Demo reproduction:** the generated `emptyTables` fixture in
  `tests/server/security-input-boundaries.test.cjs`; no external image, script
  or production photograph is used.
- **Risk:** invalid evidence can satisfy a task's photograph requirement.
  This does not claim arbitrary code execution through an image decoder.
- **Minimal solution:** validate DQT precision/table identifiers and table
  lengths; validate DHT class/table identifiers, symbol counts, segment lengths
  and oversubscribed Huffman trees before accepting the photograph.
- **Regression:** five JPEG rejection/transaction regressions failed against
  the original source. The corrected parser refuses those inputs and a failed
  multi-photo operation preserves existing photos, tasks, history, audit and
  idempotency receipts. Valid demo photographs and exact byte/storage quotas
  remain covered. The coordinator independently reproduced the five failures.
- **Status:** fixed; final combined verification recorded below. The parser
  performs structural checks, not full JPEG entropy decoding or antivirus.

### SEC-INPUT-02 — P3 — excessive JSON nesting reaches recursive signatures

- **Location:** `server/store.cjs:27-44` and `reportOperation`; originally its
  recursive `canonical` function processed input without a nesting bound.
- **Expected / actual:** excessive nesting should return a sanitized client
  error before persistence. A generated optional report field containing 4000
  object levels, about 36 KB, produced an uncaught `RangeError` and HTTP 500;
  replacement/import paths also accepted excessive nesting. No partial report
  write was observed in the failing operation case.
- **Risk:** avoidable server errors and deeply nested stored/imported data.
  This is an input-robustness finding; no service-wide denial of service is
  claimed or tested.
- **Minimal solution:** an iterative depth check before document validation,
  canonical signatures and persistence. Reject object/array depth above 64
  (root depth zero) with `INVALID_DATA` or `INVALID_OPERATION` and HTTP 400.
- **Regression:** operation, replacement, import and exact depth-boundary cases
  failed against the original source. They now verify refusal without document,
  revision, audit, receipt or staging mutations. Ordinary optional metadata and
  key-order-independent operation replay remain valid. The coordinator
  independently reproduced all four failures.
- **Status:** fixed; final combined verification recorded below.

### SEC-CLIENT-001 — P2 — instruction text escaping reused in HTML attributes

- **Location:** `js/package-instructions.js:339-343`; consumers include
  category `data-number`, image caption/alt, file download and bulk values.
- **Expected / actual:** valid instruction metadata must remain literal text
  in attributes. The original `div.textContent`/`div.innerHTML` helper escaped
  markup characters but preserved attribute-delimiting quotes. A fictional
  profile number containing a quote and `data-client-demo="inert"` created that
  extra DOM attribute and truncated the intended `data-number` value.
- **Risk:** stored attribute injection and altered metadata/download names.
  Offline mode has no server CSP. The regression uses an inert attribute and
  does not execute scripts, request an external destination or demonstrate
  exfiltration.
- **Minimal solution:** escape ampersands, angle brackets and both quote types
  in the shared helper. Preserve displayed text and raw fictional documents.
- **Regression:** real Chrome failed the attribute assertion before the fix
  in offline and server runs; the coordinator independently reproduced the
  server failure. The new client suites verify literal report/instruction/task
  data, attributes, local blob downloads, language changes and unchanged data.
- **Status:** fixed; final combined verification recorded below.

## Initial batch validation — 2026-10-12

The coordinator ran these commands in the final isolated branch with Node 24:

- `node --test tests/*.test.cjs tests/server/*.test.cjs`: **553/553 passed**;
  zero failures, skips or cancellations.
- `node scripts/run-browser-tests.cjs --headless --security-only`: **PASS**
  for offline personnel history, with unchanged fictional file data.
- `node scripts/run-server-browser-tests.cjs --headless --security-only`:
  **PASS** for server personnel history, with unchanged fictional database data.
- `node scripts/check-publication.cjs --staged`: **PASS**, 237 reviewed files.
- `git diff --cached --check`: **PASS**.

Initial reviewed commits: `5c3e9da` (baseline and document publication controls)
and `d617ce1` (nine HTTP security regressions). The final escaping fix, browser
coverage and research notes are committed separately on the final branch.

## External tool decision

The review uses [OWASP WSTG](https://owasp.github.io/www-project-web-security-testing-guide/stable/4-Web_Application_Security_Testing/README)
and [ASVS](https://owasp.org/projects/asvs) to organize coverage. It does not
claim complete conformance to either standard.

- **Semgrep:** future local use requires reviewed local rules, `--metrics off`,
  `--disable-version-check`, no login/platform-connected CI and no `--trace`.
  Registry rules and connected CI can enable outbound metadata collection.
  See [metrics](https://docs.semgrep.dev/metrics) and
  [CLI reference](https://docs.semgrep.dev/cli-reference).
- **ZAP:** the [baseline](https://www.zaproxy.org/docs/docker/baseline-scan/)
  crawls the target and performs passive checks. Its
  [Call Home documentation](https://www.zaproxy.org/faq/what-calls-home-does-zap-make/)
  describes update, news and telemetry traffic. Future use requires `-silent`,
  vetted pinned add-ons and enforced egress restrictions; third-party add-ons
  may ignore silent mode.
- **Strix:** its [repository](https://github.com/usestrix/strix) requires Docker;
  [LLM configuration](https://docs.strix.ai/llm-providers/overview) supports both
  external providers and local models. No external model receives repository or
  runtime context. A local-only installation would require separate validation.

None of these external scanners was installed or run in this batch. Local Node
and browser regressions use generated fictional data and blocked external browser
requests. This tooling decision does not claim verified zero egress for a scanner
that was not executed.

## Limitations

This review does not certify production deployment, TLS proxy configuration,
host operating-system permissions or real browser push providers. Demo tests
and source review cannot establish that every possible vulnerability is absent.
The separate dynamic research chat was stopped by the platform cybersecurity
review; this batch does not claim that its external scanner or pentest ran.
The implementation chat later hit its account usage limit. Both auxiliary chats
were archived at the user's request; their technical work remains preserved.
The batch is not merged into `main`; its Trello card remains unfinished until
the authorized merge and push finish. The archived chats are separate from the
three agents used for the expanded local verification below.

## Expanded verification plan

Goal: exercise the security controls applicable to this offline/server
application and document exact evidence, findings and untested deployment
assumptions. The scope is the reviewed demo source at `8dbf02a`, generated
fictional accounts/documents and local temporary runtime artifacts.

Architecture: three independent agents use separate branches for account/access,
API/file boundaries and browser behavior. The coordinator owns runtime/storage
checks, integration, publication and the shared report. No rejected action is
retried through a different agent or hidden by changing its description.

| Work package | Owned code and new tests | Required evidence |
| --- | --- | --- |
| Accounts and access | `server/accounts.cjs`, permissions/module access; `tests/server/security-authz-matrix.test.cjs` | login/cookie/session lifecycle, stale access, role/owner matrices, exact Origin/CSRF, bounded throttling |
| API and files | imports/store/photo/push modules; `tests/server/security-input-boundaries.test.cjs`, push checks | type/path/MIME/size limits, rollback/revisions, parameterized queries, mocked push URL/redirect boundaries |
| Browser | JS renderers, links, worker/client state; `tests/browser/security-client.cjs`, client unit checks | inert markup as text, intended local navigation, logout/revocation/cache behavior, both offline/server modes, external requests blocked |
| Runtime and storage | configuration/static delivery, maintenance/backup/restore; `tests/server/security-runtime.test.cjs` | origin/TLS rules, security headers and asset allowlist, private file/directory modes, symlink/hardlink refusal, archive/session recovery and safe host errors |

For every work package:

- [x] Map controls to existing tests; add only meaningful uncovered cases.
- [x] Run bounded local tests and separate passing controls from confirmed defects.
- [x] For each defect, record a harmless reproduction and failing regression,
  apply a minimal fix, then rerun the regression and relevant suites.
- [x] Review source/diff and privacy rules before verified branch commits.
- [x] Independently review and integrate each package; run the complete Node
  suite and relevant browser workflows on the combined branch.
- [x] Update the coverage matrix/findings and validate the publication snapshot
  with active hooks. Leave merge/Done pending the user's explicit merge request.

Review focus: access changes during asynchronous requests; failed writes leaving
partial records; nested/legacy values reaching HTML or navigation; encoded file
paths and misleading MIME; stale or malformed local recovery/status artifacts.

Limitations: finite tests cannot enumerate every possible input or prove absence
of all vulnerabilities. Production TLS/proxy/OS/network configuration and live
records are outside this local demo run. External tools are not claimed executed
unless a specific reviewed local run is recorded.

## Expanded coverage matrix — 2026-10-13

The expanded baseline is `8dbf02a`. New meaningful coverage comprises 12 account
tests, 17 input tests, 6 mocked-push tests, 5 client tests and 8 runtime tests,
plus two focused real-Chrome workflows. Existing suites are rerun on the combined
branch; test counts include normal behavior and compatibility checks as well as
security assertions.

| Control | Evidence in the reviewed demo | Boundary of the claim |
| --- | --- | --- |
| Identity and login limits | `api`, `security-http`, `session-lifecycle` | malformed bodies, generic credentials errors, case/account/socket-IP limits; bounded attempts |
| Account/role/ID authorization | `permissions`, `module-permissions`, `security-authz-matrix` | all roles/overrides, forged URL/body/query IDs, viewing versus management, unchanged denied state |
| Session lifecycle | `accounts-delete`, `session-lifecycle`, new auth matrix | disable/delete/password/permissions revoke old sessions; re-enable does not revive a token; hashed storage |
| Async revocation | `security-authz-matrix`, `maintenance`, existing import/API races | current identity checked after partial bodies, password hashing and pending host/import work |
| CSRF and exact Origin | `api`, `security-http`, module API suites | missing/null/foreign/prefix Origin, absent/wrong/cross-session CSRF, valid same-origin flow |
| Ownership and IDOR | tasks, photos, notifications/import suites plus new auth matrix | unrelated task supervisor, inbox/device owner and administrator staging boundaries |
| HTML text and attribute rendering | `security-personnel`, `security-client`, both focused browser modes | inert stored markers, literal attributes/download metadata, BG/EN text and unchanged source data |
| Navigation and worker content | new client unit/browser tests, notification target suites | local module URLs, encoded targets, generic lock-screen copy, payload destinations ignored; no fetch/cache worker |
| Upload image structure and quotas | `task-photos`, `security-input-boundaries` | invalid DQT/DHT, table precision/class/counts, byte/quota boundaries and atomic multi-photo failure; not full image decoding |
| Import/resource boundaries | imports/import-lifecycle plus input/HTTP boundary tests | 5000 files and 1 GiB declared metadata exact limits without allocating those contents; request/body/path/revision limits |
| JSON/schema/prototype validation | data-validation, store/import suites, new input tests | malformed objects, dangerous keys, depth 64/65 and ordinary optional metadata compatibility |
| SQL and attachment confinement | activity/store/import suites, `security-http`, new input tests | prepared queries, SQL-like values treated literally, traversal/NUL/backslash/encoded paths, generic refusals |
| Binary delivery and errors | `api`, new input/HTTP/runtime tests | unchanged bytes, attachment disposition, nosniff, no-store, stale/malformed revision refusal, sanitized 400/413/500 errors |
| Transactions and replay | report-operations, imports/tasks/photos, new input tests | failed operations preserve records/revisions/audit/receipts/staging; repeated operation signatures ignore key order |
| Web Push/SSRF boundary | notifications and `security-push-boundaries` | provider host policy, scheme/credentials/port/fragment tricks, key validation, verified generated VAPID signature, empty body, abort and redirect policy; transport mocked |
| Browser access/cache/storage | new server client workflow, existing deletion/module flows | current permission UI plus valid denied server write, sibling-tab logout, back navigation and revocation, no protected fixtures in browser storage/cache |
| Runtime origin and headers | `api`, `security-runtime`, static/routes suites | canonical HTTPS origin and explicit loopback HTTP, Secure host cookie configuration, CSP/HSTS/nosniff/referrer/cache rules and static allowlist; no actual public TLS handshake |
| Local database/archive protection | backups/restore/maintenance plus `security-runtime` | private creation modes, backup/restore linked-file refusals, non-overwrite publication, validated archives, pending/failed recovery blocked |
| Recovery identity and status | restore/maintenance/backups plus new runtime tests | sessions/devices/queued push revoked in copy, inbox/preferences preserved, source intact, contradictory summaries never invent success or echo unknown fields |
| Publication and source isolation | `check-publication`, publication regressions and active Git hooks | approved source/assets/demo seeds, private-token/binary/path/symlink checks; no production upload or attachment |

No separate finding is raised for the configured database path: server startup
uses a trusted local path and no API accepts a replacement filename. A local
writer able to replace that configured path is outside this application's HTTP
authorization boundary; deployment directory ownership remains a prerequisite.
Offline mode likewise relies on the user's local filesystem access and is not a
server authentication boundary.

Report history intentionally refreshes on a manual action, as required by its
existing browser regression. That screen does not receive live API/SSE/visibility
refreshes; subsequent protected actions still require a current server session.
This is recorded as behavior/limitation rather than silently changing the feature.

The container files were reviewed for loopback port publishing, an unprivileged
user, read-only root filesystem, dropped capabilities and private database
directory. Docker is unavailable here, so no container, host/network isolation,
OS patching, TLS proxy, deployment or live-provider test is counted as executed.
The runtime uses Node built-ins rather than an application package dependency
tree. External Semgrep/ZAP/Strix execution remains outside the completed evidence.

## Expanded coordination and review

Three agents initially used separate branches for accounts, inputs and browser
work. The user subsequently requested at most one additional agent when needed.
All auxiliary turns finished or stopped at the account usage limit; the
coordinator continued from their preserved source changes on this chat's branch.
No further agents were started, and no refused scanner operation was retried.

The read-only reviewer independently ran the initial 20 auth/runtime tests and
inspected preliminary fixes. Its useful test feedback was incorporated:
revocation is triggered through the real account HTTP route instead of relying
on the SSE heartbeat, and race tests now have timeouts, request aborts and cleanup.
The reviewer's turn then reached the usage limit before final review. The
coordinator reviewed and tested the final diffs independently; the report does
not claim a completed external or second-agent audit of the whole final batch.

The coordinator independently reproduced nine original input failures and the
instruction attribute failure in real Chrome, then applied the minimal fixes.
The final denied-write browser fixture uses a valid report operation so the
assertion reaches authorization rather than failing earlier for a missing
revision or invalid body. Focused offline/server client flows and the 28 new
input/push/client tests pass with fictional fixtures only.

## Expanded final validation

Code snapshot: `2f7dff1` on `feature/security-validation-20261012`; the following
documentation commit changes only this report. The coordinator ran Node 24 and
real local Chrome against the combined source with no production fixtures:

- `node scripts/run-critical-tests.cjs --browser`: **30 suite runs passed,
  zero failed**, exit 0. This includes **601/601 Node tests** (285 client/source
  and 316 server; zero failures, skips or cancellations) and **28 browser suite
  runs** (8 offline and 20 server). The aggregate includes both new client
  security modes and the earlier personnel security modes.
- Independent focused `--headless --security-client-only` offline and server
  Chrome runs: **PASS**; application requests restricted to the loopback origin.
- Independent input/push/client target: **28/28 PASS**; independent integrated
  auth/runtime target: **20/20 PASS**.
- `node scripts/check-publication.cjs --staged`: **PASS**, 243 reviewed files,
  with the local private-reference check enabled. Git hooks remain `.githooks`.
- `git diff --check` and `git diff --cached --check`: **PASS**.

Verified expanded source commits:

- `5c5cb62`: runtime/recovery regressions.
- `b3e3d23`: account/ownership authorization matrix.
- `6ba3d3a`: JPEG table validation, JSON depth bound and input/push regressions.
- `0573254`: instruction attribute escaping and client/browser regressions.
- `2f7dff1`: bounded authorization race waits and connection cleanup.

The user explicitly authorized the batch merge on 2026-10-13. Integration is
prepared and verified on this chat's dedicated feature branch. Its Trello card
must remain unfinished until merge and push to `main` succeed. Production
deployment and real data remain local.

## Authorized merge validation

The final source combines the security branch at `1ee737c` with main at
`802fd98`, preserving both sets of focused runner modes. Conflicts were limited
to the three browser and aggregate test runners; all security, responsive and
reconnect modes remain.

- `node scripts/run-critical-tests.cjs --browser`: **32 suite runs passed,
  zero failed**, exit 0: **616/616 Node tests** (285 client/source and 331 server;
  zero failures, skips or cancellations) and **30 browser suite runs** (9 offline
  and 21 server).
- Publication check with the local private-reference check: **PASS**, 246
  reviewed files. Active hooks: `.githooks`.
- Runner syntax checks, resolved index and staged diff whitespace: **PASS**.

The latest main change increases the reconnect reveal delay from 150 ms to
2300 ms with matching unit regressions. It was integrated without conflicts;
the entire Node/browser aggregate above was rerun afterward and passed on the
final combined source. The subsequent documentation update changes only this
report. Final main push confirmation and the commit link are recorded on the
Trello card after publication succeeds.
