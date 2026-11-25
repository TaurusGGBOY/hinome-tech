import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { cardCallback, handleCardAction, sendReviewCard } from './feishu-cards.mjs';
import { bilibiliSource } from './bilibili.mjs';

const {
  BRIDGE_TOKEN, FEISHU_APP_ID, FEISHU_APP_SECRET, FEISHU_OWNER_OPEN_ID, PORT = 8080,
  FEISHU_CALLBACK_ENCRYPT_KEY, FEISHU_CALLBACK_VERIFICATION_TOKEN, CARD_WORKER_URL, CARD_WORKER_TOKEN,
} = process.env;
export const definition = '2DD082C8-B2EA-41A2-9406-F7557C17A2B2';
const base = 'https://open.feishu.cn/open-apis';
const approval = '/approval/v4';
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
let token;
let tokenExpires = 0;

class FeishuError extends Error {
  constructor(code) {
    super('Feishu API error');
    this.code = code;
  }
}

async function tenantToken() {
  if (tokenExpires > Date.now() && token) return token;
  const response = await fetch(base + '/auth/v3/tenant_access_token/internal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: FEISHU_APP_ID, app_secret: FEISHU_APP_SECRET }),
    redirect: 'error',
    signal: AbortSignal.timeout(6500),
  });
  const data = await response.json();
  if (!response.ok || data.code !== 0 || !data.tenant_access_token) {
    throw new FeishuError(data.code ?? response.status);
  }
  tokenExpires = Date.now() + Math.max(0, data.expire - 120) * 1000;
  token = data.tenant_access_token;
  return token;
}

async function feishuApi(path, body) {
  const authorization = 'Bearer ' + await tenantToken();
  const response = await fetch(base + path, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: authorization, 'Content-Type': 'application/json' },
    body: body && JSON.stringify(body),
    redirect: 'error',
    signal: AbortSignal.timeout(6500),
  });
  const data = await response.json();
  if (!response.ok || data.code !== 0) throw new FeishuError(data.code ?? response.status);
  return data.data;
}

const feishu = (path, body) => feishuApi(approval + path, body);

const fields = [
  ['title', 'resource_name', '资源名称'],
  ['url', 'source_url', '来源链接'],
  ['section', 'category', '分区'],
  ['description', 'summary', '资源简介'],
];

export function approvalForm(spec, recommendation) {
  const form = JSON.parse(spec.form);
  if (!Array.isArray(form)) throw new Error('Unexpected approval form');
  const used = new Set();
  return fields.map(([key, custom, name]) => {
    const matches = form.filter((entry) => entry.custom_id === custom || entry.name === name);
    if (matches.length !== 1) throw new Error('Unexpected approval field');
    const field = matches[0];
    if (used.has(field.id) || typeof field.id !== 'string' || !['input', 'textarea'].includes(field.type)) {
      throw new Error('Invalid approval field');
    }
    used.add(field.id);
    let value = recommendation[key];
    if (key === 'title' && recommendation.test) value = '【联调·不公开】' + value;
    if (key === 'description' && recommendation.tags.length) {
      value += '\n投稿标签：' + recommendation.tags.join('、');
    }
    return { id: field.id, type: field.type, value };
  });
}

export function approvalDecision(data, reviewer, instance) {
  if (typeof data.instance_code !== 'string' || data.instance_code.toLowerCase() !== instance.toLowerCase() ||
      data.approval_code !== definition || data.open_id !== reviewer || data.reverted === true) {
    throw new Error('Unexpected approval identity');
  }
  if (data.status === 'PENDING') return { status: 'pending' };
  const event = { APPROVED: 'PASS', REJECTED: 'REJECT' }[data.status];
  if (!event) throw new Error('Unexpected approval outcome');
  const tasks = new Set((data.task_list ?? [])
    .filter((task) => task.open_id === reviewer && task.status === data.status && task.id)
    .map((task) => String(task.id)));
  const matching = (data.timeline ?? []).filter((item) =>
    item.type === event && item.open_id === reviewer && tasks.has(String(item.task_id)));
  if (matching.length !== 1) throw new Error('Missing or ambiguous human decision');
  const { comment } = matching[0];
  if (comment != null && typeof comment !== 'string') {
    throw new Error('Invalid approval opinion');
  }
  return { status: data.status.toLowerCase(), opinion: comment?.trim() ? comment : '' };
}

export async function startApproval(api, openId, data) {
  if (!uuid.test(data.id) || typeof data.test !== 'boolean' || !Array.isArray(data.tags) ||
      data.tags.length > 6 || data.tags.some((tag) => typeof tag !== 'string' || tag.length > 20) ||
      fields.some(([key]) => typeof data[key] !== 'string' || !data[key] || data[key].length > 2048)) {
    throw new Error('Invalid approval request');
  }
  const spec = await api('/approvals/' + definition);
  const form = approvalForm(spec, data);
  try {
    const created = await api('/instances', {
      approval_code: definition, open_id: openId, uuid: data.id, form: JSON.stringify(form),
      allow_resubmit: false, allow_submit_again: false,
    });
    if (!uuid.test(created.instance_code)) throw new Error('Missing instance code');
    return { instance: created.instance_code };
  } catch (error) {
    if (error.code !== 60012 && error.code !== 1390012) throw error;
    const found = await api('/instances/' + data.id);
    if (found.approval_code !== definition || found.open_id !== openId || !uuid.test(found.instance_code)) {
      throw new Error('Mismatched existing instance');
    }
    return { instance: found.instance_code };
  }
}

function sameSecret(actual) {
  if (!BRIDGE_TOKEN || !actual) return false;
  const expected = Buffer.from('Bearer ' + BRIDGE_TOKEN);
  const received = Buffer.from(actual);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

async function rawBody(request, limit = 8192) {
  const body = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw new Error('Invalid body');
    body.push(chunk);
  }
  return Buffer.concat(body);
}

function reply(response, status, data) {
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(data));
}

async function bodyFrom(request) {
  return JSON.parse((await rawBody(request)).toString('utf8'));
}

async function dispatchCardAction(action) {
  if (!CARD_WORKER_URL || !CARD_WORKER_TOKEN) throw new Error('Card backend unavailable');
  const response = await fetch(new URL('/internal/card-action', CARD_WORKER_URL), {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + CARD_WORKER_TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify(action),
    redirect: 'error',
    signal: AbortSignal.timeout(2000),
  });
  if (!response.ok) throw new Error('Card backend unavailable');
  return response.json();
}

async function receiveCard(request, response) {
  if (!FEISHU_CALLBACK_ENCRYPT_KEY || !FEISHU_CALLBACK_VERIFICATION_TOKEN) {
    return reply(response, 503, { error: 'Callback unavailable' });
  }
  let body;
  try {
    body = await rawBody(request, 32_768);
  } catch {
    return reply(response, 400, { error: 'Invalid callback body' });
  }
  const action = cardCallback(body, request.headers, {
    encryptKey: FEISHU_CALLBACK_ENCRYPT_KEY,
    verificationToken: FEISHU_CALLBACK_VERIFICATION_TOKEN,
    appId: FEISHU_APP_ID,
    owner: FEISHU_OWNER_OPEN_ID,
  }, Date.now(), (reason) => console.warn('Feishu card callback rejected:', reason));
  if (!action) return reply(response, 403, { error: 'Invalid callback' });
  try {
    return reply(response, 200, await handleCardAction(action, dispatchCardAction));
  } catch {
    return reply(response, 200, { toast: { type: 'warning', content: '暂时无法确认本次操作，请再次点击查看最新状态。' } });
  }
}

export const server = http.createServer(async (request, response) => {
  if (request.url === '/health' && request.method === 'GET') return reply(response, 200, { alive: true });
  if (request.url === '/feishu/card-callback' && request.method === 'POST') return receiveCard(request, response);
  if (!sameSecret(request.headers.authorization)) return reply(response, 401, { error: 'Unauthorized' });
  if (request.method === 'POST' && request.url === '/sources/bilibili') {
    try {
      return reply(response, 200, await bilibiliSource(await bodyFrom(request)));
    } catch {
      return reply(response, 503, { error: 'Bilibili source unavailable' });
    }
  }
  try {
    if (request.method === 'POST' && request.url === '/cards') {
      if (![FEISHU_CALLBACK_ENCRYPT_KEY, FEISHU_CALLBACK_VERIFICATION_TOKEN, CARD_WORKER_URL, CARD_WORKER_TOKEN].every(Boolean)) {
        return reply(response, 503, { error: 'Card delivery unavailable' });
      }
      return reply(response, 200, await sendReviewCard(feishuApi, FEISHU_OWNER_OPEN_ID, await bodyFrom(request)));
    }
    if (request.method === 'POST' && request.url === '/approvals') {
      return reply(response, 200, await startApproval(feishu, FEISHU_OWNER_OPEN_ID, await bodyFrom(request)));
    }
    const instance = /^\/approvals\/([^/?]+)$/.exec(request.url)?.[1];
    if (request.method === 'GET' && instance && uuid.test(instance)) {
      const data = await feishu('/instances/' + instance);
      return reply(response, 200, approvalDecision(data, FEISHU_OWNER_OPEN_ID, instance));
    }
    return reply(response, 404, { error: 'Not found' });
  } catch (error) {
    console.warn('Feishu operation failed', Number.isInteger(error.code) ? error.code : 'invalid_result');
    return reply(response, 503, { error: 'Approval temporarily unavailable' });
  }
});

if (process.argv[1] && import.meta.url === new URL('file://' + process.argv[1]).href) {
  if (![BRIDGE_TOKEN, FEISHU_APP_ID, FEISHU_APP_SECRET, FEISHU_OWNER_OPEN_ID].every(Boolean)) {
    throw new Error('Missing bridge configuration');
  }
  server.listen(Number(PORT), '0.0.0.0');
}
