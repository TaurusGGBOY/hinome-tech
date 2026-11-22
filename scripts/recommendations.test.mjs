import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import worker from '../worker/index.mjs';
import { generateEntry, runJobs } from '../worker/jobs.mjs';
import { approvalDecision, approvalForm, startApproval, definition } from '../bridge/server.mjs';

const origin = 'https://hinome-tech.pages.dev';
const testTime = 1_800_000_000_000;
const owner = 'ou_test_owner';
const migration = ['0001_recommendations.sql', '0002_published_updates.sql']
  .map((name) => fs.readFileSync(new URL('../worker/migrations/' + name, import.meta.url), 'utf8')).join('\n');
const proposed = {
  title: '待审核素材',
  url: 'https://example.org/talk',
  section: '亲历回顾',
  description: '原始投稿介绍',
  tags: ['直播数据', '弹幕'],
};
const modelFields = { title: '站长确认的目录标题', description: '编辑后的目录介绍。', section: '影像档案' };
const edit = { ...modelFields, tags: proposed.tags };

function fixture() {
  const sql = new DatabaseSync(':memory:');
  sql.exec(migration);
  const env = {
    SITE_ORIGIN: origin, INTAKE_MODE: 'live',
    PRIVATE_KEY: 'unit-test-key', PUBLISH_TOKEN: 'unit-test-publish-token',
    FEISHU_BRIDGE_URL: 'https://approval.example.org', FEISHU_BRIDGE_TOKEN: 'unit-test-bridge-token',
    EDGE_LIMIT: { limit: async () => ({ success: true }) },
    DB: {
      prepare: (statement) => ({
        bind: (...args) => ({
          first: async () => sql.prepare(statement).get(...args),
          all: async () => ({ results: sql.prepare(statement).all(...args) }),
          run: async () => sql.prepare(statement).run(...args),
        }),
      }),
    },
  };
  const request = async (path, body, options = {}) => {
    const response = await worker.fetch(new Request('https://api.example.org' + path, {
      method: options.method ?? (body ? 'POST' : 'GET'),
      headers: {
        Origin: options.origin ?? origin,
        'CF-Connecting-IP': options.ip ?? '192.0.2.1',
        'Content-Type': 'application/json',
        ...(options.internal ? { Authorization: 'Bearer ' + env.PUBLISH_TOKEN } : {}),
      },
      body: body && JSON.stringify(body),
    }), env);
    return { status: response.status, body: await response.json() };
  };
  return { sql, env, request };
}

test('hard intake quotas remain atomic for concurrent requests', async (t) => {
  const { sql, env, request } = fixture();
  t.mock.method(Date, 'now', () => testTime);
  env.AI = {};
  assert.equal((await request('/submit', { ...proposed, url: 'http://example.org' })).status, 400);
  assert.equal((await request('/submit', proposed, { origin: 'https://another.example.org' })).status, 403);
  assert.equal((await request('/submit', { ...proposed, url: 'https://best-hinome.pages.dev/?utm_source=mirror' })).status, 409);
  assert.equal((await request('/submit', { ...proposed, tags: ['自造标签'] })).status, 400);
  assert.equal((await request('/submit', { ...proposed, tags: '直播数据' })).status, 400);
  const a = await request('/submit', proposed);
  assert.equal(a.status, 202);
  assert.equal((await request('/submit', { ...proposed, url: proposed.url + '/?utm_content=a' })).status, 409);
  const concurrent = await Promise.all(Array.from({ length: 12 }, (_, index) =>
    request('/submit', { ...proposed, url: proposed.url + index }, { ip: '192.0.2.' + (index + 1) })));
  assert.equal(concurrent.filter(({ status }) => status === 202).length, 4);
  assert.equal(concurrent.filter(({ status }) => status === 429).length, 8);
  assert.equal(sql.prepare('SELECT count(*) AS n FROM submissions').get().n, 5);
  env.EDGE_LIMIT.limit = async () => ({ success: false });
  assert.equal((await request('/submit', proposed)).status, 429);
});

test('day cap, per-network cap and backlog cap are durable', () => {
  const { sql } = fixture();
  const add = sql.prepare(`INSERT INTO submissions (id, link_key, url, title, section,
    description, tags, ip_key, created, updated, next_at) VALUES (?, ?, ?, ?, ?, ?, '[]', ?, ?, ?, ?)`);
  const insert = (i, now, ip) => add.run(String(i), String(i), proposed.url, proposed.title,
    proposed.section, proposed.description, ip ?? String(i), now, now, now);
  for (let i = 0; i < 30; i++) insert(i, testTime + i * 360_001);
  assert.throws(() => insert(30, testTime + 30 * 360_001), /admission_limit/);
  for (let i = 0; i < 5; i++) insert(100 + i, testTime + 86400000 + i * 360_001, 'same');
  assert.throws(() => insert(105, testTime + 86400000 + 5 * 360_001, 'same'), /network_limit|recipient_limit/);
  for (let i = 0; i < 65; i++) insert(200 + i, testTime + (i + 2) * 86400000);
  assert.throws(() => insert(400, testTime + 70 * 86400000), /backlog_limit/);
});

test('real decision field flows separately into an allowlisted edit and awaits verified publication', async (t) => {
  const { sql, env, request } = fixture();
  const opinion = '换成影像档案，简介补足实际内容。';
  let entry;
  let prompt;
  let resultFromFeishu = { status: 'pending' };
  env.AI = { run: async (_model, input) => {
    prompt = JSON.parse(input.messages[1].content);
    return { response: modelFields };
  }};
  t.mock.method(globalThis, 'fetch', async (input, options) => {
    const url = new URL(input);
    if (url.href === env.FEISHU_BRIDGE_URL + '/approvals') {
      assert.equal(options.redirect, 'manual');
      assert.equal(JSON.parse(options.body).description, proposed.description);
      assert.equal(Object.hasOwn(JSON.parse(options.body), 'ip_key'), false);
      return Response.json({ instance: '096ba37a-0936-4c6a-8213-5b1d4e9b8001' });
    }
    if (url.host === 'approval.example.org') return Response.json(resultFromFeishu);
    assert.equal(url.origin, origin);
    return new Response('window.HINOME_RECOMMENDATIONS = ' + JSON.stringify(entry ? [entry] : []) + ';\n');
  });
  const submitted = await request('/submit', proposed);
  const id = sql.prepare('SELECT id FROM submissions').get().id;
  assert.equal(submitted.status, 202);
  assert.deepEqual(submitted.body, { accepted: true });
  await runJobs(env);
  assert.equal(sql.prepare('SELECT state FROM submissions').get().state, 'review');
  resultFromFeishu = { status: 'approved', opinion };
  sql.exec('UPDATE submissions SET next_at = 0');
  await runJobs(env);
  assert.equal(prompt.站长编辑意见, opinion);
  assert.equal(prompt.投稿原文.简介, proposed.description);
  assert.deepEqual((await request('/updates')).body, { updates: [], next: null });
  assert.equal((await request('/internal/claim', {}, { internal: false })).status, 401);
  assert.deepEqual((await request('/internal/claim', null, { internal: true, method: 'POST' })).body, { id });
  const data = (await request('/internal/publication/' + id, null, { internal: true })).body;
  assert.deepEqual(data, { id, state: 'publish', url: proposed.url, ...edit });
  assert.equal((await request('/internal/publication/' + id, {}, { internal: true })).status, 409);
  entry = { id, url: proposed.url, ...edit };
  assert.equal((await request('/internal/publication/' + id, {}, { internal: true })).status, 200);
  await runJobs(env);
  const { published } = sql.prepare('SELECT published FROM submissions').get();
  assert.deepEqual((await request('/updates')).body, {
    updates: [{ ...modelFields, url: proposed.url, published }], next: null,
  });
});

test('rejection, pending and tests are private, and old public routes are gone', async (t) => {
  const { sql, env, request } = fixture();
  env.AI = {};
  env.INTAKE_MODE = 'test';
  assert.equal((await request('/submit', proposed)).status, 503);
  const internal = await request('/internal/test', proposed, { internal: true });
  assert.equal(internal.status, 202);
  env.INTAKE_MODE = 'live';
  const live = await request('/submit', { ...proposed, url: proposed.url + '2', tags: [] });
  assert.equal(live.status, 202);
  t.mock.method(globalThis, 'fetch', async () => Response.json({
    status: 'rejected', opinion: '内部审批意见。',
  }));
  sql.exec("UPDATE submissions SET state = 'review', approval_id = id");
  await runJobs(env);
  assert.equal(sql.prepare("SELECT count(*) AS n FROM submissions WHERE state='rejected'").get().n, 2);
  const id = sql.prepare('SELECT id FROM submissions WHERE test = 0').get().id;
  assert.equal((await request('/results')).status, 404);
  assert.equal((await request('/status/' + id)).status, 404);
  assert.equal((await request('/status/' + internal.body.id)).status, 404);
  assert.deepEqual((await request('/updates')).body, { updates: [], next: null });
});

test('updates contain only live publications and paginate newest first', async (t) => {
  const { sql, env, request } = fixture();
  t.mock.method(Date, 'now', () => testTime);
  env.AI = {};
  const insert = sql.prepare(`INSERT INTO submissions (id, link_key, url, title, section, description,
    tags, ip_key, created, updated, next_at, state, test, edited, published)
    VALUES (?, ?, ?, ?, ?, ?, '[]', ?, ?, ?, ?, ?, ?, ?, ?)`);
  const add = (n, status = 'published', internal = 0, published = testTime + n) =>
    insert.run(crypto.randomUUID(), String(n), proposed.url + n, proposed.title,
      proposed.section, proposed.description, String(n), testTime - 4_000_000_000 + 120_000_000 * n,
      testTime, testTime, status, internal, JSON.stringify(edit), published);
  for (let i = 1; i <= 22; i++) add(i);
  add(23, 'published', 1);
  add(24, 'rejected');
  add(25, 'review');
  add(26, 'deploy');
  add(27, 'published', 0, null);
  const first = (await request('/updates')).body;
  assert.equal(first.updates.length, 20);
  assert.equal(first.updates[0].published, testTime + 22);
  assert.equal(first.updates.at(-1).published, testTime + 3);
  const second = (await request('/updates?before=' + encodeURIComponent(first.next))).body;
  assert.deepEqual(second.updates.map((entry) => entry.published), [testTime + 2, testTime + 1]);
  assert.equal(second.next, null);
});

test('edited content preserves selected catalog tags without delegating them to the model', async () => {
  const row = { ...proposed, opinion: '请补充用途。', tags: JSON.stringify([...proposed.tags, '旧自由标签']) };
  const env = { AI: { run: async () => ({ response: modelFields }) } };
  assert.deepEqual(await generateEntry(env, row), edit);
  env.AI.run = async () => ({ response: { ...modelFields, tags: ['模型自造标签'] } });
  await assert.rejects(generateEntry(env, row), /invalid_edit/);
});

test('Feishu maps dynamic fields, recovers duplicate instance and requires the owner’s matching decision node', async () => {
  const fields = ['资源名称', '来源链接', '分区', '资源简介'];
  const spec = { form: JSON.stringify(fields.map((name, i) => ({ type: 'input', name, id: 'new-' + i }))) };
  const candidate = { ...proposed, test: true, tags: ['回顾'], id: crypto.randomUUID() };
  const form = approvalForm(spec, candidate);
  assert.deepEqual(form.map(({ id }) => id), ['new-0', 'new-1', 'new-2', 'new-3']);
  assert.match(form[0].value, /^【联调·不公开】/);
  const instance = crypto.randomUUID();
  const approval = { instance_code: instance, approval_code: definition, open_id: owner };
  const recovered = await startApproval(async (path) => {
    if (path.startsWith('/approvals/')) return spec;
    if (path === '/instances') throw Object.assign(new Error('duplicate'), { code: 60012 });
    assert.equal(path, '/instances/' + candidate.id);
    return approval;
  }, owner, candidate);
  assert.deepEqual(recovered, { instance });
  const decision = { ...approval,
    status: 'APPROVED', task_list: [{ open_id: owner, status: 'APPROVED', id: 'matching-task' }],
    timeline: [{ type: 'PASS', task_id: 'matching-task', open_id: owner, comment: ' 很有精神 ' }],
  };
  assert.deepEqual(approvalDecision(decision, owner), { status: 'approved', opinion: ' 很有精神 ' });
  assert.throws(() => approvalDecision({ ...decision, timeline: [{ type: 'PASS', comment: '自动通过' }] }, owner));
});
