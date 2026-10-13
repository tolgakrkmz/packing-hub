/* Run locally in the reviewed demo repository. Emit aggregate metrics only. */
const path = require('node:path');
const cp = require('node:child_process');
const root = path.resolve(__dirname, '..');
const original = cp.execFileSync;
let blobProcesses = 0;
cp.execFileSync = (command, args, options) => {
  if(command === 'git' && args[0] === 'cat-file' && (args[1] === 'blob' || args[1].startsWith('--batch'))) blobProcesses++;
  return original(command, args, options);
};
const {privateTokens, commitsForPush, checkSnapshots, checkSnapshot} = require('./check-publication.cjs');
try {
  const ref = process.argv[2] || 'HEAD';
  if(process.argv.length > 3 || !/^(HEAD|[0-9a-f]{40,64})$/.test(ref)) throw new Error();
  const head = original('git', ['rev-parse', '--verify', ref + '^{commit}'], {cwd: root, stdio: ['pipe', 'pipe', 'pipe']}).toString().trim();
  const tokens = privateTokens(process.env.PACKAGE_HUB_PRIVATE_SOURCE || path.resolve(root, '../..'));
  const start = performance.now();
  const commits = commitsForPush('refs/heads/benchmark ' + head + ' refs/heads/benchmark ' + '0'.repeat(head.length) + '\n', root);
  const counts = checkSnapshots ? checkSnapshots(commits, tokens, root) : commits.map(commit => checkSnapshot(commit, tokens, root));
  console.log(JSON.stringify({result: 'passed', commits: commits.length, entries: counts.reduce((sum, count) => sum + count, 0), blobProcesses, elapsedMs: Math.round(performance.now() - start), maxRssKiB: process.resourceUsage().maxRSS}));
} catch {
  console.error('Publication benchmark blocked; no object content was logged.');
  process.exitCode = 1;
}
