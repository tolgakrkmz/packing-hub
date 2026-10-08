const {restoreArchive, rehearse} = require('./restore.cjs');
process.umask(0o077);
async function main() {
  const [command, archive, directory] = process.argv.slice(2);
  if (!['restore', 'drill'].includes(command) || !archive || !directory || process.argv.length !== 5) throw new Error();
  const restored = restoreArchive(archive, directory);
  if (command === 'drill') {
    const checked = await rehearse(directory);
    console.log(JSON.stringify({ok: checked.ok, restoreMs: restored.restoreMs, startupMs: checked.startupMs, sessionsRevoked: true}));
  } else console.log('Recovery copy verified. Old sessions revoked. Complete local acceptance checks before switching service.');
}
main().catch(() => { console.error('Recovery failed. Check the archive, image compatibility and empty private destination locally.'); process.exitCode = 1; });
