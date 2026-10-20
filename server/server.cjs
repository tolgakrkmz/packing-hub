const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {openStore, problem} = require('./store.cjs');
const {accounts, SESSION_IDLE} = require('./accounts.cjs');
const {createAccountInstructions} = require('./account-instructions.cjs');
const {createAccountAvatars, REQUEST_BYTES: avatarRequestBytes} = require('./account-avatars.cjs');
const {can} = require('./permissions.cjs');
const {canViewModule, pairRoster, workforceCounts} = require('./module-access.cjs');
const {createImports, limits: importLimits} = require('./imports.cjs');
const {createNotifications} = require('./notifications.cjs');
const {createTasks} = require('./tasks.cjs');
const {createProblems} = require('./problems.cjs');
const {createWall} = require('./wall.cjs');
const {createTeamRatings} = require('./team-ratings.cjs');
const {createStatisticsReads} = require('./statistics.cjs');
const {createStaticAssets} = require('./static-assets.cjs');
const {REQUEST_BYTES: taskPhotoRequestBytes} = require('./task-photos.cjs');
const {createMaintenance} = require('./maintenance.cjs');
const {createActivity} = require('./activity.cjs');
const {createShiftCloseout} = require('./shift-closeout.cjs');
const {inspect} = require('../scripts/check-publication.cjs');
const root = path.resolve(__dirname, '..');
function createHubServer({filename, publicOrigin, allowHttp = false, taskTimezone = 'Europe/Sofia', taskNow, personnelNow=taskNow, productionNow=taskNow, taskPhotos, maintenanceSocket, notifications: notificationOptions}) {
  const origin = new URL(publicOrigin);
  if (origin.origin !== publicOrigin || origin.protocol !== 'https:' && !(allowHttp && origin.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(origin.hostname))) throw new Error('Configure an HTTPS HUB_PUBLIC_ORIGIN; HTTP is restricted to explicit localhost development.');
  const store = openStore(filename,{personnelNow,productionNow});
  const auth = accounts(store);
  const accountInstructions = createAccountInstructions(store);
  const avatars = createAccountAvatars(store);
  const activity = createActivity(store);
  const tasks = createTasks(store, {timezone: taskTimezone, ...(taskNow ? {now: taskNow} : {}), photos: taskPhotos});
  const problems = createProblems(store, {...(taskNow ? {now: taskNow} : {}), photos: taskPhotos});
  const wall = createWall(store, {...(taskNow ? {now: taskNow} : {}), photos: taskPhotos});
  const teamRatings = createTeamRatings(store, productionNow ? {now: productionNow} : {});
  const statistics = createStatisticsReads(store);
  const closeout = createShiftCloseout(store, taskNow ? {now:taskNow} : {});
  tasks.maintain();
  const imports = createImports(store, filename);
  const maintenance = createMaintenance({store, filename, socketPath: maintenanceSocket});
  const notifications = createNotifications(store, {...notificationOptions, ...(taskNow ? {taskNow} : {})});
  const assets = new Map();
  for (const dir of ['', 'css', 'js']) for (const leaf of fs.readdirSync(path.join(root, dir))) {
    const file = dir ? dir + '/' + leaf : leaf;
    if (!/^[a-z-]+\.html$|^(css|js)\/[a-z0-9-]+\.(js|css)$/.test(file)) continue;
    if (!fs.lstatSync(path.join(root, file)).isFile()) throw new Error('Unapproved static source.');
    const body = fs.readFileSync(path.join(root, file));
    inspect(file, body);
    assets.set('/' + file, body);
  }
  if (!fs.lstatSync(path.join(root, 'manifest.webmanifest')).isFile()) throw new Error('Unapproved static source.');
  const manifest = fs.readFileSync(path.join(root, 'manifest.webmanifest')); inspect('manifest.webmanifest', manifest); assets.set('/manifest.webmanifest', manifest);
  for (const file of ['assets/package-hub-mark.svg', 'assets/package-hub-icon-180.png', 'assets/package-hub-icon-192.png', 'assets/package-hub-icon-512.png']) {
    if (!fs.lstatSync(path.join(root, file)).isFile()) throw new Error('Unapproved static source.');
    const image = fs.readFileSync(path.join(root, file));
    inspect(file, image);
    assets.set('/' + file, image);
  }
  // Only approved top-level HTML screens have clean routes. Static files and
  // unknown paths never fall back to a page.
  const pages = new Map([...assets.keys()].filter(name => name.endsWith('.html')).map(name => [name === '/index.html' ? '/' : name.slice(0, -5), name]));
  const pageLinks = html => html.replace(/\bhref="\/?([a-z-]+)\.html([?#][^"]*)?"/g, (match, name, suffix = '') => {
    const route = name === 'index' ? '/' : '/' + name;
    return pages.has(route) ? 'href="' + route + suffix + '"' : match;
  });
  const staticAssets = createStaticAssets(assets,{transformHTML:(name,html) => {
    const content = pageLinks(html);
    return ['/login.html', '/account-password.html'].includes(name) ? content : content.replace('<head>', '<head>\n<script src="/server-session.js"></script>\n<script src="/js/notification-model.js"></script>\n<script src="/js/permission-model.js"></script>\n<script src="/js/server-connection.js"></script>\n<script src="/js/server-shell.js"></script>\n<script src="/js/shift-closeout-indicator.js"></script>\n<script src="/js/notification-target.js"></script>\n<script src="/js/notification-prompt.js"></script>\n<script src="/js/notifications.js"></script>\n<link rel="stylesheet" href="/css/notifications.css">\n<link rel="stylesheet" href="/css/server.css">');
  }});
  const {version} = staticAssets;
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
  function syncNotifications() { try { tasks.tick(); notifications.sync(); } catch { /* Retry on the next tick without exposing local content. */ } }
  // Revoked tokens lose their live updates at once instead of at the next heartbeat.
  function closeRevoked() {
    for (const client of clients) if (!auth.session(client.token)) { client.response.end('event: logout\ndata: {}\n\n'); clients.delete(client); }
  }
  function broadcast(module, revision) {
    syncNotifications();
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
      if (session) session.user = {...accountInstructions.userView(session.user), avatar: avatars.version(session.user.id)};
      // Request bodies and password hashing may outlive an account change.
      const currentUser = () => {
        const fresh = auth.session(token);
        if (!fresh) throw problem(401, 'LOGIN_REQUIRED');
        if (fresh.user.mustChangePassword) throw problem(403, 'PASSWORD_CHANGE_REQUIRED');
        return accountInstructions.userView(fresh.user);
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
        return json(response, 200, {user: accountInstructions.userView(loggedIn.user), csrf: loggedIn.csrf}, {'Set-Cookie': cookie(loggedIn.token, SESSION_IDLE / 1000)});
      }
      if (pathname.startsWith('/api/') || pathname === '/server-session.js') {
        if (!session) throw problem(401, 'LOGIN_REQUIRED');
        if (mutation && request.headers['x-csrf-token'] !== session.csrf) throw problem(403, 'CSRF_REJECTED');
        // Page loads and saves count as use; background polls and /api/events do not.
        if ((mutation || pathname === '/server-session.js') && auth.touch(token)) response.setHeader('Set-Cookie', cookie(token, SESSION_IDLE / 1000));
        // A temporary password opens only the password change and sign-out endpoints.
        if (session.user.mustChangePassword && !['/api/session', '/api/account/password', '/api/logout', '/api/logout-all'].includes(pathname)) throw problem(403, 'PASSWORD_CHANGE_REQUIRED');
        if (pathname === '/api/account/password') {
          if (request.method !== 'POST') throw problem(405, 'METHOD_REJECTED');
          const input = await jsonBody(request, 4096);
          if (typeof input.currentPassword !== 'string' || typeof input.password !== 'string') throw problem(400, 'INVALID_DATA');
          const key = 'password:' + session.user.id, now = Date.now(), prior = attempts.get(key);
          if (prior && prior.until < now) attempts.delete(key);
          if ((attempts.get(key)?.count || 0) >= 10) throw problem(429, 'RATE_LIMITED');
          // Count before hashing so parallel guesses cannot pass the limit; only wrong passwords keep the count.
          const last = attempts.get(key); attempts.set(key, {count: (last?.count || 0) + 1, until: last?.until || now + 15 * 60000});
          try {
            const changed = await auth.changePassword(token, input.currentPassword, input.password);
            attempts.delete(key); closeRevoked();
            return json(response, 200, {user: accountInstructions.userView(changed.user), csrf: changed.csrf}, {'Set-Cookie': cookie(changed.token, SESSION_IDLE / 1000)});
          } catch (error) {
            const entry = attempts.get(key);
            if (entry && error.code !== 'CURRENT_PASSWORD_INVALID') entry.count = Math.max(0, entry.count - 1);
            throw error;
          }
        }
        if (pathname === '/api/logout-all') {
          if (request.method !== 'POST') throw problem(405, 'METHOD_REJECTED');
          const result = auth.logoutAll(token); closeRevoked();
          return json(response, 200, result, {'Set-Cookie': cookie('', 0)});
        }
        if (pathname === '/server-session.js' && request.method === 'GET') {
          response.writeHead(200, {'Content-Type': 'text/javascript; charset=utf-8'});
          return response.end('window.HUB_SERVER_BOOT=' + JSON.stringify({user: session.user, csrf: session.csrf, version}).replace(/</g, '\\u003c') + ';');
        }
        if (pathname === '/api/session' && request.method === 'GET') return json(response, 200, {user: session.user, csrf: session.csrf, version});
        if (pathname === '/api/account/avatar') {
          if (request.method === 'GET') {
            const content = avatars.get(currentUser());
            response.writeHead(200, {'Content-Type': 'image/jpeg', 'Content-Length': content.length, 'Content-Disposition': 'inline'});
            return response.end(content);
          }
          if (request.method === 'PUT') {
            const input = await jsonBody(request, avatarRequestBytes);
            if (Object.keys(input).some(key => key !== 'photo')) throw problem(400, 'INVALID_DATA');
            return json(response, 200, avatars.set(currentUser(), input.photo));
          }
          if (request.method === 'DELETE') return json(response, 200, avatars.remove(currentUser()));
          throw problem(405, 'METHOD_REJECTED');
        }
        if(pathname==='/api/pair-access') {
          if(request.method!=='GET')throw problem(405,'METHOD_REJECTED');
          return json(response,200,store.productionAccess.read(url.searchParams,authorized('canViewPairs'),'pair-targets'));
        }
        if(pathname==='/api/production-access') {
          if(request.method==='GET')return json(response,200,store.productionAccess.read(url.searchParams,authorized('canViewProduction')));
          if(request.method==='POST') {
            const input=await jsonBody(request,4096),result=store.productionAccess.configure(input,authorized('canManageProductionSettings'));
            broadcast('production-access',0);return json(response,200,result);
          }
          throw problem(405,'METHOD_REJECTED');
        }
        if (pathname === '/api/shift-closeout') {
          const user = authorized('canViewShiftCloseout');
          if (request.method !== 'GET') throw problem(405,'METHOD_REJECTED');
          return json(response,200,closeout.read(url.searchParams,user));
        }
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
        if (/^\/api\/accounts\/\d+\/avatar$/.test(pathname)) {
          if (request.method !== 'GET') throw problem(405, 'METHOD_REJECTED');
          authorized('canViewAccounts');
          // Deleted accounts are not listed, so their photo is never served.
          const owner = auth.list().find(user => user.id === Number(pathname.split('/')[3]));
          if (!owner) throw problem(404, 'NOT_FOUND');
          const content = avatars.get(owner);
          response.writeHead(200, {'Content-Type': 'image/jpeg', 'Content-Length': content.length, 'Content-Disposition': 'inline'});
          return response.end(content);
        }
        if (pathname === '/api/accounts' || /^\/api\/accounts\/\d+$/.test(pathname)) {
          if (!can(session.user, request.method === 'GET' ? 'canViewAccounts' : 'canManageAccounts')) throw problem(403, 'FORBIDDEN');
          // Only the photo version is listed; the image itself needs its own authorized request.
          const withAvatar = user => ({...user, avatar: avatars.version(user.id)});
          if (pathname === '/api/accounts' && request.method === 'GET') return json(response, 200, {users: auth.list().map(withAvatar)});
          const input = await jsonBody(request);
          if (request.method === 'DELETE' && pathname !== '/api/accounts') {
            const result = auth.remove(Number(pathname.split('/').pop()), authorized('canManageAccounts'), () => authorized('canManageAccounts'));
            broadcast('accounts', 0);
            return json(response, 200, result);
          }
          if (pathname === '/api/accounts' && request.method === 'POST') return json(response, 201, {user: withAvatar(await auth.create(input.username, input.password, input.role, authorized('canManageAccounts'), input.permissions, () => authorized('canManageAccounts'), input, {temporary: true}))});
          if (request.method === 'PATCH') {
            const id = Number(pathname.split('/').pop());
            // A reset for someone else is temporary; the owner chooses the lasting password.
            const user = await auth.update(id, input, authorized('canManageAccounts'), () => authorized('canManageAccounts'), {temporaryPassword: id !== session.user.id});
            broadcast('accounts', 0);
            return json(response, 200, {user: withAvatar(user)});
          }
          throw problem(405, 'METHOD_REJECTED');
        }
        if (pathname.startsWith('/api/notifications')) {
          const user = authorized('canViewNotifications');
          if (pathname === '/api/notifications/summary') {
            if (request.method !== 'GET') throw problem(405, 'METHOD_REJECTED');
            syncNotifications(); return json(response, 200, notifications.summary(user));
          }
          if (pathname === '/api/notifications' && request.method === 'GET') { syncNotifications(); return json(response, 200, notifications.list(user, url.searchParams.get('before'))); }
          if (pathname === '/api/notifications/preferences' && request.method === 'GET') return json(response, 200, notifications.preferences(user));
          const methods = {'/api/notifications/preferences': 'PATCH', '/api/notifications/read': 'POST', '/api/notifications/device': 'POST', '/api/notifications/subscriptions': 'POST', '/api/notifications/unsubscribe': 'POST', '/api/notifications/test': 'POST'};
          if (!methods[pathname]) throw problem(404, 'NOT_FOUND');
          if (request.method !== methods[pathname]) throw problem(405, 'METHOD_REJECTED');
          const input = await jsonBody(request, 4096), fresh = authorized('canViewNotifications');
          if (pathname.endsWith('/preferences')) return json(response, 200, notifications.updatePreferences(input, fresh));
          if (pathname.endsWith('/read')) return json(response, 200, notifications.read(input, fresh));
          if (pathname.endsWith('/device')) return json(response, 200, notifications.device(input, fresh, crypto.createHash('sha256').update(token).digest('hex')));
          if (pathname.endsWith('/unsubscribe')) return json(response, 200, notifications.unsubscribe(input, fresh));
          if (pathname.endsWith('/test')) { const result = await notifications.testDevice(input, fresh); authorized('canViewNotifications'); return json(response, 200, result); }
          return json(response, 201, notifications.subscribe(input, fresh, crypto.createHash('sha256').update(token).digest('hex')));
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
            const input = await jsonBody(request, taskPhotoRequestBytes), result = tasks.create(input, currentUser());
            broadcast('tasks', 0); return json(response, 201, result);
          }
          if (taskRoute[1] && request.method === 'PATCH') {
            const input = await jsonBody(request, taskPhotoRequestBytes), result = tasks.change(taskRoute[2], input, revisionFor(request), currentUser(), taskRoute[1] === 'schedules');
            broadcast('tasks', 0); return json(response, 200, result);
          }
          throw problem(405, 'METHOD_REJECTED');
        }
        if (pathname === '/api/team-ratings/summary') {
          if (request.method !== 'GET') throw problem(405, 'METHOD_REJECTED');
          return json(response, 200, teamRatings.summary(Number(url.searchParams.get('days') || 30), currentUser()));
        }
        if (pathname === '/api/team-ratings/prompt' || pathname === '/api/team-ratings') {
          if (request.method !== 'POST') throw problem(405, 'METHOD_REJECTED');
          const input = await jsonBody(request);
          return json(response, 200, pathname.endsWith('/prompt') ? teamRatings.prompt(input, currentUser()) : teamRatings.rate(input, currentUser()));
        }
        if (pathname === '/api/wall/summary') {
          if (request.method !== 'GET') throw problem(405, 'METHOD_REJECTED');
          return json(response, 200, wall.summary(currentUser()));
        }
        const wallAvatar = pathname.match(/^\/api\/wall\/authors\/(\d{1,12})\/avatar$/);
        if (wallAvatar) {
          if (request.method !== 'GET') throw problem(405, 'METHOD_REJECTED');
          const owner = auth.list().find(user => user.id === wall.authorId(Number(wallAvatar[1]), currentUser()));
          if (!owner) throw problem(404, 'NOT_FOUND');
          const content = avatars.get(owner);
          response.writeHead(200, {'Content-Type': 'image/jpeg', 'Content-Length': content.length, 'Content-Disposition': 'inline'});
          return response.end(content);
        }
        const wallPhoto = pathname.match(/^\/api\/wall\/([0-9a-f-]{36})\/photos\/([0-9a-f-]{36})$/);
        if (wallPhoto) {
          if (!['GET', 'HEAD'].includes(request.method)) throw problem(405, 'METHOD_REJECTED');
          const content = wall.photo(wallPhoto[1], wallPhoto[2], currentUser());
          response.writeHead(200, {'Content-Type': 'image/jpeg', 'Content-Length': content.length});
          return response.end(request.method === 'HEAD' ? undefined : content);
        }
        const wallRoute = pathname.match(/^\/api\/wall(?:\/([0-9a-f-]{36})(?:\/(comments|reactions)(?:\/([0-9a-f-]{36}))?)?)?$/);
        if (wallRoute) {
          const [, postId, part, commentId] = wallRoute;
          let result, status = 200;
          if (!postId && request.method === 'GET') return json(response, 200, wall.list(currentUser(), url.searchParams.get('before')));
          if (!postId && request.method === 'POST') { result = wall.create(await jsonBody(request, taskPhotoRequestBytes), currentUser()); status = 201; }
          else if (postId && part === 'comments' && !commentId && request.method === 'POST') { result = wall.comment(postId, await jsonBody(request), currentUser()); status = 201; }
          else if (postId && part === 'reactions' && !commentId && request.method === 'POST') result = wall.react(postId, await jsonBody(request), currentUser());
          else if (postId && (!part || part === 'comments' && commentId) && request.method === 'DELETE') result = wall.remove(postId, commentId, currentUser());
          else throw problem(405, 'METHOD_REJECTED');
          broadcast('wall', 0); return json(response, status, result);
        }
        const problemPhoto = pathname.match(/^\/api\/problems\/([0-9a-f-]{36})\/photos\/([0-9a-f-]{36})$/);
        if (problemPhoto) {
          if (!['GET', 'HEAD'].includes(request.method)) throw problem(405, 'METHOD_REJECTED');
          const content = problems.photo(problemPhoto[1], problemPhoto[2], currentUser());
          response.writeHead(200, {'Content-Type': 'image/jpeg', 'Content-Length': content.length});
          return response.end(request.method === 'HEAD' ? undefined : content);
        }
        const problemRoute = pathname.match(/^\/api\/problems(?:\/([0-9a-f-]{36}))?$/);
        if (problemRoute) {
          if (!problemRoute[1] && request.method === 'GET') return json(response, 200, problems.list(currentUser()));
          if (!problemRoute[1] && request.method === 'POST') {
            const result = problems.create(await jsonBody(request, taskPhotoRequestBytes), currentUser());
            broadcast('problems', 0); return json(response, 201, result);
          }
          if (problemRoute[1] && request.method === 'PATCH') {
            const input = await jsonBody(request, taskPhotoRequestBytes), result = problems.change(problemRoute[1], input, revisionFor(request), currentUser());
            broadcast('problems', 0); return json(response, 200, result);
          }
          throw problem(405, 'METHOD_REJECTED');
        }
        if (pathname === '/api/pair-roster' || pathname === '/api/statistics/workforce') {
          if (!canViewModule(session.user, pathname === '/api/pair-roster' ? 'pair-targets' : 'statistics')) throw problem(403, 'FORBIDDEN');
          if (request.method !== 'GET') throw problem(405, 'METHOD_REJECTED');
          const current = store.get('personnel');
          const data = pathname === '/api/pair-roster' ? {employees: pairRoster(current.data.employees),
            ...(current.data.employees.some(p=>p.transfers!==undefined) ? {schemaVersion:4} : {})} : {counts: workforceCounts(current.data.employees,store.personnelDate())};
          return json(response, 200, {data, revision: current.revision});
        }
        const statisticsPeriod = pathname.match(/^\/api\/statistics\/period\/(production-log|line-downtime|pair-targets)$/);
        if (statisticsPeriod) {
          if (!canViewModule(session.user, 'statistics')) throw problem(403, 'FORBIDDEN');
          if (request.method !== 'GET') throw problem(405, 'METHOD_REJECTED');
          if ([...url.searchParams.keys()].some(key => !['month','scope'].includes(key)) || url.searchParams.getAll('month').length !== 1 || url.searchParams.getAll('scope').length > 1) throw problem(400,'INVALID_PERIOD');
          return json(response,200,statistics.read(statisticsPeriod[1],url.searchParams.get('month'),url.searchParams.get('scope') ?? 'year'));
        }
        const statisticsData = pathname.match(/^\/api\/statistics\/data\/(production-log|line-downtime|pair-targets)$/);
        if (statisticsData) {
          if (!canViewModule(session.user, 'statistics')) throw problem(403, 'FORBIDDEN');
          if (request.method !== 'GET') throw problem(405, 'METHOD_REJECTED');
          return json(response, 200, store.get(statisticsData[1]));
        }
        const document = pathname.match(/^\/api\/data\/([a-z-]+)$/);
        if (document && !canViewModule(session.user, document[1])) throw problem(403, 'FORBIDDEN');
        const history = pathname.match(/^\/api\/reports\/(production-log|line-downtime|pair-targets)\/history$/);
        if (history) {
          if (request.method !== 'GET') throw problem(405,'METHOD_REJECTED');
          const id = url.searchParams.get('entryId');
          const options = Object.fromEntries(url.searchParams);
          const result = id === null ? store.reportHistoryList(history[1],currentUser(),options)
            : options.version !== undefined ? store.reportHistorySnapshot(history[1],id,options.version,currentUser())
            : store.reportHistory(history[1],id,currentUser(),{...options,metadataOnly:options.metadata === '1'});
          return json(response,200,result);
        }
        const operation = pathname.match(/^\/api\/reports\/(production-log|line-downtime|pair-targets)\/operations$/);
        if (operation) {
          if (request.method !== 'POST') throw problem(405, 'METHOD_REJECTED');
          const input = await jsonBody(request);
          const result = store.reportOperation(operation[1], input, input.action === 'create' ? undefined : revisionFor(request), currentUser());
          if (!result.replayed) broadcast(operation[1], result.revision);
          return json(response, 200, result);
        }
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
          if (request.method === 'GET') { const current = document[1] === 'package-instructions' && accountInstructions.has(session.user) ? accountInstructions.get(session.user) : store.get(document[1]); return json(response, 200, current, {ETag: '"' + current.revision + '"'}); }
          if (document[1] === 'package-instructions' && accountInstructions.has(currentUser())) throw problem(403, 'FORBIDDEN');
          if (request.method === 'PUT') { const input = await jsonBody(request, importLimits.jsonBytes); const result = store.put(document[1], input.data || input, revisionFor(request), currentUser(), 'report', false, {reason:input.data ? input.reason : undefined}); broadcast(document[1], result.revision); return json(response, 200, result); }
          throw problem(405, 'METHOD_REJECTED');
        }
        if (pathname === '/api/folders') {
          if (!canViewModule(session.user, 'package-instructions')) throw problem(403, 'FORBIDDEN');
          const name = url.searchParams.get('path') || '';
          if (request.method === 'GET') return json(response, 200, {entries: accountInstructions.has(session.user) ? accountInstructions.children(name, session.user) : store.children(name)});
          if (request.method === 'POST') { const input = await jsonBody(request); store.createNode(input.path, input.kind, currentUser()); return json(response, 201, {ok: true}); }
          throw problem(405, 'METHOD_REJECTED');
        }
        if (pathname === '/api/files') {
          const name = url.searchParams.get('path');
          if (!canViewModule(session.user, ['personnel.json', 'data/personnel.json'].includes(name) ? 'personnel' : 'package-instructions')) throw problem(403, 'FORBIDDEN');
          if (request.method === 'GET') { const file = accountInstructions.has(session.user) ? accountInstructions.node(name, session.user) : store.node(name); if (file.kind !== 'file') throw problem(400, 'WRONG_KIND'); response.writeHead(200, {'Content-Type': file.mime || 'application/octet-stream', 'Content-Disposition': 'attachment', ETag: '"' + file.revision + '"'}); return response.end(Buffer.from(file.content)); }
          if (request.method === 'PUT') { const result = store.writeFile(name, await body(request, name === 'data/package-instructions.json' ? importLimits.jsonBytes : importLimits.fileBytes), request.headers['content-type'] || 'application/octet-stream', revisionFor(request), currentUser()); broadcast('package-instructions', result.revision); return json(response, 200, result); }
          throw problem(405, 'METHOD_REJECTED');
        }
        throw problem(404, 'NOT_FOUND');
      }
      if (request.method !== 'GET' && request.method !== 'HEAD') throw problem(405, 'METHOD_REJECTED');
      const route = pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
      const assetName = pages.get(route) || (route === '/index' ? '/index.html' : pathname);
      const asset = assets.get(assetName);
      if (!asset) throw problem(404, 'NOT_FOUND');
      if (assetName.endsWith('.html') && assetName !== '/login.html' && !session) { response.writeHead(302, {Location: '/login'}); return response.end(); }
      if (assetName.endsWith('.html') && session?.user.mustChangePassword && !['/login.html', '/account-password.html'].includes(assetName)) { response.writeHead(302, {Location: '/account-password'}); return response.end(); }
      const moduleName = assetName.slice(1, -5);
      if (assetName.endsWith('.html') && !['index', 'login', 'account', 'account-password', 'production-import', 'admin-denied'].includes(moduleName) && !canViewModule(session?.user, moduleName)) {
        if (moduleName === 'admin-panel') { staticAssets.send('/admin-denied.html',request,response,403); return; }
        throw problem(403,'FORBIDDEN');
      }
      if (assetName === '/production-import.html') {
        if (!can(session?.user, 'canImportData')) throw problem(403, 'FORBIDDEN');
        response.writeHead(302, {Location: '/data-import' + url.search + '#production'}); return response.end();
      }
      if (assetName.endsWith('.html')) {
        const canonical = assetName === '/index.html' ? '/' : assetName.slice(0, -5);
        if (pathname !== canonical) { response.writeHead(308, {Location: canonical + url.search}); return response.end(); }
      }
      staticAssets.send(assetName,request,response);
      if (request.method === 'GET' && session && assetName.endsWith('.html') && assetName !== '/login.html') store.audit(session.user, 'visit', assetName.slice(1, -5));
      return;
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
  const photoCleanup = setInterval(() => { try { wall.cleanup(); } catch { /* Retry next hour. */ } try { tasks.maintain(); } catch { /* Retry next hour; do not log private task data. */ } }, 3600000);
  photoCleanup.unref();
  let statusRunning = false, notificationStopped = false, statusWork;
  function checkNotificationStatus() {
    if (statusRunning || notificationStopped) return;
    statusRunning = true;
    statusWork = maintenance.status().then(status => { if (!notificationStopped) notifications.systemStatus(status); }).catch(() => {}).finally(() => { statusRunning = false; });
  }
  const notificationTick = setInterval(() => { syncNotifications(); notifications.flush().catch(() => {}); }, 30000); notificationTick.unref();
  const notificationStatusTick = setInterval(checkNotificationStatus, 5 * 60000); notificationStatusTick.unref();
  const close = async () => { notificationStopped = true; clearInterval(notificationTick); clearInterval(notificationStatusTick); await statusWork; await notifications.close(); clearInterval(photoCleanup); clearInterval(heartbeat); for (const client of clients) client.response.end(); server.closeIdleConnections(); await new Promise(resolve => server.close(resolve)); imports.close(); store.close(); };
  return {server, store, auth, imports, tasks, problems, wall, maintenance, notifications, close};
}
if (require.main === module) {
  process.umask(0o077);
  try {
    const hub = createHubServer({filename: process.env.HUB_DATABASE || '/var/lib/package-hub/hub.sqlite', publicOrigin: process.env.HUB_PUBLIC_ORIGIN || '', allowHttp: process.env.HUB_ALLOW_HTTP === 'true', maintenanceSocket: process.env.HUB_MAINTENANCE_SOCKET,
      notifications: {push: {privateKey: process.env.HUB_PUSH_PRIVATE_JWK, subject: process.env.HUB_PUSH_SUBJECT}},
      taskPhotos: {retentionMonths: Number(process.env.HUB_TASK_PHOTO_RETENTION_MONTHS || 6), limitBytes: Number(process.env.HUB_TASK_PHOTO_LIMIT_MB || 512) * 1024 * 1024}});
    hub.server.listen(Number(process.env.PORT || 3000), '0.0.0.0', () => console.log('Package Hub server started.'));
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => hub.close().then(() => process.exit(0)));
  } catch { console.error('Server startup failed. Check Node.js 24+, database permissions and HUB_PUBLIC_ORIGIN.'); process.exitCode = 1; }
}
module.exports = {createHubServer};
