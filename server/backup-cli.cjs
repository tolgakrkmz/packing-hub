const {runBackup, readStatus} = require('./backups.cjs');
process.umask(0o077);
try {
  const [command] = process.argv.slice(2);
  const primary = process.env.HUB_BACKUP_PRIMARY;
  if (command === 'run') {
    const status = runBackup({database: process.env.HUB_DATABASE, primary, secondary: process.env.HUB_BACKUP_SECONDARY, mode: process.env.HUB_BACKUP_MODE || 'dual'});
    const success = status.mode === 'single' ? 'Local backup verified. No independent second copy.' : 'Both local backup copies verified.';
    console.log(status.state === 'ok' ? success : 'Backup failed (' + status.code + ').');
    if (status.state !== 'ok') process.exitCode = 1;
  } else if (command === 'status') {
    console.log(JSON.stringify(readStatus(primary)));
  } else throw new Error();
} catch {
  console.error('Backup maintenance failed. Check the private configuration and local storage.');
  process.exitCode = 1;
}
