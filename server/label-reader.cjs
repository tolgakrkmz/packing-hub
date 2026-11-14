/* Reads the fields of a packing label photo on the server: zbar for the QR code, Tesseract for the printed text. */
const {execFile} = require('node:child_process');
const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path');
const {problem} = require('./store.cjs');
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
    result.customer = clean(/\p{L}{2}/u.test(same) ? same : (lines[at + 1] || '').split(/\s{2,}|\s(?=Aleja|ul\.|Str|Delivery)/i)[0]);
  }
  // Weights follow the packing date; length and pieces follow the 8-digit cast number.
  // The small right-hand column often reads only in part, so each number is taken on its own and a missing one stays empty.
  const weights = all.match(/\d{4}[-.]\d{2}[-.]\d{2}[ \t]+(\d{1,5})(?:[ \t]+(\d{1,5})\b)?/);
  if (weights) [result.grossWt, result.netWt] = [weights[1], weights[2] || ''];
  const cast = all.match(/\b\d{8}[ \t]+(\d{3,5})(?:[ \t]+(\d{1,5})\b)?/);
  if (cast) [result.length, result.pieces] = [cast[1], cast[2] || ''];
  return result;
}
// The photo goes to a private temporary file (the container's /tmp is in memory) and is removed right after reading.
async function readNow(jpeg) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'label-')), file = path.join(dir, 'label.jpg');
  try {
    await fs.writeFile(file, jpeg, {mode: 0o600});
    const [qr, text] = await Promise.all([run('zbarimg', ['--raw', '-q', file]), run('tesseract', [file, 'stdout', '-l', 'eng'])]);
    return parse(text, qr);
  } finally { await fs.rm(dir, {recursive: true, force: true}); }
}
// OCR is CPU-heavy: photos are read one at a time and a long queue is refused instead of overloading the server.
function oneAtATime(work, max = 4) {
  let queue = Promise.resolve(), waiting = 0;
  return async input => {
    if (waiting >= max) throw problem(503, 'LABEL_READ_BUSY');
    waiting++;
    const turn = queue.then(() => work(input));
    queue = turn.catch(() => {});
    try { return await turn; } finally { waiting--; }
  };
}
const read = oneAtATime(readNow);
module.exports = {read, parse, oneAtATime, FIELDS};
