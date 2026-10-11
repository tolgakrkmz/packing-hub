// Child process used only with a fresh fictional database in restart.test.cjs.
const {createHubServer} = require('../../server/server.cjs');
async function main() {
  const filename = process.argv[2];
  if (process.argv[3] === 'uncommitted') {
    const {DatabaseSync} = require('node:sqlite');
    const db = new DatabaseSync(filename);
    db.exec('BEGIN IMMEDIATE');
    db.prepare('UPDATE documents SET data=?,revision=revision+1 WHERE kind=?').run(
      JSON.stringify({entries: [], goalTons: 1}), 'production-log');
    process.send({ready: true});
    setInterval(() => {}, 1000);
    return;
  }
  const hub = createHubServer({filename, publicOrigin: 'http://127.0.0.1:0', allowHttp: true});
  if (!hub.auth.list().length) {
    const password = 'Fictional-restart-password-123';
    await hub.auth.create('demo-restart-admin', password, 'admin');
    await hub.auth.create('demo-restart-observer', password, 'observer');
  }
  hub.server.listen(0, '127.0.0.1', () => process.send({port: hub.server.address().port}));
  process.once('SIGTERM', () => hub.close().then(() => process.exit(0)));
}
if (require.main === module) main().catch(error => { console.error(error.stack); process.exit(1); });
