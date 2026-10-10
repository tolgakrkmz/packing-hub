/* Generate a local VAPID configuration; never print or commit the private key. */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
function configure(file) {
  if (typeof file !== 'string' || !/^\.env(?:\.[a-z0-9-]+)?$/.test(path.basename(file))) throw new Error('Use an ignored .env filename.');
  const {privateKey} = crypto.generateKeyPairSync('ec', {namedCurve: 'prime256v1'});
  const value = JSON.stringify(privateKey.export({format: 'jwk'}));
  const content = "HUB_PUSH_PRIVATE_JWK='" + value + "'\nHUB_PUSH_SUBJECT=https://github.com/tolgakrkmz/packing-hub\n";
  fs.writeFileSync(file, content, {flag: 'wx', mode: 0o600});
}
if (require.main === module) {
  try { configure(process.argv[2] || '.env.push'); console.log('Local push configuration created. Keep the file private and retain it across deployments.'); }
  catch { console.error('Push configuration was not created. Choose a new ignored .env filename in a writable local directory.'); process.exitCode = 1; }
}
module.exports = {configure};
