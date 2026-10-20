const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
test('every module stylesheet is linked, so styles have one source', () => {
  // Server mode injects its shell styles into each page.
  const pages = fs.readdirSync(root).filter(name => name.endsWith('.html')).map(read).join('\n') + read('server/server.cjs');
  for (const name of fs.readdirSync(path.join(root, 'css'))) assert.match(pages, new RegExp('href="/?css/' + name.replace('.', '\\.') + '"'), name);
});
test('package instructions load their module stylesheet, including the empty state', () => {
  const page = read('package-instructions.html');
  assert.doesNotMatch(page, /<style/);
  assert.match(page, /<link rel="stylesheet" href="css\/package-instructions\.css">/);
  assert.match(read('css/package-instructions.css'), /\.instruction-empty-actions\{/);
});
