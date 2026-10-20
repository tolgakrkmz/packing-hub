/* Fills {{token}} placeholders in a local .pptx template inside the browser: no upload, no dependency. */
const PptxTemplate = (() => {
  const TYPE = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
  const FILLED = /^ppt\/(slides\/slide|charts\/chart)\d+\.xml$/;
  const CRC = new Uint32Array(256).map((_, n) => { for (let k = 0; k < 8; k++) n = n & 1 ? 0xEDB88320 ^ (n >>> 1) : n >>> 1; return n; });
  const crc32 = bytes => { let c = -1; for (const byte of bytes) c = CRC[(c ^ byte) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
  const escapeXml = value => String(value).replace(/[&<>"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[ch]);
  const inflate = bytes => new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer().then(buffer => new Uint8Array(buffer));

  // Reads the central directory; compressed data is kept as is so untouched parts (images, layouts) are copied byte for byte.
  function readEntries(bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let end = bytes.length - 22;
    while (end >= 0 && view.getUint32(end, true) !== 0x06054b50) end--;
    if (end < 0) throw new Error('NOT_PPTX');
    const entries = [];
    for (let i = 0, at = view.getUint32(end + 16, true); i < view.getUint16(end + 10, true); i++) {
      if (view.getUint32(at, true) !== 0x02014b50) throw new Error('NOT_PPTX');
      const nameLength = view.getUint16(at + 28, true), local = view.getUint32(at + 42, true);
      const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
      entries.push({nameBytes:bytes.slice(at + 46, at + 46 + nameLength), name:new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLength)),
        method:view.getUint16(at + 10, true), time:view.getUint16(at + 12, true), date:view.getUint16(at + 14, true), crc:view.getUint32(at + 16, true),
        size:view.getUint32(at + 24, true), data:bytes.subarray(start, start + view.getUint32(at + 20, true))});
      at += 46 + nameLength + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
    }
    return entries;
  }

  function writeZip(entries) {
    const parts = [], central = [];
    let offset = 0;
    for (const entry of entries) {
      const header = (length, signature, extra) => {
        const view = new DataView(new ArrayBuffer(length));
        view.setUint32(0, signature, true);
        extra(view);
        return new Uint8Array(view.buffer);
      };
      const fields = (view, at) => {
        view.setUint16(at, 20, true); view.setUint16(at + 2, 0x800, true); view.setUint16(at + 4, entry.method, true);
        view.setUint16(at + 6, entry.time, true); view.setUint16(at + 8, entry.date, true); view.setUint32(at + 10, entry.crc, true);
        view.setUint32(at + 14, entry.data.length, true); view.setUint32(at + 18, entry.size, true); view.setUint16(at + 22, entry.nameBytes.length, true);
      };
      const local = header(30, 0x04034b50, view => fields(view, 4));
      central.push(header(46, 0x02014b50, view => { view.setUint16(4, 20, true); fields(view, 6); view.setUint32(42, offset, true); }), entry.nameBytes);
      parts.push(local, entry.nameBytes, entry.data);
      offset += local.length + entry.nameBytes.length + entry.data.length;
    }
    const size = central.reduce((total, part) => total + part.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, entries.length, true); end.setUint16(10, entries.length, true);
    end.setUint32(12, size, true); end.setUint32(16, offset, true);
    return new Blob([...parts, ...central, new Uint8Array(end.buffer)], {type:TYPE});
  }

  // Returns the filled deck and any token the values did not cover; those show "—".
  async function fill(buffer, values) {
    const entries = readEntries(new Uint8Array(buffer)), missing = new Set();
    let tokens = 0;
    for (const entry of entries) {
      if (!FILLED.test(entry.name)) continue;
      if (entry.method !== 0 && entry.method !== 8) throw new Error('NOT_PPTX');
      const xml = new TextDecoder().decode(entry.method === 8 ? await inflate(entry.data) : entry.data);
      const filled = xml.replace(/\{\{([\w.]+)\}\}/g, (_, key) => {
        tokens++;
        if (Object.hasOwn(values, key)) return escapeXml(values[key]);
        missing.add(key);
        return '—';
      });
      if (filled === xml) continue;
      const data = new TextEncoder().encode(filled);
      Object.assign(entry, {method:0, data, size:data.length, crc:crc32(data)});
    }
    if (!tokens) throw new Error('NO_TOKENS');
    return {blob:writeZip(entries), missing:[...missing]};
  }

  return {fill, readEntries, crc32};
})();
