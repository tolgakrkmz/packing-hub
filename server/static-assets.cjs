/* Only the already-approved source map enters this cache. No files or API data. */
const {createHash} = require('node:crypto');
const {gzipSync,brotliCompressSync,constants} = require('node:zlib');
const {problem} = require('./store.cjs');
const mutable = name => name.endsWith('.html') || ['/manifest.webmanifest','/js/notification-worker.js'].includes(name);
function selectEncoding(header,variants) {
  if (!header?.trim()) return 'identity';
  const values = new Map();
  for (const part of header.split(',')) {
    const [name,...params] = part.trim().toLowerCase().split(/\s*;\s*/);
    const q = params.length ? params.length === 1 && /^q=(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/.test(params[0]) ? Number(params[0].slice(2)) : 0 : 1;
    values.set(name,values.has(name) ? Math.min(values.get(name),q) : q);
  }
  // Implicit identity is a fallback; an explicit preference competes with codings.
  const quality = name => name === 'identity' ? values.get(name) ?? (values.get('*') === 0 ? 0 : 0.001)
    : values.get(name) ?? values.get('*') ?? 0;
  const accepted = ['br','gzip','identity'].filter(name => variants.has(name) && quality(name) > 0);
  return accepted.sort((a,b) => quality(b)-quality(a))[0];
}
function createStaticAssets(sources,{transformHTML = (name,html) => html} = {}) {
  const hash = createHash('sha256');
  for (const [name,body] of [...sources].sort(([a],[b]) => a < b ? -1 : a > b ? 1 : 0)) hash.update(name).update('\0').update(body).update('\0');
  const version = hash.digest('hex').slice(0,12), prepared = new Map();
  function assetURL(source,base = '/') {
    const url = new URL(source,'http://static.invalid'+base);
    if (url.origin !== 'http://static.invalid' || !sources.has(url.pathname) || mutable(url.pathname)) return source;
    url.searchParams.set('v',version); return url.pathname+url.search+url.hash;
  }
  for (const [name,source] of sources) {
    const html = name.endsWith('.html');
    let body = source;
    if (html) body = Buffer.from(transformHTML(name,source.toString('utf8')).replace(/\b(src|href)="([^"]+)"/g,(match,key,url) => `${key}="${assetURL(url,name)}"`));
    if (name === '/manifest.webmanifest') {
      const manifest = JSON.parse(source.toString('utf8'));
      for (const icon of manifest.icons || []) icon.src = assetURL(icon.src,name);
      body = Buffer.from(JSON.stringify(manifest));
    }
    if (name.endsWith('.css')) body = Buffer.from(source.toString('utf8').replace(/url\(\s*(["']?)([^"'()]+)\1\s*\)/g,(match,quote,url) => `url(${quote}${assetURL(url,name)}${quote})`));
    const contentType = name === '/manifest.webmanifest' ? 'application/manifest+json' : name.endsWith('.js') ? 'text/javascript'
      : name.endsWith('.css') ? 'text/css' : name.endsWith('.png') ? 'image/png' : name.endsWith('.svg') ? 'image/svg+xml' : 'text/html';
    const variants = new Map([['identity',body]]);
    if (contentType !== 'image/png' && body.length >= 256) {
      for (const [encoding,compress] of [['gzip',value => gzipSync(value,{level:6})],['br',value => brotliCompressSync(value,{params:{[constants.BROTLI_PARAM_QUALITY]:5}})]]) {
        const compressed = compress(body); if (compressed.length < body.length) variants.set(encoding,compressed);
      }
    }
    prepared.set(name,{html,variants,contentType:contentType+(contentType === 'image/png' ? '' : '; charset=utf-8'),
      etags:new Map([...variants].map(([encoding,value]) => [encoding,'"'+createHash('sha256').update(value).digest('hex')+'"']))});
  }
  function send(name,request,response,status = 200) {
    const asset = prepared.get(name); if (!asset) throw problem(404,'NOT_FOUND');
    const encoding = selectEncoding(request.headers['accept-encoding'],asset.variants);
    if (!encoding) throw problem(406,'ENCODING_REJECTED');
    const url = new URL(request.url,'http://static.invalid');
    const versioned = !mutable(name) && url.searchParams.size === 1 && url.searchParams.get('v') === version;
    const headers = {'Content-Type':asset.contentType,'Cache-Control':asset.html ? 'no-store' : versioned ? 'public, max-age=31536000, immutable' : 'public, no-cache',Vary:'Accept-Encoding'};
    if (encoding !== 'identity') headers['Content-Encoding'] = encoding;
    if (!asset.html) headers.ETag = asset.etags.get(encoding);
    if (name === '/js/notification-worker.js') headers['Service-Worker-Allowed'] = '/';
    const tag = request.headers['if-none-match'];
    if (!asset.html && tag?.split(',').some(value => value.trim() === '*' || value.trim().replace(/^W\//,'') === headers.ETag)) {
      response.writeHead(304,headers); response.end(); return 304;
    }
    const body = asset.variants.get(encoding); headers['Content-Length'] = body.length;
    response.writeHead(status,headers); response.end(request.method === 'HEAD' ? undefined : body); return status;
  }
  return {version,assetURL,send};
}
module.exports = {createStaticAssets,selectEncoding};
