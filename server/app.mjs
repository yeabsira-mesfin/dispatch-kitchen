import { pathToFileURL } from 'node:url';
import { openStore, workflow, Problem } from './store.mjs';
import { serve, body, json } from './http.mjs';
export function createApp(store, options) {
  return serve(async (req, res, url) => {
    const path = url.pathname;
    if (req.method === 'GET' && path === '/api/health') return json(res, 200, { status: 'ok' });
    if (req.method === 'GET' && path === '/api/menu') return json(res, 200, store.menu());
    if (req.method === 'GET' && path === '/api/workflow') return json(res, 200, workflow);
    if (req.method === 'GET' && path === '/api/orders') return json(res, 200, store.orders());
    if (req.method === 'POST' && path === '/api/orders') {
      const result = store.place(await body(req), req.headers['idempotency-key']);
      return json(res, result.replayed ? 200 : 201, result);
    }
    const match = path.match(/^\/api\/orders\/([a-f0-9-]{36})$/);
    if (match && req.method === 'GET') return json(res, 200, store.get(match[1]));
    if (match && req.method === 'PATCH') return json(res, 200, store.transition(match[1], await body(req)));
    throw new Problem(404, 'Route not found.');
  }, options);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const store = openStore(process.env.DB_PATH ?? 'data/kitchen.db');
  const server = createApp(store);
  server.listen(Number(process.env.PORT ?? 3103), process.env.HOST ?? '127.0.0.1', () => console.log('Dispatch Kitchen listening on port', server.address().port));
  const stop = () => server.close(() => { store.close(); process.exit(0); });
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
}
