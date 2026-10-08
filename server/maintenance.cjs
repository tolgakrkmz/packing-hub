/* Administrator summaries contain fixed states, timestamps and capacities only. */
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const {problem} = require('./store.cjs');
const CODES = new Set(['SNAPSHOT_FAILED', 'SECONDARY_UNAVAILABLE', 'SECONDARY_NOT_SEPARATE', 'SECONDARY_COPY_FAILED', 'RETENTION_FAILED',
  'CONFIGURATION_FAILED', 'APPLICATION_UNAVAILABLE', 'DATABASE_CONFIGURATION_UNSUPPORTED', 'BACKUP_WORKER_FAILED', 'BACKUP_INTERRUPTED', 'HOST_BACKUP_FAILED', 'STATUS_UNREADABLE']);
const timestamp = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value ? value : null;
function hostRequest(socketPath, route, method = 'GET') {
  return new Promise((resolve, reject) => {
    const request = http.request({socketPath, path: route, method, headers: method === 'POST' ? {'Content-Type': 'application/json', 'Content-Length': 2} : {}}, response => {
      let size = 0; const chunks = [];
      response.on('data', chunk => {
        size += chunk.length;
        if (size > 8192) request.destroy(new Error('MAINTENANCE_UNAVAILABLE')); else chunks.push(chunk);
      });
      response.on('error', reject);
      response.on('end', () => {
        if (response.statusCode === 409) return reject(problem(409, 'BACKUP_BUSY'));
        if (![200, 202].includes(response.statusCode)) return reject(problem(503, 'MAINTENANCE_UNAVAILABLE'));
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(problem(503, 'MAINTENANCE_UNAVAILABLE')); }
      });
    });
    const timer = setTimeout(() => request.destroy(problem(503, 'MAINTENANCE_UNAVAILABLE')), 15000);
    request.once('close', () => clearTimeout(timer)); request.once('error', reject);
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
  const manual = {available: job.available === true, state: ['idle', 'running', 'ok', 'failed'].includes(job.state) ? job.state : 'idle',
    startedAt: timestamp(job.startedAt), finishedAt: timestamp(job.finishedAt)};
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
  const states = [database.state, disk.state, backups.state, secondary.state, updates.state, manual.state === 'failed' ? 'failed' : 'ok'];
  const state = states.includes('failed') ? 'failed' : states.includes('warning') ? 'warning' : states.includes('unknown') ? 'unknown' : 'ok';
  return {state, checkedAt: new Date(now).toISOString(), database, disk, backups, secondary, updates, manual, warnings};
}
function createMaintenance({store, filename, socketPath, now = Date.now, request = hostRequest}) {
  let pending;
  async function status() {
    let host = null;
    if (socketPath) {
      // Coalesce simultaneous page refreshes; a failed read never reuses old success.
      pending ||= request(socketPath, '/status').catch(() => null).finally(() => { pending = null; });
      host = await pending;
    }
    let database;
    try {
      const checks = store.db.prepare('PRAGMA quick_check(1)').all();
      database = {state: checks.length === 1 && checks[0].quick_check === 'ok' ? 'ok' : 'failed'};
    } catch { database = {state: 'failed'}; }
    return summarize(host, {database, disk: capacity(filename), now: now()});
  }
  async function backup() {
    if (!socketPath) throw problem(503, 'MAINTENANCE_UNAVAILABLE');
    try {
      const result = await request(socketPath, '/backup', 'POST');
      if (result.state !== 'running') throw new Error();
      return {state: 'running'};
    } catch (error) { throw problem(error.status === 409 ? 409 : 503, error.status === 409 ? 'BACKUP_BUSY' : 'MAINTENANCE_UNAVAILABLE'); }
  }
  return {status, backup};
}
module.exports = {createMaintenance, summarize, capacity, hostRequest};
