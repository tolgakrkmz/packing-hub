/* Reads the fields of a packing label photo on the server: zbar for the QR code, Tesseract for the printed text. */
const {execFile} = require('node:child_process');
const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path');
const FIELDS = ['palletNo', 'productionOrder', 'customer', 'grossWt', 'netWt', 'length', 'pieces'];
// A missing program or a failed read leaves the fields empty; the lead then types the pallet.
const run = (command, args) => new Promise(resolve => execFile(command, args, {timeout: 20000, maxBuffer: 1024 * 1024, encoding: 'utf8'}, (error, stdout) => resolve(error ? '' : stdout)));
const clean = value => (value || '').replace(/\s+/g, ' ').trim().slice(0, 120);
// OCR mixes up letters and digits inside numbers; only number-shaped values are repaired.
const digits = value => value.replace(/[Oo]/g, '0').replace(/[Il|]/g, '1').replace(/S/g, '5').replace(/B/g, '8');
function parse(text, qr = '') {
  const lines = String(text).split(/\r?\n/).map(line => line.trim()).filter(Boolean), all = lines.join('\n'), result = Object.fromEntries(FIELDS.map(key => [key, '']));
  const pallet = (qr.match(/\bPA[0-9]{6,}\b/) || all.match(/\bP\s?A\s?([0-9OoIlSB]{6,})\b/));
  if (pallet) result.palletNo = pallet[0].startsWith('PA') && /^PA[0-9]+$/.test(pallet[0]) ? pallet[0] : 'PA' + digits(pallet[1]);
  const order = all.match(/\bD\s?P\s?([0-9OoIlSB]{5,}(?:[_\s-][0-9OoIlSB]+)?)/);
  if (order) result.productionOrder = 'DP' + digits(order[1].replace(/[\s-]/, '_'));
  // Customer: the first line after the "Customer" heading, cut before the delivery address column.
  const at = lines.findIndex(line => /customer\s*:/i.test(line));
  if (at >= 0) {
    const same = lines[at].replace(/.*customer\s*:/i, '').replace(/delivery.*$/i, '').trim();
    result.customer = clean(same || (lines[at + 1] || '').split(/\s{2,}|\s(?=Aleja|ul\.|Str|Delivery)/i)[0]);
  }
  // Weights follow the packing date; length and pieces follow the 8-digit cast number.
  const weights = all.match(/\d{4}-\d{2}-\d{2}\s+([0-9.,]+)\s+([0-9.,]+)/);
  if (weights) [result.grossWt, result.netWt] = [weights[1], weights[2]];
  const cast = all.match(/\b\d{8}\s+([0-9.,]+)\s+([0-9.,]+)/);
  if (cast) [result.length, result.pieces] = [cast[1], cast[2]];
  return result;
}
// The photo goes to a private temporary file (the container's /tmp is in memory) and is removed right after reading.
async function read(jpeg) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'label-')), file = path.join(dir, 'label.jpg');
  try {
    await fs.writeFile(file, jpeg, {mode: 0o600});
    const [qr, text] = await Promise.all([run('zbarimg', ['--raw', '-q', file]), run('tesseract', [file, 'stdout', '-l', 'eng'])]);
    return parse(text, qr);
  } finally { await fs.rm(dir, {recursive: true, force: true}); }
}
module.exports = {read, parse, FIELDS};
