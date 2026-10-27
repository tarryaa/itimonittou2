// Production-build fixture. No test endpoints are copied to dist or deployed.
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
const root = path.resolve('dist');
const prefix = '/itimonittou/';
let revision = 0;
const types = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.json':'application/json; charset=utf-8', '.webmanifest':'application/manifest+json', '.png':'image/png', '.svg':'image/svg+xml' };
const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1:4174');
  if (url.pathname === '/__test__/revision' && request.method === 'POST') {
    revision = Number(url.searchParams.get('value')) || 0;
    response.writeHead(200, { 'content-type':'text/plain' }).end(String(revision));
    return;
  }
  if (!url.pathname.startsWith(prefix)) { response.writeHead(404).end(); return; }
  let relative;
  try { relative = decodeURIComponent(url.pathname.slice(prefix.length)) || 'index.html'; }
  catch { response.writeHead(400).end(); return; }
  const target = path.resolve(root, relative);
  if (target !== root && !target.startsWith(root + path.sep)) { response.writeHead(403).end(); return; }
  try {
    if (!(await stat(target)).isFile()) throw new Error('not a file');
    let contents = await readFile(target);
    if (relative === 'sw.js') {
      contents = Buffer.from(contents.toString().replace(/const VERSION = '([^']+)'/, (_, version) => `const VERSION = '${version}-test${revision}'`));
    }
    response.writeHead(200, { 'content-type':types[path.extname(target)] || 'application/octet-stream', 'cache-control':'no-store' });
    response.end(contents);
  } catch { response.writeHead(404).end(); }
});
server.listen(4174, '127.0.0.1', () => console.log('PWA production fixture: http://127.0.0.1:4174/itimonittou/'));
process.on('SIGTERM', () => server.close());
