/* Reads a .pptx (zip) into {name: text} for assertions; test helper only. */
const zlib = require('node:zlib');
function unzipText(buffer) {
  let end = buffer.length - 22;
  while (end >= 0 && buffer.readUInt32LE(end) !== 0x06054b50) end--;
  const files = {};
  for (let i = 0, at = buffer.readUInt32LE(end + 16); i < buffer.readUInt16LE(end + 10); i++) {
    const nameLength = buffer.readUInt16LE(at + 28), local = buffer.readUInt32LE(at + 42), name = buffer.toString('utf8', at + 46, at + 46 + nameLength);
    const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28), data = buffer.subarray(start, start + buffer.readUInt32LE(at + 20));
    files[name] = (buffer.readUInt16LE(at + 10) === 8 ? zlib.inflateRawSync(data) : data).toString('utf8');
    at += 46 + nameLength + buffer.readUInt16LE(at + 30) + buffer.readUInt16LE(at + 32);
  }
  return files;
}
// Visible slide text in reading order, runs joined per paragraph.
const slideText = xml => [...xml.matchAll(/<a:p>(.*?)<\/a:p>/gs)].map(([, p]) => [...p.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map(m => m[1]).join('')).filter(Boolean);
module.exports = {unzipText, slideText};
