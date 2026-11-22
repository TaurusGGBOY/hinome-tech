import '../public/resources.js';
import { editedFields, linkKey, receiptPattern, submission } from './fields.mjs';
import { checkPublication, runJobs } from './jobs.mjs';
import { digest, equal, query } from './security.mjs';

const minute = 60_000;
const builtInLinks = new Set(globalThis.RESOURCE_GROUPS.flatMap(({ items }) => items.map(({ url }) => linkKey(url))));

function ready(env) {
  return ['live', 'test'].includes(env.INTAKE_MODE) &&
    Boolean(env.PRIVATE_KEY && env.FEISHU_BRIDGE_URL && env.FEISHU_BRIDGE_TOKEN &&
      env.PUBLISH_TOKEN && env.AI);
}

function error(status, message) {
  return [status, { message }];
}

async function readJson(request) {
  if (!request.body || request.headers.get('Content-Type')?.split(';')[0] !== 'application/json') {
    throw new Error('invalid_body');
  }
  const chunks = [];
  let size = 0;
  const reader = request.body.getReader();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 8192) {
      await reader.cancel();
      throw new Error('invalid_body');
    }
    chunks.push(value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.length;
  }
  const data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body));
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('invalid_body');
  return data;
}

async function submit(env, body, ip, test = false) {
  let data;
  try {
    data = submission(body);
  } catch {
    return error(400, '请核对表单内容，资源链接须使用 HTTPS。每个标签最多 20 字，最多 6 个。');
  }
  const db = env.DB;
  const now = Date.now();
  const id = crypto.randomUUID();
  const key = linkKey(data.url);
  if (builtInLinks.has(key)) return error(409, '此资源链接已在目录中。');
  const network = await digest(env.PRIVATE_KEY, 'network:' + ip);
  try {
    await query(db, `INSERT INTO submissions
      (id, link_key, url, title, section, description, tags, ip_key, created, updated, next_at, test)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, key, data.url, data.title, data.section, data.description, JSON.stringify(data.tags),
    network, now, now, now, Number(test)).run();
  } catch (err) {
    if (/admission_limit|recipient_limit|backlog_limit/.test(err.message)) {
      return error(429, '近期投稿较多，请稍后再试。');
    }
    if (/UNIQUE.*submissions.link_key/i.test(err.message)) {
      return error(409, '此资源链接近期已提交或已有记录。');
    }
    throw err;
  }
  return [202, { id }];
}

async function publication(request, env, path) {
  if (!equal(request.headers.get('Authorization'), env.PUBLISH_TOKEN && 'Bearer ' + env.PUBLISH_TOKEN)) {
    return error(401, 'Unauthorized');
  }
  const db = env.DB;
  if (path === '/internal/test' && request.method === 'POST' && env.INTAKE_MODE === 'test' && ready(env)) {
    return submit(env, await readJson(request), 'operator-test', true);
  }
  if (path === '/internal/claim' && request.method === 'POST') {
    const now = Date.now();
    const row = await query(db, `UPDATE submissions SET publish_dispatch_at = ?
      WHERE id = (SELECT id FROM submissions WHERE state = 'publish' AND test = 0
        AND (publish_dispatch_at IS NULL OR publish_dispatch_at < ?)
        ORDER BY decided LIMIT 1)
      AND NOT EXISTS (SELECT 1 FROM submissions WHERE state = 'publish' AND publish_dispatch_at >= ?)
      RETURNING id`, now, now - 25 * minute, now - 25 * minute).first();
    return [200, { id: row?.id ?? null }];
  }
  const match = /^\/internal\/publication\/([^/]+)$/.exec(path);
  if (!match || !receiptPattern.test(match[1])) return error(404, 'Not found');
  const row = await query(db, `SELECT id, state, edited, url FROM submissions
    WHERE id = ? AND test = 0 AND state IN ('publish','deploy','published')`, match[1]).first();
  if (!row) return error(404, 'Not found');
  if (request.method === 'GET') {
    return [200, {
      id: row.id, state: row.state, url: row.url, ...editedFields(JSON.parse(row.edited)),
    }];
  }
  if (request.method === 'POST') {
    if (row.state === 'publish' && !await checkPublication(env, row)) {
      return error(409, 'Live catalog has not been verified');
    }
    const now = Date.now();
    await query(db, `UPDATE submissions SET state = 'deploy', next_at = ?, updated = ?
      WHERE id = ? AND state = 'publish'`, now, now, row.id).run();
    return [200, { accepted: true }];
  }
  return error(405, 'Method not allowed');
}

function publicStatus({ id, state, edited, public_reason }) {
  if (state === 'published') return { id, status: 'published', title: JSON.parse(edited).title };
  if (state === 'rejected') return { id, status: 'rejected', reason: public_reason };
  if (['edit', 'publish', 'deploy'].includes(state)) return { id, status: 'publishing' };
  return { id, status: 'pending' };
}

async function handle(request, env) {
  const path = new URL(request.url).pathname;
  if (path.startsWith('/internal/')) return publication(request, env, path);
  if (path === '/config' && request.method === 'GET') {
    return [200, { accepting: env.INTAKE_MODE === 'live' && ready(env) }];
  }
  const ip = request.headers.get('CF-Connecting-IP');
  if (!ip || !(await env.EDGE_LIMIT.limit({ key: ip })).success) {
    return error(429, '访问过于频繁，请稍后再试。');
  }
  if (request.method === 'GET' && path === '/results') {
    const { results } = await query(env.DB, `SELECT id, state, edited, public_reason FROM submissions
      WHERE test = 0 AND state IN ('published', 'rejected')
      ORDER BY decided DESC LIMIT 60`).all();
    return [200, { decisions: results.map(publicStatus) }];
  }
  const receipt = /^\/status\/([^/]+)$/.exec(path)?.[1];
  if (request.method === 'GET' && receiptPattern.test(receipt)) {
    const row = await query(env.DB, `SELECT id, state, edited, public_reason FROM submissions
      WHERE id = ? AND test = 0`, receipt).first();
    return row ? [200, publicStatus(row)] : error(404, '未找到此编号，请核对后重试。');
  }
  if (request.method !== 'POST' || path !== '/submit') {
    return error(404, '页面不存在。');
  }
  if (request.headers.get('Origin') !== env.SITE_ORIGIN) return error(403, '请从技术科网站提交。');
  if (env.INTAKE_MODE !== 'live' || !ready(env)) return error(503, '投稿暂未开放。');
  let body;
  try {
    body = await readJson(request);
  } catch {
    return error(400, '表单内容无效。');
  }
  return submit(env, body, ip);
}

export default {
  async fetch(request, env) {
    const headers = {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Type': 'application/json; charset=utf-8',
      Vary: 'Origin',
    };
    if (request.headers.get('Origin') === env.SITE_ORIGIN) {
      headers['Access-Control-Allow-Origin'] = env.SITE_ORIGIN;
      headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS';
      headers['Access-Control-Allow-Headers'] = 'Content-Type';
    }
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    try {
      const [status, body] = await handle(request, env);
      return new Response(JSON.stringify(body), { status, headers });
    } catch {
      // External responses and D1 error contexts may contain submitted data.
      return new Response(JSON.stringify({ message: '服务暂不可用，请稍后再试。' }), { status: 503, headers });
    }
  },
  scheduled(_controller, env, ctx) {
    if (env.PRIVATE_KEY) ctx.waitUntil(runJobs(env));
  },
};
