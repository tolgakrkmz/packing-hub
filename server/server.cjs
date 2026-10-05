const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {openStore, problem} = require('./store.cjs');
const {accounts} = require('./accounts.cjs');
const {inspect} = require('../scripts/check-publication.cjs');
const root = path.resolve(__dirname, '..');
function createHubServer({filename, publicOrigin, allowHttp = false}) {
  const origin = new URL(publicOrigin);
  if (origin.origin !== publicOrigin || origin.protocol !== 'https:' && !(allowHttp && origin.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(origin.hostname))) throw new Error('Configure an HTTPS HUB_PUBLIC_ORIGIN; HTTP is restricted to explicit localhost development.');
  const store = openStore(filename);
  const auth = accounts(store);
  const assets = new Map();
  for (const dir of ['', 'css', 'js']) for (const leaf of fs.readdirSync(path.join(root, dir))) {
    const file = dir ? dir + '/' + leaf : leaf;
    if (!/^[a-z-]+\.html$|^(css|js)\/[a-z0-9-]+\.(js|css)$/.test(file)) continue;
    if (!fs.lstatSync(path.join(root, file)).isFile()) throw new Error('Unapproved static source.');
    const body = fs.readFileSync(path.join(root, file));
    inspect(file, body);
    assets.set('/' + file, body);
  }
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
  async function jsonBody(request) {
    if (!(request.headers['content-type'] || '').startsWith('application/json')) throw problem(415, 'JSON_REQUIRED');
    try { const value = JSON.parse((await body(request)).toString('utf8')); if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(); return value; }
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
        if (pathname === '/api/logout' && request.method === 'POST') { auth.logout(token); return json(response, 200, {ok: true}, {'Set-Cookie': cookie('', 0)}); }
        if (pathname === '/api/events' && request.method === 'GET') {
          response.writeHead(200, {'Content-Type': 'text/event-stream', Connection: 'keep-alive', 'X-Accel-Buffering': 'no'});
          response.write(`event: version\ndata: ${JSON.stringify({version})}\n\n`);
          const client = {response, token}; clients.add(client);
          request.on('close', () => clients.delete(client));
          return;
        }
        if (pathname === '/api/accounts' || /^\/api\/accounts\/\d+$/.test(pathname)) {
          if (session.user.role !== 'admin') throw problem(403, 'FORBIDDEN');
          if (pathname === '/api/accounts' && request.method === 'GET') return json(response, 200, {users: auth.list()});
          const input = await jsonBody(request);
          if (pathname === '/api/accounts' && request.method === 'POST') return json(response, 201, {user: await auth.create(input.username, input.password, input.role, session.user)});
          if (request.method === 'PATCH') return json(response, 200, {user: await auth.update(Number(pathname.split('/').pop()), input, session.user)});
          throw problem(405, 'METHOD_REJECTED');
        }
        const document = pathname.match(/^\/api\/data\/([a-z-]+)$/);
        if (pathname === '/api/import/production-log/preview' || pathname === '/api/import/production-log/apply') {
          if (session.user.role !== 'admin') throw problem(403, 'FORBIDDEN');
          if (request.method !== 'POST') throw problem(405, 'METHOD_REJECTED');
          const input = await jsonBody(request);
          if (pathname.endsWith('/preview')) return json(response, 200, store.previewProductionImport(input, session.user));
          const result = store.applyProductionImport(input, revisionFor(request), session.user);
          if (result.added) broadcast('production-log', result.revision);
          return json(response, 200, result);
        }
        if (document) {
          if (request.method === 'GET') { const current = store.get(document[1]); return json(response, 200, current, {ETag: '"' + current.revision + '"'}); }
          if (request.method === 'PUT') { const result = store.put(document[1], await jsonBody(request), revisionFor(request), session.user); broadcast(document[1], result.revision); return json(response, 200, result); }
          throw problem(405, 'METHOD_REJECTED');
        }
        if (pathname === '/api/folders') {
          const name = url.searchParams.get('path') || '';
          if (request.method === 'GET') return json(response, 200, {entries: store.children(name)});
          if (request.method === 'POST') { const input = await jsonBody(request); store.createNode(input.path, input.kind, session.user); return json(response, 201, {ok: true}); }
          throw problem(405, 'METHOD_REJECTED');
        }
        if (pathname === '/api/files') {
          const name = url.searchParams.get('path');
          if (request.method === 'GET') { const file = store.node(name); if (file.kind !== 'file') throw problem(400, 'WRONG_KIND'); response.writeHead(200, {'Content-Type': file.mime || 'application/octet-stream', 'Content-Disposition': 'attachment', ETag: '"' + file.revision + '"'}); return response.end(Buffer.from(file.content)); }
          if (request.method === 'PUT') { const result = store.writeFile(name, await body(request, 10 * 1024 * 1024), request.headers['content-type'] || 'application/octet-stream', revisionFor(request), session.user); broadcast('package-instructions', result.revision); return json(response, 200, result); }
          throw problem(405, 'METHOD_REJECTED');
        }
        throw problem(404, 'NOT_FOUND');
      }
      if (request.method !== 'GET' && request.method !== 'HEAD') throw problem(405, 'METHOD_REJECTED');
      const assetName = pathname === '/' ? '/index.html' : pathname;
      const asset = assets.get(assetName);
      if (!asset) throw problem(404, 'NOT_FOUND');
      if (assetName.endsWith('.html') && assetName !== '/login.html' && !session) { response.writeHead(302, {Location: '/login.html'}); return response.end(); }
      if (['/accounts.html', '/production-import.html'].includes(assetName) && session?.user.role !== 'admin') throw problem(403, 'FORBIDDEN');
      const contentType = assetName.endsWith('.js') ? 'text/javascript' : assetName.endsWith('.css') ? 'text/css' : 'text/html';
      response.writeHead(200, {'Content-Type': contentType + '; charset=utf-8'});
      if (request.method === 'HEAD') return response.end();
      return response.end(session && assetName.endsWith('.html') && assetName !== '/login.html' ? asset.toString('utf8').replace('<head>', '<head>\n<script src="/server-session.js"></script>\n<script src="/js/server-connection.js"></script>\n<link rel="stylesheet" href="/css/server.css">') : asset);
    } catch (error) {
      if (!response.headersSent) json(response, error.status || 500, {error: error.status ? error.code : 'SERVER_ERROR'});
      else response.end();
    }
  });
  server.requestTimeout = 30000;
  server.on('listening', () => {
    if (allowHttp && origin.port === '0') { origin.port = String(server.address().port); publicOrigin = origin.origin; }
  });
  const heartbeat = setInterval(() => {
    for (const client of clients) if (auth.session(client.token)) client.response.write(': heartbeat\n\n'); else { client.response.end('event: logout\ndata: {}\n\n'); clients.delete(client); }
  }, 20000);
  heartbeat.unref();
  const close = async () => { clearInterval(heartbeat); for (const client of clients) client.response.end(); server.closeIdleConnections(); await new Promise(resolve => server.close(resolve)); store.close(); };
  return {server, store, auth, close};
}
if (require.main === module) {
  process.umask(0o077);
  try {
    const hub = createHubServer({filename: process.env.HUB_DATABASE || '/var/lib/package-hub/hub.sqlite', publicOrigin: process.env.HUB_PUBLIC_ORIGIN || '', allowHttp: process.env.HUB_ALLOW_HTTP === 'true'});
    hub.server.listen(Number(process.env.PORT || 3000), '0.0.0.0', () => console.log('Package Hub server started.'));
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => hub.close().then(() => process.exit(0)));
  } catch { console.error('Server startup failed. Check Node.js 24+, database permissions and HUB_PUBLIC_ORIGIN.'); process.exitCode = 1; }
}
module.exports = {createHubServer};
