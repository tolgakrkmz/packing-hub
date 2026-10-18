<div align="center">
  <img src="assets/package-hub-mark.svg" width="88" height="88" alt="Package Hub logo">
  <h1>Package Hub</h1>
  <p><strong>Plan shifts. Track output. Keep teams in sync.</strong></p>
  <p>A lightweight production dashboard for shift teams, reports and packing workflows.</p>
  <p>
    <img src="assets/readme-badges.svg" width="470" height="28" alt="Vanilla JavaScript · Node.js 24+ · SQLite · BG / EN">
    <br>
    <a href="https://github.com/tolgakrkmz/packing-hub/actions/workflows/ci.yml"><img src="https://github.com/tolgakrkmz/packing-hub/actions/workflows/ci.yml/badge.svg?branch=main" alt="CI status"></a>
  </p>
  <p>
    <a href="GUIDE.md">📖 Documentation</a> ·
    <a href="BACKUP-RECOVERY-SCENARIOS.md">💾 Backup &amp; recovery</a> ·
    <a href="PUBLICATION-NOTES.md">🛡️ Demo data policy</a>
  </p>
</div>

> **Portfolio demo** — all people, reports and packing instructions are fictional.

## ✨ What it does

- 📊 **Production & statistics** — output, scrap, monthly results and team comparisons.
- ⏱️ **Downtime** — causes, durations and line breakdowns.
- 👥 **Teams & targets** — rotating shifts, packer pairs, goals and actual results.
- ✅ **Shift tasks** — assignments, recurring plans, progress and approvals.
- ✅ **Global problems** — board for issues outside the team's control and the solutions proposed for them.
- 📦 **Packing instructions** — searchable profiles, folders and attachments.
- 🔔 **Shared workspace** — live updates, account permissions and optional Web Push.

Responsive dark interface, Bulgarian / English switching, and two ways to run:
**offline with local JSON files** or **shared through a Node.js + SQLite server**.

## 🚀 Quick start

Clone the repository, then run these commands from its folder with **Node.js 24+**:

```sh
# Create a local demo administrator; enter a password at the prompt.
HUB_DATABASE=/tmp/package-hub-demo.sqlite node server/manage.cjs create-admin demo-admin

# Start the local demo server.
HUB_DATABASE=/tmp/package-hub-demo.sqlite HUB_ALLOW_HTTP=true HUB_PUBLIC_ORIGIN=http://127.0.0.1:3000 node server/server.cjs
```

Open **http://127.0.0.1:3000** and sign in. A new server starts empty; use fictional
records for testing. For Docker, HTTPS and deployment, see the [server guide](GUIDE.md#casaos-and-a-provided-https-address).

**Prefer offline?** Open `index.html` in Chrome or Edge and connect the fictional
fixtures in `data/`. No installation required. File saves update the selected
local fixtures. [Offline setup →](GUIDE.md#run-locally-in-offline-mode)

## 🧪 Development

Enable the publication hooks after cloning, then run the tests:

```sh
node scripts/install-hooks.cjs
node --test tests/*.test.cjs
node --test tests/server/*.test.cjs
```

GitHub Actions runs the publication check and `node scripts/run-critical-tests.cjs`
on every push and pull request, plus the browser scenarios nightly. CI has no
private reference, so it adds to the local hooks rather than replacing them.

[Browser testing](GUIDE.md#visible-browser-tests) · [System status](SYSTEM-STATUS-SCENARIOS.md) · [Full technical guide](GUIDE.md)

## 🛡️ Publication

Commit only reviewed source and approved fictional fixtures. Company data,
employee records, documents and credentials must stay local. Review changes and
run the publication check before committing or pushing; keep the hooks enabled.

No distribution license has been selected.
