/**
 * 로컬/자체 서버 실행기: node server/dev-server.js
 * - GET /            → index.html (같은 출처라 CORS 설정이 필요 없음)
 * - GET /api/*       → handler.js (키는 .env 또는 환경 변수)
 */
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { handleApi } from './handler.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function loadEnvFile() {
  const file = join(root, '.env');
  if (!existsSync(file)) return;
  readFileSync(file, 'utf8').split(/\r?\n/).forEach(line => {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !line.trim().startsWith('#') && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  });
}
loadEnvFile();

const port = Number(process.env.PORT || 8787);
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
    if (url.pathname.startsWith('/api/')) {
      const headers = new Headers();
      Object.entries(req.headers).forEach(([k, v]) => { if (typeof v === 'string') headers.set(k, v); });
      const out = await handleApi(new Request(url, { method: req.method, headers }), process.env);
      res.writeHead(out.status, Object.fromEntries(out.headers));
      res.end(Buffer.from(await out.arrayBuffer()));
      return;
    }
    if (url.pathname === '/' || url.pathname === '/index.html') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(readFileSync(join(root, 'index.html')));
      return;
    }
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); res.end('Not found');
  } catch (e) {
    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' }); res.end(String(e && e.message || e));
  }
});
server.listen(port, () => console.log('adclover report server: http://localhost:' + port + '  (health: /api/health)'));
