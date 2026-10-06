import http from 'node:http';
import { createLabServer } from '../lab/server.mjs';
import { createCloudPersistence } from './store.mjs';

const errorResult = error => ({ status: error.status || 503, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }, body: JSON.stringify({ error: error.status ? error.message : 'CLOUD_ENGINE_UNAVAILABLE' }) });

// Caller must verify the invited, authenticated user before invoking this server-only adapter.
export async function executeApi(apiPath, method = 'GET', body, options = {}) {
  if (!['GET', 'POST'].includes(method) || typeof apiPath !== 'string' || !/^\/api\/(state|health|tasks(?:\/task_[a-zA-Z0-9-]+\/(resume|approval))?|artifacts\/artifact_[a-zA-Z0-9-]+|receipts\/receipt_[a-zA-Z0-9-]+)$/.test(apiPath)) return errorResult(Object.assign(new Error('API_PATH_NOT_ALLOWED'), { status: 404 }));
  let app;
  let response;
  try {
    const persistence = options.persistence || createCloudPersistence(options);
    app = await createLabServer({ ...persistence, runtimeMode: 'cloud', stageDelayMs: 0 });
    await new Promise((resolve, reject) => { app.server.once('error', reject); app.server.listen(0, '127.0.0.1', resolve); });
    const port = app.server.address().port;
    response = await new Promise((resolve, reject) => {
      const content = method === 'POST' ? JSON.stringify(body ?? {}) : undefined;
      const req = http.request({ hostname: '127.0.0.1', port, path: apiPath, method, headers: { Host: `127.0.0.1:${port}`, ...(content === undefined ? {} : { 'content-type': 'application/json', 'content-length': Buffer.byteLength(content) }) }, timeout: 30000 }, res => {
        const chunks = []; let bytes = 0;
        res.on('data', chunk => { bytes += chunk.length; if (bytes > 2000000) res.destroy(new Error('ENGINE_RESPONSE_TOO_LARGE')); else chunks.push(chunk); });
        res.on('error', reject); res.on('end', () => resolve({ status: res.statusCode, headers: { 'content-type': res.headers['content-type'] || 'application/json', 'cache-control': 'no-store', ...(res.headers['content-disposition'] ? { 'content-disposition': res.headers['content-disposition'] } : {}) }, body: Buffer.concat(chunks).toString('utf8') }));
      });
      req.on('timeout', () => req.destroy(new Error('ENGINE_REQUEST_TIMEOUT'))); req.on('error', reject);
      if (content !== undefined) req.write(content); req.end();
    });
    await app.whenIdle();
    if (method === 'POST' && response.status < 400) {
      const accepted = JSON.parse(response.body);
      if (accepted.task?.id) accepted.task = app.stateView().tasks.find(task => task.id === accepted.task.id) || accepted.task;
      response.body = JSON.stringify(accepted);
    }
  } catch (error) { response = errorResult(error); }
  finally { if (app) { try { await app.close(); } catch (error) { response = errorResult(error); } } }
  return response;
}

export function createEngineAdapter(options = {}) { return { executeApi: (apiPath, method, body) => executeApi(apiPath, method, body, options) }; }
