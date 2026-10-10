const fs = require('node:fs');
const path = require('node:path');
const {randomUUID} = require('node:crypto');
const {problem} = require('./store.cjs');
const MAX_BYTES = 300 * 1024, MAX_EDGE = 1280;
const MAX_PHOTOS = 10, REQUEST_BYTES = Math.ceil(MAX_BYTES / 3) * 4 * MAX_PHOTOS + 64 * 1024;
const FINAL = ['completed', 'cancelled', 'not-done', 'not-applicable'];

// Accept bounded, metadata-free JPEGs produced by the browser canvas encoder.
function jpeg(input) {
  if (!input) throw problem(400, 'TASK_PHOTO_REQUIRED');
  if (typeof input !== 'string' || input.length > Math.ceil(MAX_BYTES / 3) * 4) throw problem(413, 'TASK_PHOTO_INVALID');
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input)) throw problem(400, 'TASK_PHOTO_INVALID');
  const content = Buffer.from(input, 'base64');
  if (content.length > MAX_BYTES || content.length < 20 || content.readUInt16BE(0) !== 0xffd8) throw problem(400, 'TASK_PHOTO_INVALID');
  let offset = 2, width = 0, height = 0, scan = false, quantization = false, huffman = false;
  const invalid = () => { throw problem(400, 'TASK_PHOTO_INVALID'); };
  while (offset < content.length) {
    if (content[offset++] !== 0xff) invalid();
    while (content[offset] === 0xff) offset++;
    const marker = content[offset++];
    if (marker === 0xd9) {
      if (!scan || !width || !quantization || !huffman || offset !== content.length) invalid();
      return {content, width, height};
    }
    if (![0xe0, 0xdb, 0xc4, 0xc0, 0xc2, 0xdd, 0xda].includes(marker) || offset + 2 > content.length) invalid();
    const length = content.readUInt16BE(offset), end = offset + length;
    if (length < 2 || end > content.length) invalid();
    if (marker === 0xe0 && (length !== 16 || content.toString('ascii', offset + 2, offset + 7) !== 'JFIF\0')) invalid();
    if (marker === 0xdb) quantization = true;
    if (marker === 0xc4) huffman = true;
    if (marker === 0xc0 || marker === 0xc2) {
      if (width || length < 11 || content[offset + 2] !== 8) invalid();
      height = content.readUInt16BE(offset + 3); width = content.readUInt16BE(offset + 5);
      const components = content[offset + 7];
      if (![1, 3].includes(components) || length !== 8 + 3 * components || !width || !height || width > MAX_EDGE || height > MAX_EDGE) invalid();
    }
    offset = end;
    if (marker === 0xda) {
      if (!width || length < 8) invalid();
      const start = offset;
      // Escaped bytes and restart markers belong to the compressed scan.
      while (offset < content.length) {
        if (content[offset] !== 0xff) { offset++; continue; }
        const next = content[offset + 1];
        if (next === 0 || next >= 0xd0 && next <= 0xd7) { offset += 2; continue; }
        break;
      }
      if (offset === start) invalid();
      scan = true;
    }
  }
  invalid();
}
const photoList = (item, plural, single) => Array.isArray(item?.[plural]) ? item[plural] : item?.[single] ? [item[single]] : [];
function photoInputs(input, plural, single) {
  if (input[plural] !== undefined) {
    if (!Array.isArray(input[plural]) || input[single] != null) throw problem(400, 'TASK_PHOTO_INVALID');
    if (input[plural].length > MAX_PHOTOS) throw problem(400, 'TASK_PHOTO_LIMIT');
    return input[plural];
  }
  return input[single] != null ? [input[single]] : [];
}
function references(item) {
  return [...photoList(item, 'problemPhotos', 'problemPhoto'), ...photoList(item.report, 'photos', 'photo'),
    ...(item.events || []).flatMap(event => [...photoList(event, 'photos', 'photo'), ...photoList(event.snapshot, 'problemPhotos', 'problemPhoto')])];
}
function afterMonths(at, months) {
  const date = new Date(at), day = date.getUTCDate();
  date.setUTCDate(1); date.setUTCMonth(date.getUTCMonth() + months);
  const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, last)); return date.getTime();
}
function createTaskPhotos(store, {retentionMonths = 6, limitBytes = 512 * 1024 * 1024, freeBytes} = {}) {
  if (!Number.isInteger(retentionMonths) || retentionMonths < 1 || retentionMonths > 24 || !Number.isSafeInteger(limitBytes) || limitBytes < MAX_BYTES || limitBytes > 4096 * 1024 * 1024) throw new Error('Invalid task photo storage configuration.');
  const {db} = store, filename = db.prepare('PRAGMA database_list').all().find(row => row.name === 'main').file;
  db.exec('CREATE TABLE IF NOT EXISTS task_photos(id TEXT PRIMARY KEY, content BLOB NOT NULL, created_at INTEGER NOT NULL);');
  const usedBytes = () => db.prepare('SELECT COALESCE(SUM(length(content)),0) AS bytes FROM task_photos').get().bytes;
  function add(input, at) {
    const value = jpeg(input);
    if (usedBytes() + value.content.length > limitBytes) throw problem(507, 'TASK_PHOTO_STORAGE');
    const available = freeBytes ? freeBytes() : filename ? (() => { const stat = fs.statfsSync(path.dirname(filename)); return stat.bavail * stat.bsize; })() : Infinity;
    if (available < 128 * 1024 * 1024 + value.content.length * 4) throw problem(507, 'TASK_PHOTO_STORAGE');
    const id = randomUUID();
    db.prepare('INSERT INTO task_photos(id,content,created_at) VALUES(?,?,?)').run(id, value.content, at);
    return {id, at, bytes: value.content.length, width: value.width, height: value.height};
  }
  function addMany(inputs, at, existing = []) {
    const seen = new Set();
    return inputs.map(input => {
      if (typeof input === 'string') return add(input, at);
      const previous = input && typeof input === 'object' && Object.keys(input).length === 1 && existing.find(photo => photo.id === input.id);
      if (!previous || seen.has(previous.id) || !exists(previous.id)) throw problem(400, 'TASK_PHOTO_INVALID');
      seen.add(previous.id); return previous;
    });
  }
  const exists = id => !!db.prepare('SELECT 1 FROM task_photos WHERE id=?').get(id);
  // Call inside the task transaction, after recurring shifts have materialized.
  function cleanup(items, schedules, at, scheduleEnd) {
    const keep = new Set();
    for (const item of items) {
      const closedAt = item.closedAt ?? item.events?.at(-1)?.at ?? item.createdAt;
      if (!FINAL.includes(item.status) || afterMonths(closedAt, retentionMonths) > at) for (const photo of references(item)) keep.add(photo.id);
    }
    for (const schedule of schedules) {
      if (!references(schedule).length) continue;
      const endedAt = schedule.stoppedAt || scheduleEnd(schedule.until);
      if (afterMonths(endedAt, retentionMonths) > at) for (const photo of references(schedule)) keep.add(photo.id);
    }
    const remove = db.prepare('DELETE FROM task_photos WHERE id=?');
    for (const photo of db.prepare('SELECT id FROM task_photos').all()) if (!keep.has(photo.id)) remove.run(photo.id);
  }
  function decorate(item, available = new Set(db.prepare('SELECT id FROM task_photos').all().map(row => row.id))) {
    const mark = photo => ({...photo, available: available.has(photo.id)});
    const problems = value => { const list = photoList(value, 'problemPhotos', 'problemPhoto').map(mark); return {...value, problemPhotos: list, problemPhoto: list[0] || null}; };
    const solutions = value => { const list = photoList(value, 'photos', 'photo').map(mark); return {...value, photos: list, photo: list[0] || null}; };
    // Single-photo aliases allow older clients to read existing evidence safely.
    return {...problems(item), report: item.report ? solutions(item.report) : null,
      events: (item.events || []).map(event => ({...solutions(event), ...(event.snapshot ? {snapshot: problems(event.snapshot)} : {})}))};
  }
  function get(item, id) {
    if (!references(item).some(photo => photo.id === id)) throw problem(404, 'NOT_FOUND');
    const photo = db.prepare('SELECT content FROM task_photos WHERE id=?').get(id);
    if (!photo) throw problem(410, 'TASK_PHOTO_EXPIRED');
    return Buffer.from(photo.content);
  }
  return {add, addMany, cleanup, decorate, get, exists,
    policy: () => ({retentionMonths, limitBytes, usedBytes: usedBytes(), maxBytes: MAX_BYTES, maxEdge: MAX_EDGE, maxPhotos: MAX_PHOTOS})};
}
module.exports = {createTaskPhotos, jpeg, afterMonths, photoList, photoInputs, MAX_BYTES, MAX_EDGE, MAX_PHOTOS, REQUEST_BYTES};
