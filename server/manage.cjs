const path = require('node:path');
const readline = require('node:readline');
const {openStore} = require('./store.cjs');
const {accounts} = require('./accounts.cjs');
async function password() {
  if (!process.stdin.isTTY) throw new Error('Use an interactive terminal.');
  process.stdout.write('Password (12–128 characters): ');
  readline.emitKeypressEvents(process.stdin); process.stdin.setRawMode(true); process.stdin.resume();
  return new Promise((resolve, reject) => {
    let value = '';
    const listener = (text, key) => {
      if (key.ctrl && key.name === 'c') { finish(); reject(new Error('Cancelled')); }
      else if (key.name === 'return') { finish(); resolve(value); }
      else if (key.name === 'backspace') value = value.slice(0, -1);
      else if (text && !key.ctrl && !key.meta && value.length < 129) value += text;
    };
    const finish = () => { process.stdin.removeListener('keypress', listener); process.stdin.setRawMode(false); process.stdin.pause(); process.stdout.write('\n'); };
    process.stdin.on('keypress', listener);
  });
}
async function main() {
  process.umask(0o077);
  const [command, value] = process.argv.slice(2);
  const store = openStore(process.env.HUB_DATABASE || '/var/lib/package-hub/hub.sqlite');
  try {
    if (command === 'create-admin') {
      const first = await password();
      process.stdout.write('Confirm ');
      if (await password() !== first) throw new Error('Password mismatch');
      await accounts(store).create(value, first, 'admin');
      console.log('Administrator created.');
    } else if (command === 'backup' && value) {
      store.db.prepare('VACUUM INTO ?').run(path.resolve(value));
      console.log('Local database backup completed.');
    } else throw new Error('Use create-admin <username> or backup <local-path>.');
  } finally { store.close(); }
}
main().catch(() => { console.error('Account/backup operation failed. Check the command, password requirements and local paths.'); process.exitCode = 1; });
