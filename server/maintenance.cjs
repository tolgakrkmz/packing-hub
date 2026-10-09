/* Administrator summaries contain fixed states, timestamps and capacities only. */
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const {problem} = require('./store.cjs');
const CODES = new Set(['SNAPSHOT_FAILED', 'SECONDARY_UNAVAILABLE', 'SECONDARY_NOT_SEPARATE', 'SECONDARY_COPY_FAILED', 'RETENTION_FAILED',
  'CONFIGURATION_FAILED', 'APPLICATION_UNAVAILABLE', 'DATABASE_CONFIGURATION_UNSUPPORTED', 'BACKUP_WORKER_FAILED', 'BACKUP_INTERRUPTED', 'HOST_BACKUP_FAILED', 'STATUS_UNREADABLE']);
const timestamp = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value ? value : null;
function hostRequest(socketPath, route, method = 'GET', timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const request = http.request({socketPath, path: route, method, headers: method === 'POST' ? {'Content-Type': 'application/json', 'Content-Length': 2} : {}}, response => {
      if (method === 'POST' && response.statusCode === 409) return request.destroy(problem(409, 'BACKUP_BUSY'));
      if (response.statusCode !== (method === 'POST' ? 202 : 200) || response.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') {
        return request.destroy(problem(503, 'MAINTENANCE_UNAVAILABLE'));
      }
      let size = 0; const chunks = [];
      response.on('data', chunk => {
        size += chunk.length;
        if (size > 8192) request.destroy(problem(503, 'MAINTENANCE_UNAVAILABLE')); else chunks.push(chunk);
      });
      response.on('error', () => reject(problem(503, 'MAINTENANCE_UNAVAILABLE')));
      response.on('aborted', () => reject(problem(503, 'MAINTENANCE_UNAVAILABLE')));
      response.on('end', () => {
        try {
          const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
          resolve(value);
        } catch { reject(problem(503, 'MAINTENANCE_UNAVAILABLE')); }
      });
    });
    const timer = setTimeout(() => request.destroy(problem(503, 'MAINTENANCE_UNAVAILABLE')), timeoutMs);
    request.once('close', () => clearTimeout(timer));
    request.once('error', error => reject(problem(error.status === 409 ? 409 : 503, error.status === 409 ? 'BACKUP_BUSY' : 'MAINTENANCE_UNAVAILABLE')));
    request.end(method === 'POST' ? '{}' : undefined);
  });
}
function capacity(filename) {
  if (filename === ':memory:') return {state: 'unknown', freeBytes: null, totalBytes: null};
  try {
    const stat = fs.statfsSync(path.dirname(filename), {bigint: true});
    const freeBytes = Number(stat.bavail * stat.bsize), totalBytes = Number(stat.blocks * stat.bsize);
    if (!Number.isSafeInteger(freeBytes) || !Number.isSafeInteger(totalBytes) || totalBytes <= 0 || freeBytes < 0 || freeBytes > totalBytes) throw new Error();
    return {state: freeBytes < 1024 ** 3 || freeBytes / totalBytes < .1 ? 'warning' : 'ok', freeBytes, totalBytes};
  } catch { return {state: 'unknown', freeBytes: null, totalBytes: null}; }
}
function summarize(host, {database, disk, now}) {
  const value = host?.backups || {}, intervalHours = [1, 2, 3, 4, 6, 8, 12, 24].includes(value.intervalHours) ? value.intervalHours : null;
  const backups = {state: ['ok', 'failed'].includes(value.state) ? value.state : 'unknown',
    lastAttempt: timestamp(value.lastAttempt), lastSuccess: timestamp(value.lastSuccess), lastPrimary: timestamp(value.lastPrimary),
    lastSecondary: timestamp(value.lastSecondary), intervalHours, code: CODES.has(value.code) ? value.code : null};
  if (backups.state === 'ok' && (!backups.lastSuccess || !intervalHours || value.code !== null ||
    [backups.lastAttempt, backups.lastPrimary, backups.lastSecondary].some(at => at !== backups.lastSuccess) || Date.parse(backups.lastSuccess) > now + 300000)) {
    backups.state = 'unknown'; backups.code = 'STATUS_UNREADABLE';
  }
  const secondary = {state: value.secondaryAvailable === false ? 'failed' : value.secondaryAvailable === true && backups.lastSecondary ? 'ok' : 'unknown', lastCopy: backups.lastSecondary};
  if (secondary.state === 'ok' && (!intervalHours || Date.parse(secondary.lastCopy) > now + 300000)) secondary.state = 'unknown';
  else if (secondary.state === 'ok' && Date.parse(secondary.lastCopy) + intervalHours * 3600000 + 900000 < now) secondary.state = 'warning';
  if (secondary.state === 'failed') { backups.state = 'failed'; backups.code = 'SECONDARY_UNAVAILABLE'; }
  else if (backups.state === 'ok' && Date.parse(backups.lastSuccess) + intervalHours * 3600000 + 900000 < now) {
    backups.state = 'warning'; backups.code = 'BACKUP_OVERDUE';
  }
  const updated = host?.updates || {};
  const updates = {state: ['ok', 'failed'].includes(updated.state) ? updated.state : 'unknown',
    lastSuccess: timestamp(updated.lastSuccess), lastAttempt: timestamp(updated.lastAttempt)};
  if (updates.state === 'ok' && (!updates.lastSuccess || Date.parse(updates.lastSuccess) > now + 300000)) updates.state = 'unknown';
  const job = host?.manual || {};
  const manual = {available: job.available === true, state: ['idle', 'running', 'ok', 'failed'].includes(job.state) ? job.state : 'unknown',
    startedAt: timestamp(job.startedAt), finishedAt: timestamp(job.finishedAt)};
  if (manual.state === 'ok' && (!manual.startedAt || !manual.finishedAt || Date.parse(manual.finishedAt) < Date.parse(manual.startedAt) || Date.parse(manual.finishedAt) > now + 300000)) manual.state = 'unknown';
  if (manual.state === 'running' && (!manual.startedAt || manual.finishedAt || Date.parse(manual.startedAt) > now + 300000)) manual.state = 'unknown';
  const warnings = [];
  if (database.state !== 'ok') warnings.push('DATABASE_UNAVAILABLE');
  if (disk.state === 'warning') warnings.push('DISK_SPACE_LOW');
  if (disk.state === 'unknown') warnings.push('DISK_STATUS_UNKNOWN');
  if (backups.state === 'failed') warnings.push(secondary.state === 'failed' ? 'SECONDARY_UNAVAILABLE' : 'BACKUP_FAILED');
  if (backups.state === 'warning') warnings.push('BACKUP_OVERDUE');
  if (secondary.state === 'warning') warnings.push('SECONDARY_COPY_OVERDUE');
  if (backups.state === 'unknown' || secondary.state === 'unknown') warnings.push('BACKUP_STATUS_UNKNOWN');
  if (updates.state === 'failed') warnings.push('UPDATE_FAILED');
  if (updates.state === 'unknown') warnings.push('UPDATE_STATUS_UNKNOWN');
  if (manual.state === 'failed') warnings.push('MANUAL_BACKUP_FAILED');
  if (!manual.available) warnings.push('MANUAL_BACKUP_UNAVAILABLE');
  if (manual.state === 'unknown') warnings.push('MANUAL_BACKUP_STATUS_UNKNOWN');
  const states = [database.state, disk.state, backups.state, secondary.state, updates.state,
    manual.state === 'failed' ? 'failed' : !manual.available || manual.state === 'unknown' ? 'unknown' : 'ok'];
  const state = states.includes('failed') ? 'failed' : states.includes('warning') ? 'warning' : states.includes('unknown') ? 'unknown' : 'ok';
  return {state, checkedAt: new Date(now).toISOString(), database, disk, backups, secondary, updates, manual, warnings};
}
function createMaintenance({store, filename, socketPath, now = Date.now, request = hostRequest}) {
  let pending, generation = 0;
  let identity;
  if (filename !== ':memory:') {
    try { const file = fs.lstatSync(filename, {bigint: true}); identity = {device: file.dev, inode: file.ino}; } catch { /* Report unavailable below. */ }
  }
  async function readStatus() {
    const startedGeneration = generation;
    let host = null;
    if (socketPath) {
      host = await request(socketPath, '/status').catch(() => null);
    }
    // A manual action may have changed the host while this read was in flight.
    // Discard its old snapshot rather than claiming a result from before it.
    if (generation !== startedGeneration) host = null;
    let database;
    try {
      if (filename !== ':memory:') {
        const file = fs.lstatSync(filename, {bigint: true});
        if (!identity || !file.isFile() || file.nlink !== 1n || file.size === 0n || file.dev !== identity.device || file.ino !== identity.inode) throw new Error();
        fs.accessSync(filename, fs.constants.R_OK | fs.constants.W_OK);
      }
      // Check access without scanning every data/BLOB page on each screen poll.
      // Backup verification performs the complete database integrity checks.
      const check = store.db.prepare('SELECT count(*) AS readable FROM sqlite_schema').get();
      database = {state: Number.isSafeInteger(check?.readable) && check.readable > 0 ? 'ok' : 'failed'};
    } catch { database = {state: 'failed'}; }
    return summarize(host, {database, disk: capacity(filename), now: now()});
  }
  function status() {
    // Share the whole check, including SQLite/disk reads, for concurrent callers.
    // After settlement, the next request reads afresh and never reuses old green.
    if (!pending) {
      const operation = readStatus().finally(() => { if (pending === operation) pending = null; });
      pending = operation;
    }
    return pending;
  }
  async function backup() {
    if (!socketPath) throw problem(503, 'MAINTENANCE_UNAVAILABLE');
    try {
      const result = await request(socketPath, '/backup', 'POST');
      if (result.state !== 'running') throw new Error();
      return {state: 'running'};
    } catch (error) { throw problem(error.status === 409 ? 409 : 503, error.status === 409 ? 'BACKUP_BUSY' : 'MAINTENANCE_UNAVAILABLE'); }
    finally { generation++; pending = null; }
  }
  return {status, backup};
}
module.exports = {createMaintenance, summarize, capacity, hostRequest};
