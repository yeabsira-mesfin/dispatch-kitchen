import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export async function body(req) {
  if (!req.headers['content-type']?.startsWith('application/json')) throw new HttpError(415, 'Use application/json.');
  let size = 0; const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 32768) throw new HttpError(413, 'Request too large.');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString()); }
  catch { throw new HttpError(400, 'Invalid JSON.'); }
}
export function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}
export function serve(route, { staticDir = 'dist', appOrigin = process.env.APP_ORIGIN } = {}) {
  const root = resolve(staticDir);
  return createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    try {
      const url = new URL(req.url, 'http://localhost');
      const host = new URL(`http://${req.headers.host}`).hostname;
      const allowedHost = appOrigin ? new URL(appOrigin).hostname : null;
      if (!['localhost', '127.0.0.1', '[::1]', allowedHost].includes(host)) throw new HttpError(403, 'Host not allowed.');
      if (req.headers.origin) {
        const origin = new URL(req.headers.origin);
        if (appOrigin ? origin.origin !== appOrigin : !['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname))
          throw new HttpError(403, 'Origin not allowed.');
      }
      if (url.pathname.startsWith('/api/')) return await route(req, res, url);
      if (!['GET', 'HEAD'].includes(req.method)) throw new HttpError(405, 'Method not allowed.');
      const file = resolve(root, `.${decodeURIComponent(url.pathname)}`);
      if (file !== root && !file.startsWith(root + sep)) throw new HttpError(404, 'Not found.');
      const ext = extname(file);
      const mime = { '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.html': 'text/html', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp' };
      const data = await readFile(ext ? file : resolve(root, 'index.html'));
      res.writeHead(200, { 'Content-Type': mime[ext] ?? (ext ? 'application/octet-stream' : 'text/html') });
      res.end(req.method === 'HEAD' ? undefined : data);
    } catch (error) {
      const status = error.status ?? (error.code === 'ENOENT' ? 404 : 500);
      if (status === 500) console.error(error);
      json(res, status, { error: status === 500 ? 'Unexpected server error.' : error.message });
    }
  });
}
