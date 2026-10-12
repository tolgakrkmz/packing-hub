# Security review — demo source only

Review date: 2026-10-12. Baseline: `3020f95bdc457a1198ef8e6013bee55c90ca9143`.
Branch: `feature/security-fixes-20261012`.

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

Findings and final suite counts will be added as checks complete.

## Limitations

This review does not certify production deployment, TLS proxy configuration,
host operating-system permissions or real browser push providers. Demo tests
and source review cannot establish that every possible vulnerability is absent.
The batch is not merged into `main`; its Trello card remains in progress until
the authorized merge and push finish.
