const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {openStore, problem} = require('./store.cjs');
const {accounts} = require('./accounts.cjs');
const {can} = require('./permissions.cjs');
const {canViewModule, pairRoster, workforceCounts} = require('./module-access.cjs');
const {createImports, limits: importLimits} = require('./imports.cjs');
const {createTasks} = require('./tasks.cjs');
const {createMaintenance} = require('./maintenance.cjs');
const {createActivity} = require('./activity.cjs');
const {inspect} = require('../scripts/check-publication.cjs');
const root = path.resolve(__dirname, '..');
function createHubServer({filename, publicOrigin, allowHttp = false, taskTimezone = 'Europe/Sofia', taskNow, taskPhotos, maintenanceSocket}) {
  const origin = new URL(publicOrigin);
  if (origin.origin !== publicOrigin || origin.protocol !== 'https:' && !(allowHttp && origin.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(origin.hostname))) throw new Error('Configure an HTTPS HUB_PUBLIC_ORIGIN; HTTP is restricted to explicit localhost development.');
  const store = openStore(filename);
  const auth = accounts(store);
  const activity = createActivity(store);
  const tasks = createTasks(store, {timezone: taskTimezone, ...(taskNow ? {now: taskNow} : {}), photos: taskPhotos});
  tasks.maintain();
  const imports = createImports(store, filename);
  const maintenance = createMaintenance({store, filename, socketPath: maintenanceSocket});
  const assets = new Map();
  for (const dir of ['', 'css', 'js']) for (const leaf of fs.readdirSync(path.join(root, dir))) {
    const file = dir ? dir + '/' + leaf : leaf;
    if (!/^[a-z-]+\.html$|^(css|js)\/[a-z0-9-]+\.(js|css)$/.test(file)) continue;
    if (!fs.lstatSync(path.join(root, file)).isFile()) throw new Error('Unapproved static source.');
    const body = fs.readFileSync(path.join(root, file));
    inspect(file, body);
    assets.set('/' + file, body);
  }
  const markFile = 'assets/package-hub-mark.svg';
  if (!fs.lstatSync(path.join(root, markFile)).isFile()) throw new Error('Unapproved static source.');
  const mark = fs.readFileSync(path.join(root, markFile));
  inspect(markFile, mark);
  assets.set('/' + markFile, mark);
  const version = crypto.createHash('sha256').update(Buffer.concat([...assets.values()])).digest('hex').slice(0, 12);
  const cookieName = origin.protocol === 'https:' ? '__Host-hub-session' : 'hub-local-session';
  const clients = new Set(), attempts = new Map();
  const cookie = (token, age) => `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${origin.protocol === 'https:' ? '; Secure' : ''}`;
  const tokenFor = request => (request.headers.cookie || '').split(';').map(item => item.trim()).find(item => item.startsWith(cookieName + '='))?.slice(cookieName.length + 1) || '';
  const json = (response, status, data, extra = {}) => { response.writeHead(status, {'Content-Type': 'application/json; charset=utf-8', ...extra}); response.end(JSON.stringify(data)); };
  const revisionFor = request => {
    const header = request.headers['if-match'];
    if (typeof header !== 'string' || !/^"[1-9]\d*"$/.test(header)) throw problem(428, 'REVISION_REQUIRED');
    return Number(header.slice(1, -1));
  };
  async function body(request, limit = 2 * 1024 * 1024) {
    let size = 0;
    const chunks = [];
    for await (const chunk of request) {
      size += chunk.length;
      if (size > limit) throw problem(413, 'TOO_LARGE');
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }
  async function jsonBody(request, limit) {
    if ((request.headers['content-type'] || '').split(';')[0].trim().toLowerCase() !== 'application/json') throw problem(415, 'JSON_REQUIRED');
    try { const value = JSON.parse((await body(request, limit)).toString('utf8')); if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(); return value; }
    catch (error) { if (error.status) throw error; throw problem(400, 'INVALID_DATA'); }
  }
  function broadcast(module, revision) {
    const payload = `event: change\ndata: ${JSON.stringify({module, revision})}\n\n`;
    for (const client of clients) if (auth.session(client.token)) client.response.write(payload); else { client.response.end('event: logout\ndata: {}\n\n'); clients.delete(client); }
  }
  const server = http.createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    if (origin.protocol === 'https:') response.setHeader('Strict-Transport-Security', 'max-age=31536000');
    try {
      const url = new URL(request.url, publicOrigin);
      const pathname = url.pathname;
      const token = tokenFor(request);
      const session = auth.session(token);
      // Request bodies and password hashing may outlive an account change.
      const currentUser = () => {
        const fresh = auth.session(token);
        if (!fresh) throw problem(401, 'LOGIN_REQUIRED');
        return fresh.user;
      };
      const authorized = key => {
        const user = currentUser();
        if (!can(user, key)) throw problem(403, 'FORBIDDEN');
        return user;
      };
      const mutation = !['GET', 'HEAD'].includes(request.method);
      if (mutation && request.headers.origin !== publicOrigin) throw problem(403, 'ORIGIN_REJECTED');
      if (pathname === '/healthz' && request.method === 'GET') return json(response, 200, {ok: true});
      if (pathname === '/api/login' && request.method === 'POST') {
        const input = await jsonBody(request);
        const now = Date.now();
        for (const [key, value] of attempts) if (value.until < now) attempts.delete(key);
        const keys = ['ip:' + request.socket.remoteAddress, 'account:' + String(input.username).toLowerCase().slice(0, 32)];
        if (attempts.size > 10000 || keys.some(key => (attempts.get(key)?.count || 0) >= (key.startsWith('ip:') ? 30 : 10))) throw problem(429, 'RATE_LIMITED');
        for (const key of keys) { const prior = attempts.get(key); attempts.set(key, {count: (prior?.count || 0) + 1, until: prior?.until || now + 15 * 60000}); }
        const loggedIn = await auth.login(input.username, input.password);
        attempts.delete(keys[1]);
        const ipAttempts = attempts.get(keys[0]);
        if (ipAttempts) ipAttempts.count = Math.max(0, ipAttempts.count - 1);
        return json(response, 200, {user: loggedIn.user, csrf: loggedIn.csrf}, {'Set-Cookie': cookie(loggedIn.token, 12 * 3600)});
      }
      if (pathname.startsWith('/api/') || pathname === '/server-session.js') {
        if (!session) throw problem(401, 'LOGIN_REQUIRED');
        if (mutation && request.headers['x-csrf-token'] !== session.csrf) throw problem(403, 'CSRF_REJECTED');
        if (pathname === '/server-session.js' && request.method === 'GET') {
          response.writeHead(200, {'Content-Type': 'text/javascript; charset=utf-8'});
          return response.end('window.HUB_SERVER_BOOT=' + JSON.stringify({user: session.user, csrf: session.csrf, version}).replace(/</g, '\\u003c') + ';');
        }
        if (pathname === '/api/session' && request.method === 'GET') return json(response, 200, {user: session.user, csrf: session.csrf, version});
        if (pathname === '/api/admin/activity') {
          const user = authorized('canViewActivity');
          if (request.method !== 'GET') throw problem(405, 'METHOD_REJECTED');
          return json(response, 200, activity.list(url.searchParams, user));
        }
        if (pathname === '/api/admin/status' || pathname === '/api/admin/backup') {
          const right = pathname === '/api/admin/status' ? 'canViewSystemStatus' : 'canBackupSystem';
          authorized(right);
          if (pathname === '/api/admin/status' && request.method === 'GET') {
            const result = await maintenance.status(); authorized(right);
            return json(response, 200, result);
          }
          if (pathname === '/api/admin/backup' && request.method === 'POST') {
            const input = await jsonBody(request, 1024); authorized(right);
            if (Object.keys(input).length) throw problem(400, 'INVALID_DATA');
            const result = await maintenance.backup();
            return json(response, 202, result);
          }
          throw problem(405, 'METHOD_REJECTED');
        }
        if (pathname === '/api/logout' && request.method === 'POST') { auth.logout(token); return json(response, 200, {ok: true}, {'Set-Cookie': cookie('', 0)}); }
        if (pathname === '/api/events' && request.method === 'GET') {
          response.writeHead(200, {'Content-Type': 'text/event-stream', Connection: 'keep-alive', 'X-Accel-Buffering': 'no'});
          response.write(`event: version\ndata: ${JSON.stringify({version})}\n\n`);
          const client = {response, token}; clients.add(client);
          request.on('close', () => clients.delete(client));
          return;
        }
        if (pathname === '/api/accounts' || /^\/api\/accounts\/\d+$/.test(pathname)) {
          if (!can(session.user, request.method === 'GET' ? 'canViewAccounts' : 'canManageAccounts')) throw problem(403, 'FORBIDDEN');
          if (pathname === '/api/accounts' && request.method === 'GET') return json(response, 200, {users: auth.list()});
          const input = await jsonBody(request);
          if (request.method === 'DELETE' && pathname !== '/api/accounts') {
            const result = auth.remove(Number(pathname.split('/').pop()), authorized('canManageAccounts'), () => authorized('canManageAccounts'));
            broadcast('accounts', 0);
            return json(response, 200, result);
          }
          if (pathname === '/api/accounts' && request.method === 'POST') return json(response, 201, {user: await auth.create(input.username, input.password, input.role, authorized('canManageAccounts'), input.permissions, () => authorized('canManageAccounts'), input)});
          if (request.method === 'PATCH') {
            const user = await auth.update(Number(pathname.split('/').pop()), input, authorized('canManageAccounts'), () => authorized('canManageAccounts'));
            broadcast('accounts', 0);
            return json(response, 200, {user});
          }
          throw problem(405, 'METHOD_REJECTED');
        }
        if (pathname === '/api/tasks/summary') {
          if (request.method !== 'GET') throw problem(405, 'METHOD_REJECTED');
          return json(response, 200, tasks.summary(currentUser()));
        }
        if (pathname === '/api/tasks/preview') {
          if (request.method !== 'GET') throw problem(405, 'METHOD_REJECTED');
          return json(response, 200, tasks.preview(url.searchParams.get('date'), Number(url.searchParams.get('assigneeId')), currentUser()));
        }
        const taskPhoto = pathname.match(/^\/api\/tasks\/(items|schedules)\/([0-9a-f:-]+)\/photos\/([0-9a-f-]{36})$/);
        if (taskPhoto) {
          if (!['GET', 'HEAD'].includes(request.method)) throw problem(405, 'METHOD_REJECTED');
          const content = tasks.photo(taskPhoto[1], taskPhoto[2], taskPhoto[3], currentUser());
          response.writeHead(200, {'Content-Type': 'image/jpeg', 'Content-Length': content.length});
          return response.end(request.method === 'HEAD' ? undefined : content);
        }
        const taskRoute = pathname.match(/^\/api\/tasks(?:\/(items|schedules)\/([0-9a-f:-]+))?$/);
        if (taskRoute) {
          if (!taskRoute[1] && request.method === 'GET') return json(response, 200, tasks.list(currentUser()));
          if (!taskRoute[1] && request.method === 'POST') {
            const input = await jsonBody(request), result = tasks.create(input, currentUser());
            broadcast('tasks', 0); return json(response, 201, result);
          }
          if (taskRoute[1] && request.method === 'PATCH') {
            const input = await jsonBody(request), result = tasks.change(taskRoute[2], input, revisionFor(request), currentUser(), taskRoute[1] === 'schedules');
            broadcast('tasks', 0); return json(response, 200, result);
          }
          throw problem(405, 'METHOD_REJECTED');
        }
        if (pathname === '/api/pair-roster' || pathname === '/api/statistics/workforce') {
          if (!canViewModule(session.user, pathname === '/api/pair-roster' ? 'pair-targets' : 'statistics')) throw problem(403, 'FORBIDDEN');
          if (request.method !== 'GET') throw problem(405, 'METHOD_REJECTED');
          const current = store.get('personnel');
          const data = pathname === '/api/pair-roster' ? {employees: pairRoster(current.data.employees)} : {counts: workforceCounts(current.data.employees)};
          return json(response, 200, {data, revision: current.revision});
        }
        const statisticsData = pathname.match(/^\/api\/statistics\/data\/(production-log|line-downtime|pair-targets)$/);
        if (statisticsData) {
          if (!canViewModule(session.user, 'statistics')) throw problem(403, 'FORBIDDEN');
          if (request.method !== 'GET') throw problem(405, 'METHOD_REJECTED');
          return json(response, 200, store.get(statisticsData[1]));
        }
        const document = pathname.match(/^\/api\/data\/([a-z-]+)$/);
        if (document && !canViewModule(session.user, document[1])) throw problem(403, 'FORBIDDEN');
        const exportReport = pathname.match(/^\/api\/export\/([a-z-]+)$/);
        if (exportReport) {
          if (!can(session.user, 'canExportReports')) throw problem(403, 'FORBIDDEN');
          if (request.method !== 'GET') throw problem(405, 'METHOD_REJECTED');
          const kind = exportReport[1];
          if (!['production-log', 'line-downtime', 'pair-targets'].includes(kind)) throw problem(404, 'NOT_FOUND');
          if (!canViewModule(session.user, kind)) throw problem(403, 'FORBIDDEN');
          store.audit(session.user, 'export', kind);
          return json(response, 200, store.get(kind).data, {'Content-Disposition': 'attachment; filename="' + kind + '.json"'});
        }
        const batch = pathname.match(/^\/api\/import\/batches(?:\/([0-9a-f-]{36})(?:\/(preview|apply|files\/\d+))?)?$/);
        if (batch) {
          if (!can(session.user, 'canImportData')) throw problem(403, 'FORBIDDEN');
          if (!batch[1] && request.method === 'POST') return json(response, 201, imports.create(await jsonBody(request, importLimits.jsonBytes), currentUser()));
          if (batch[1] && !batch[2] && request.method === 'DELETE') return json(response, 200, imports.discard(batch[1], session.user));
          if (batch[2]?.startsWith('files/') && request.method === 'PUT') return json(response, 200, imports.upload(batch[1], Number(batch[2].split('/')[1]), await body(request, importLimits.fileBytes), currentUser()));
          if (batch[2] === 'preview' && request.method === 'POST') return json(response, 200, imports.preview(batch[1], session.user));
          if (batch[2] === 'apply' && request.method === 'POST') {
            const input = await jsonBody(request), result = imports.apply(batch[1], input.token, currentUser());
            for (const [module, revision] of Object.entries(result.revisions)) broadcast(module, revision);
            return json(response, 200, result);
          }
          throw problem(405, 'METHOD_REJECTED');
        }
        if (pathname === '/api/import/production-log/preview' || pathname === '/api/import/production-log/apply') {
          if (!can(session.user, 'canImportData')) throw problem(403, 'FORBIDDEN');
          if (request.method !== 'POST') throw problem(405, 'METHOD_REJECTED');
          const input = await jsonBody(request);
          if (pathname.endsWith('/preview')) return json(response, 200, store.previewProductionImport(input, currentUser()));
          const result = store.applyProductionImport(input, revisionFor(request), currentUser());
          if (result.added) broadcast('production-log', result.revision);
          return json(response, 200, result);
        }
        if (document) {
          if (request.method === 'GET') { const current = store.get(document[1]); return json(response, 200, current, {ETag: '"' + current.revision + '"'}); }
          if (request.method === 'PUT') { const result = store.put(document[1], await jsonBody(request, importLimits.jsonBytes), revisionFor(request), currentUser()); broadcast(document[1], result.revision); return json(response, 200, result); }
          throw problem(405, 'METHOD_REJECTED');
        }
        if (pathname === '/api/folders') {
          if (!canViewModule(session.user, 'package-instructions')) throw problem(403, 'FORBIDDEN');
          const name = url.searchParams.get('path') || '';
          if (request.method === 'GET') return json(response, 200, {entries: store.children(name)});
          if (request.method === 'POST') { const input = await jsonBody(request); store.createNode(input.path, input.kind, currentUser()); return json(response, 201, {ok: true}); }
          throw problem(405, 'METHOD_REJECTED');
        }
        if (pathname === '/api/files') {
          const name = url.searchParams.get('path');
          if (!canViewModule(session.user, ['personnel.json', 'data/personnel.json'].includes(name) ? 'personnel' : 'package-instructions')) throw problem(403, 'FORBIDDEN');
          if (request.method === 'GET') { const file = store.node(name); if (file.kind !== 'file') throw problem(400, 'WRONG_KIND'); response.writeHead(200, {'Content-Type': file.mime || 'application/octet-stream', 'Content-Disposition': 'attachment', ETag: '"' + file.revision + '"'}); return response.end(Buffer.from(file.content)); }
          if (request.method === 'PUT') { const result = store.writeFile(name, await body(request, name === 'data/package-instructions.json' ? importLimits.jsonBytes : importLimits.fileBytes), request.headers['content-type'] || 'application/octet-stream', revisionFor(request), currentUser()); broadcast('package-instructions', result.revision); return json(response, 200, result); }
          throw problem(405, 'METHOD_REJECTED');
        }
        throw problem(404, 'NOT_FOUND');
      }
      if (request.method !== 'GET' && request.method !== 'HEAD') throw problem(405, 'METHOD_REJECTED');
      const assetName = pathname === '/' ? '/index.html' : pathname;
      const asset = assets.get(assetName);
      if (!asset) throw problem(404, 'NOT_FOUND');
      if (assetName.endsWith('.html') && assetName !== '/login.html' && !session) { response.writeHead(302, {Location: '/login.html'}); return response.end(); }
      const moduleName = assetName.slice(1, -5);
      if (assetName.endsWith('.html') && !['index', 'login', 'production-import'].includes(moduleName) && !canViewModule(session?.user, moduleName)) throw problem(403, 'FORBIDDEN');
      if (assetName === '/production-import.html') {
        if (!can(session?.user, 'canImportData')) throw problem(403, 'FORBIDDEN');
        response.writeHead(302, {Location: '/data-import.html#production'}); return response.end();
      }
      const contentType = assetName.endsWith('.js') ? 'text/javascript' : assetName.endsWith('.css') ? 'text/css' : assetName === '/assets/package-hub-mark.svg' ? 'image/svg+xml' : 'text/html';
      response.writeHead(200, {'Content-Type': contentType + '; charset=utf-8'});
      if (request.method === 'HEAD') return response.end();
      if (session && assetName.endsWith('.html') && assetName !== '/login.html') store.audit(session.user, 'visit', assetName.slice(1, -5));
      return response.end(session && assetName.endsWith('.html') && assetName !== '/login.html' ? asset.toString('utf8').replace('<head>', '<head>\n<script src="/server-session.js"></script>\n<script src="/js/permission-model.js"></script>\n<script src="/js/server-connection.js"></script>\n<link rel="stylesheet" href="/css/server.css">') : asset);
    } catch (error) {
      if (!response.headersSent) json(response, error.status || 500, {error: error.status ? error.code : 'SERVER_ERROR'});
      else response.end();
    }
  });
  server.requestTimeout = 5 * 60 * 1000;
  server.headersTimeout = 30000;
  server.on('listening', () => {
    if (allowHttp && origin.port === '0') { origin.port = String(server.address().port); publicOrigin = origin.origin; }
  });
  const heartbeat = setInterval(() => {
    for (const client of clients) if (auth.session(client.token)) client.response.write(': heartbeat\n\n'); else { client.response.end('event: logout\ndata: {}\n\n'); clients.delete(client); }
  }, 20000);
  heartbeat.unref();
  const photoCleanup = setInterval(() => { try { tasks.maintain(); } catch { /* Retry next hour; do not log private task data. */ } }, 3600000);
  photoCleanup.unref();
  const close = async () => { clearInterval(photoCleanup); clearInterval(heartbeat); for (const client of clients) client.response.end(); server.closeIdleConnections(); await new Promise(resolve => server.close(resolve)); imports.close(); store.close(); };
  return {server, store, auth, imports, tasks, maintenance, close};
}
if (require.main === module) {
  process.umask(0o077);
  try {
    const hub = createHubServer({filename: process.env.HUB_DATABASE || '/var/lib/package-hub/hub.sqlite', publicOrigin: process.env.HUB_PUBLIC_ORIGIN || '', allowHttp: process.env.HUB_ALLOW_HTTP === 'true', maintenanceSocket: process.env.HUB_MAINTENANCE_SOCKET,
      taskPhotos: {retentionMonths: Number(process.env.HUB_TASK_PHOTO_RETENTION_MONTHS || 6), limitBytes: Number(process.env.HUB_TASK_PHOTO_LIMIT_MB || 512) * 1024 * 1024}});
    hub.server.listen(Number(process.env.PORT || 3000), '0.0.0.0', () => console.log('Package Hub server started.'));
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => hub.close().then(() => process.exit(0)));
  } catch { console.error('Server startup failed. Check Node.js 24+, database permissions and HUB_PUBLIC_ORIGIN.'); process.exitCode = 1; }
}
module.exports = {createHubServer};
