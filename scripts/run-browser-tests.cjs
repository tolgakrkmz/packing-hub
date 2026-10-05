/* Serve reviewed demo assets only; never run against production files or a personal browser profile. */
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const {execFileSync} = require('node:child_process');
const {inspect, privateTokens} = require('./check-publication.cjs');
const root = path.resolve(__dirname, '..');

async function main() {
  const {chromium} = require('playwright');
  const {run} = require('../tests/browser/workflows.cjs');
  const tokens = privateTokens(process.env.PACKAGE_HUB_PRIVATE_SOURCE || path.resolve(root, '../..'));
  // In-memory, exact-path allowlist: neither URL traversal nor new files can expose local data.
  const assets = new Map();
  const files = execFileSync('git', ['ls-files', '-z'], {cwd: root}).toString().split('\0');
  for (const file of files) {
    if (!/^[a-z-]+\.html$|^(?:js|css)\/[a-z0-9/-]+\.(?:js|css)$/.test(file)) continue;
    if (!fs.lstatSync(path.join(root, file)).isFile()) throw new Error('Only regular demo source files may be served: ' + file);
    const content = fs.readFileSync(path.join(root, file));
    inspect(file, content, tokens);
    assets.set('/' + file, content);
  }
  // The pinned fictional seed fingerprint also prevents accidentally serving the production checkout.
  inspect('js/employees-seed.js', fs.readFileSync(path.join(root, 'js/employees-seed.js')), tokens);
  const server = http.createServer((request, response) => {
    const name = request.url === '/' ? '/index.html' : request.url;
    const body = assets.get(name);
    response.writeHead(body ? 200 : 404, {
      'Content-Type': name.endsWith('.js') ? 'text/javascript; charset=utf-8' : name.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/html; charset=utf-8',
      'Cache-Control': 'no-store'
    });
    response.end(body || 'Not found');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    const headed = !process.argv.includes('--headless');
    browser = await chromium.launch({channel: 'chrome', headless: !headed, slowMo: headed ? 350 : 0});
    await run(browser, `http://127.0.0.1:${server.address().port}`, {headed});
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
