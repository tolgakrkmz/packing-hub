# Security review — demo source only

Review date: 2026-10-12. Baseline: `3020f95bdc457a1198ef8e6013bee55c90ca9143`.
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
- **Status:** fixed and independently verified; awaiting batch merge.

## Final validation

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
The batch is not merged into `main`; its Trello card remains in progress until
the authorized merge and push finish.
