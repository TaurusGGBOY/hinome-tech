import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import test from 'node:test';
import worker from '../worker/index.mjs';
import { generateEntry, runJobs } from '../worker/jobs.mjs';
import { approvalDecision, approvalForm, startApproval, definition } from '../bridge/server.mjs';
import { cardCallback, handleCardAction, reviewCard, sendReviewCard } from '../bridge/feishu-cards.mjs';
import { bilibiliSource } from '../bridge/bilibili.mjs';

const origin = 'https://hinome-tech.pages.dev';
const testTime = 1_800_000_000_000;
const owner = 'ou_test_owner';
const migration = ['0001_recommendations.sql', '0002_published_updates.sql', '0003_review_cards.sql']
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
const sourceText = '这份回顾整理了活动的筹备经过、现场流程和三位观众的采访。正文依次介绍了节目单、现场布置和演出结束后的观众交流，并附有活动照片及对应时间。末尾补充了参与者对节目编排的印象。';

test('automatic collection adds a single version and resource, including on retry', (t) => {
  const directory = fs.mkdtempSync(join(tmpdir(), 'hinome-tech-release-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.mkdirSync(join(directory, 'public'));
  for (const file of ['recommendations.js', 'resources.js', 'releases.json']) {
    fs.copyFileSync(new URL('../public/' + file, import.meta.url), join(directory, 'public', file));
  }
  const notes = join(directory, 'public/releases.json');
  const originalReleases = JSON.parse(fs.readFileSync(notes, 'utf8'));
  const packet = join(directory, 'packet.json');
  fs.writeFileSync(packet, JSON.stringify({
    id: '223e4567-e89b-42d3-a456-556642440000', state: 'publish', url: proposed.url, ...edit,
  }));
  const updater = fileURLToPath(new URL('./update-recommendation.mjs', import.meta.url));
  const update = () => execFileSync(process.execPath, [updater, packet], { cwd: directory, encoding: 'utf8' }).trim();
  const version = update();
  const [major, minor, patch] = originalReleases[0].version.split('.');
  assert.equal(version, `${major}.${minor}.${Number(patch) + 1}`);
  const added = JSON.parse(fs.readFileSync(notes, 'utf8'));
  assert.equal(added[0].version, version);
  assert.match(added[0].date, /^\d{4}-\d{2}-\d{2}$/);
  assert.deepEqual(added[0].resources, [{ url: proposed.url, ...modelFields }]);
  assert.deepEqual(added.slice(1), originalReleases);
  const catalog = join(directory, 'public/recommendations.js');
  const published = fs.readFileSync(catalog, 'utf8');
  assert(published.includes(proposed.url));
  assert.equal(update(), version);
  assert.deepEqual(JSON.parse(fs.readFileSync(notes, 'utf8')), added);
  assert.equal(fs.readFileSync(catalog, 'utf8'), published);
});

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
        ...(options.bridge ? { Authorization: 'Bearer ' + env.FEISHU_BRIDGE_TOKEN } : {}),
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
    if (url.href === proposed.url) return new Response(sourceText);
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
  assert.equal(prompt.资源内容.text, sourceText);
  assert(!JSON.stringify(prompt).includes(proposed.description));
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

test('the scheduled retry recovers an already-approved submission without an opinion', async (t) => {
  const { sql, env, request } = fixture();
  let now = testTime;
  t.mock.method(Date, 'now', () => now);
  const approvalId = crypto.randomUUID();
  let response = new Response(null, { status: 503 });
  let editorialInput;
  let attempts = 0;
  env.AI = { run: async (_model, input) => {
    editorialInput = JSON.parse(input.messages[1].content);
    assert.match(input.messages[0].content, /事实须有资源内容支持/);
    return { response: modelFields };
  }};
  t.mock.method(globalThis, 'fetch', async (input, options) => {
    if (String(input) === proposed.url) return new Response(sourceText);
    if (options.method === 'POST') return Response.json({ instance: approvalId });
    assert.equal(new URL(input).pathname, '/approvals/' + approvalId);
    attempts++;
    return response.clone();
  });
  assert.equal((await request('/submit', proposed)).status, 202);
  await runJobs(env);
  const row = () => sql.prepare('SELECT state, next_at, last_error, opinion FROM submissions').get();
  assert.equal(row().state, 'review');
  assert.equal(row().last_error, 'retry_review:feishu_http_503');

  response = Response.json({ status: 'approved' });
  now = row().next_at - 1;
  await runJobs(env);
  assert.equal(attempts, 1);
  assert.equal(row().state, 'review');

  now++;
  await runJobs(env);
  assert.equal(attempts, 2);
  assert.equal(row().state, 'publish');
  assert.equal(row().opinion, '');
  assert.equal(row().last_error, null);
  assert.equal(Object.hasOwn(editorialInput, '站长编辑意见'), false);
  assert.equal(editorialInput.资源内容.text, sourceText);
});

test('rejection, pending and tests are private, and old public routes are gone', async (t) => {
  const { sql, env, request } = fixture();
  env.AI = { run: async () => { assert.fail('Rejected submissions must not reach editing'); } };
  env.INTAKE_MODE = 'test';
  assert.equal((await request('/submit', proposed)).status, 503);
  const internal = await request('/internal/test', proposed, { internal: true });
  assert.equal(internal.status, 202);
  env.INTAKE_MODE = 'live';
  const live = await request('/submit', { ...proposed, url: proposed.url + '2', tags: [] });
  assert.equal(live.status, 202);
  t.mock.method(globalThis, 'fetch', async (input) => Response.json({
    status: 'rejected',
    opinion: new URL(input).pathname.endsWith(internal.body.id) ? '内部审批意见。' : ' \n  ',
  }));
  sql.exec("UPDATE submissions SET state = 'review', approval_id = id");
  await runJobs(env);
  assert.equal(sql.prepare("SELECT count(*) AS n FROM submissions WHERE state='rejected'").get().n, 2);
  assert.equal(sql.prepare('SELECT opinion FROM submissions WHERE test=0').get().opinion, '');
  assert.equal(sql.prepare('SELECT opinion FROM submissions WHERE test=1').get().opinion, '内部审批意见。');
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

test('edited content preserves selected tags and validates a short description', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response(sourceText));
  const row = { ...proposed, opinion: '请补充用途。', tags: JSON.stringify([...proposed.tags, '旧自由标签']) };
  const env = { AI: { run: async () => ({ response: modelFields }) } };
  assert.deepEqual(await generateEntry(env, row), edit);
  env.AI.run = async () => ({ response: { ...modelFields, tags: ['模型自造标签'] } });
  await assert.rejects(generateEntry(env, row), /invalid_edit/);
  env.AI.run = async () => ({ response: { ...modelFields, description: '第一句。第二句。第三句。' } });
  await assert.rejects(generateEntry(env, row), /brief_invalid/);
  env.AI.run = async () => ({ response: { ...modelFields, description: '演出记录'.repeat(12) } });
  await assert.rejects(generateEntry(env, row), /brief_invalid/);
});

test('an unverified source stays in editing without a model call', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response(null, { status: 403 }));
  const { env, request, sql } = fixture();
  env.AI = { run: async () => assert.fail('No generation without source evidence') };
  assert.equal((await request('/submit', proposed)).status, 202);
  sql.exec("UPDATE submissions SET state = 'edit', next_at = 0");
  await runJobs(env);
  const row = sql.prepare('SELECT state, edited, last_error FROM submissions').get();
  assert.equal(row.state, 'edit');
  assert.equal(row.edited, null);
  assert.equal(row.last_error, 'retry_edit:source_unavailable');
});

test('Bilibili video editing receives actual storyboard images for the requested part', async (t) => {
  const env = {
    FEISHU_BRIDGE_URL: 'https://approval.example.org',
    FEISHU_BRIDGE_TOKEN: 'fixture',
    AI: { run: async (model, input) => {
      assert.match(model, /llama-4-scout/);
      const [text, frames] = input.messages[1].content;
      assert.equal(JSON.parse(text.text).资源内容.title, '来源分段');
      assert.match(frames.image_url.url, /^data:image\/jpeg;base64,/);
      assert(!text.text.includes(proposed.description));
      return { response: modelFields };
    } },
  };
  t.mock.method(globalThis, 'fetch', async (input, options) => {
    const url = new URL(input);
    if (url.href === env.FEISHU_BRIDGE_URL + '/sources/bilibili') {
      assert.equal(options.headers.Authorization, 'Bearer fixture');
      assert.equal(options.redirect, 'manual');
      return Response.json(await bilibiliSource(JSON.parse(options.body)));
    }
    if (url.pathname === '/x/web-interface/view') return Response.json({
      code: 0, data: { pages: [{ page: 1, cid: 98 }, { page: 2, cid: 99, part: '来源分段' }] },
    });
    if (url.pathname === '/x/player/videoshot') {
      assert.equal(url.searchParams.get('cid'), '99');
      return Response.json({ code: 0, data: { image: ['//bimp.hdslb.com/videoshot/99-1.jpg'], index: [0, 10] } });
    }
    if (url.pathname === '/x/player/wbi/v2') return Response.json({ code: 0, data: {} });
    assert.equal(url.href, 'https://bimp.hdslb.com/videoshot/99-1.jpg@1600w.jpg');
    assert.equal(Object.hasOwn(options.headers, 'Authorization'), false);
    return new Response(new Uint8Array([255, 216, 255, 217]), { headers: { 'Content-Type': 'image/jpeg' } });
  });
  const url = 'https://www.bilibili.com/video/BV1TvyZz6ERq?p=2';
  assert.deepEqual(await generateEntry(env, { ...proposed, url, tags: JSON.stringify(proposed.tags) }), edit);
});

test('Feishu maps dynamic fields and recovers a duplicate instance', async () => {
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
});

test('terminal owner decisions allow absent opinions and preserve supplied text verbatim', () => {
  const instance = crypto.randomUUID();
  for (const [status, event] of [['APPROVED', 'PASS'], ['REJECTED', 'REJECT']]) {
    const decision = {
      instance_code: instance.toUpperCase(), approval_code: definition, open_id: owner, status,
      task_list: [{ open_id: owner, status, id: 'matching-task' }],
    };
    const timeline = { type: event, task_id: 'matching-task', open_id: owner };
    for (const comment of [{}, { comment: null }, { comment: '' }, { comment: ' \n\t ' }]) {
      assert.deepEqual(approvalDecision({ ...decision, timeline: [{ ...timeline, ...comment }] }, owner, instance),
        { status: status.toLowerCase(), opinion: '' });
    }
    const opinion = ' 很有精神 \n';
    assert.deepEqual(approvalDecision({ ...decision, timeline: [{ ...timeline, comment: opinion }] }, owner, instance),
      { status: status.toLowerCase(), opinion });
    assert.throws(() => approvalDecision({ ...decision, timeline: [{ ...timeline, comment: { value: '' } }] }, owner, instance),
      /Invalid approval opinion/);
  }
});

test('an empty opinion cannot stand in for this instance’s genuine owner decision', () => {
  const instance = crypto.randomUUID();
  const timeline = { type: 'PASS', task_id: 'matching-task', open_id: owner };
  const decision = {
    instance_code: instance, approval_code: definition, open_id: owner, status: 'APPROVED',
    task_list: [{ open_id: owner, status: 'APPROVED', id: 'matching-task' }],
    timeline: [timeline],
  };
  for (const mismatch of [
    { instance_code: crypto.randomUUID() },
    { approval_code: crypto.randomUUID() },
    { open_id: 'another-submitter' },
    { reverted: true },
    { status: 'REJECTED' },
    { task_list: [{ ...decision.task_list[0], status: 'PENDING' }] },
    { task_list: [{ ...decision.task_list[0], open_id: 'another-reviewer' }] },
    { timeline: [{ ...timeline, task_id: 'another-node' }] },
    { timeline: [{ ...timeline, open_id: 'another-reviewer' }] },
    { timeline: [{ ...timeline, open_id: undefined }] },
    { timeline: [{ ...timeline, type: 'AUTO_PASS' }] },
    { timeline: [timeline, timeline] },
  ]) {
    assert.throws(() => approvalDecision({ ...decision, ...mismatch }, owner, instance), /approval identity|human decision/);
  }
  assert.deepEqual(approvalDecision({ ...decision, status: 'PENDING', timeline: [] }, owner, instance), { status: 'pending' });
});

function encryptedCallback(payload, config, timestamp = String(Math.floor(testTime / 1000))) {
  const iv = randomBytes(16);
  const cipher = createCipheriv('aes-256-cbc', createHash('sha256').update(config.encryptKey).digest(), iv);
  const encrypted = Buffer.concat([iv, cipher.update(JSON.stringify(payload)), cipher.final()]);
  const body = Buffer.from(JSON.stringify({ encrypt: encrypted.toString('base64') }));
  const nonce = 'signed_nonce';
  const headers = {
    'x-lark-request-timestamp': timestamp,
    'x-lark-request-nonce': nonce,
    'x-lark-signature': createHash('sha256').update(timestamp + nonce + config.encryptKey).update(body).digest('hex'),
  };
  return { body, headers };
}

test('Feishu callbacks require a fresh platform signature and the configured reviewer', async () => {
  const config = { encryptKey: 'fixture-encryption-key', verificationToken: 'fixture-token', appId: 'cli_test', owner };
  const id = crypto.randomUUID();
  const key = crypto.randomUUID();
  const payload = {
    schema: '2.0',
    header: { event_id: 'fixture-event-01', event_type: 'card.action.trigger', app_id: config.appId, token: config.verificationToken },
    event: {
      operator: { open_id: owner }, context: { open_message_id: 'om_fixture_message' },
      action: { value: { kind: 'hinome-tech-review', id, key, rev: 1, intent: 'submit_opinion' },
        form_value: { opinion: ' 原样保留\n' } },
    },
  };
  const { body, headers } = encryptedCallback(payload, config);
  assert.deepEqual(cardCallback(body, headers, config, testTime), {
    id, key, actor: owner, intent: 'submit_opinion', messageId: 'om_fixture_message', rev: 1,
    opinion: ' 原样保留\n', eventId: 'fixture-event-01',
  });
  assert.equal(cardCallback(body, {}, config, testTime), null);
  assert.equal(cardCallback(body, headers, { ...config, appId: 'cli_other' }, testTime), null);
  assert.equal(cardCallback(body, headers, { ...config, owner: 'ou_someone_else' }, testTime), null);
  assert.equal(cardCallback(Buffer.concat([body, Buffer.from(' ')]), headers, config, testTime), null);
  assert.equal(cardCallback(body, headers, config, testTime + 301_000), null);
  const created = String(BigInt(testTime) * 1000n);
  for (const timestamp of [created, 'opaque-time-format']) {
    const signed = encryptedCallback({ ...payload, header: { ...payload.header, create_time: created } }, config, timestamp);
    assert.equal(cardCallback(signed.body, signed.headers, config, testTime)?.intent, 'submit_opinion');
    assert.equal(cardCallback(signed.body, signed.headers, config, testTime + 301_000), null);
  }

  const handshake = encryptedCallback({ type: 'url_verification', token: config.verificationToken, challenge: 'verify' }, config);
  const challenge = cardCallback(handshake.body, {}, config, testTime);
  assert.deepEqual(await handleCardAction(challenge, async () => assert.fail('URL challenge must not approve')),
    { challenge: 'verify' });
  assert.equal(cardCallback(handshake.body, {}, { ...config, verificationToken: 'wrong' }, testTime), null);
});

test('the same review card has exactly three named actions and the opinion form needs confirmation', async () => {
  const row = { ...proposed, id: crypto.randomUUID(), key: crypto.randomUUID(), rev: 0, test: true };
  const main = reviewCard({ ...row, view: 'main' });
  assert.deepEqual(main.body.elements.filter(({ tag }) => tag === 'button').map(({ text }) => text.content),
    ['同意', '同意并写意见', '拒绝']);
  assert.equal(main.body.elements.filter(({ tag }) => tag === 'form').length, 0);
  const opinion = reviewCard({ ...row, view: 'opinion', rev: 1 });
  const input = opinion.body.elements.find(({ tag }) => tag === 'form').elements;
  assert.equal(input[0].name, 'opinion');
  assert.equal(input[0].required, true);
  assert.equal(input[1].form_action_type, 'submit');
  assert.equal(input[1].behaviors[0].value.intent, 'submit_opinion');

  let sends = 0;
  assert.deepEqual(await sendReviewCard(async (path, data) => {
    sends++;
    assert.equal(path, '/im/v1/messages?receive_id_type=open_id');
    assert.equal(data.receive_id, owner);
    assert.equal(data.uuid, row.key);
    assert.deepEqual(JSON.parse(data.content), main);
    return { message_id: 'om_fixture_message' };
  }, owner, row), { messageId: 'om_fixture_message' });
  assert.equal(sends, 1);
});

test('card-backed submissions issue no native task, and signed actions are uniquely applied', async (t) => {
  const { sql, env, request } = fixture();
  env.APPROVAL_MODE = 'card';
  env.AI = { run: async () => ({ response: modelFields }) };
  let now = testTime;
  t.mock.method(Date, 'now', () => now);
  let cardsSent = 0;
  const deliveries = new Map();
  const messageId = (n) => 'om_fixture_' + n;
  t.mock.method(globalThis, 'fetch', async (input, options) => {
    if (new URL(input).host === 'example.org') return new Response(sourceText);
    assert.equal(new URL(input).pathname, '/cards');
    const delivery = JSON.parse(options.body);
    cardsSent++;
    deliveries.set(delivery.id, delivery.key);
    return Response.json({ messageId: messageId(cardsSent) });
  });
  for (const url of ['https://example.org/card-one', 'https://example.org/card-two', 'https://example.org/card-three']) {
    assert.equal((await request('/submit', { ...proposed, url })).status, 202);
  }
  await runJobs(env);
  await runJobs(env);
  assert.equal(cardsSent, 3);
  const rows = sql.prepare('SELECT id, approval_id, card_message_id FROM submissions ORDER BY rowid').all();
  assert(rows.every((row) => row.approval_id === null && row.card_message_id));
  const load = (id) => sql.prepare('SELECT state,card_view,card_rev,opinion,card_decision,card_event_id FROM submissions WHERE id=?').get(id);
  function action(row, intent, rev, extra = {}, options = { bridge: true }) {
    return request('/internal/card-action', {
      id: row.id, key: deliveries.get(row.id), messageId: row.card_message_id, actor: owner,
      eventId: 'fixture-event-' + rev, intent, rev, ...extra,
    }, options);
  }
  const [first, second, third] = rows;
  assert.equal((await action(first, 'approve', 0, {}, { internal: true })).status, 401);
  assert.equal((await action(first, 'approve', 0, { messageId: 'om_unrelated' })).body.outcome, 'missing');
  assert.equal((await action(first, 'approve', 0)).body.outcome, 'approved');
  const saved = load(first.id);
  assert.equal(saved.opinion, '');
  assert.equal(saved.card_event_id, 'fixture-event-0');
  await action(first, 'approve', 0, { eventId: 'another-click-id' });
  assert.deepEqual(load(first.id), saved);

  assert.equal((await action(second, 'submit_opinion', 0, { opinion: '未进入编辑' })).body.outcome, 'stale');
  assert.equal((await action(second, 'open_opinion', 0)).body.outcome, 'opened');
  assert.equal(load(second.id).state, 'review');
  assert.equal(load(second.id).card_view, 'opinion');
  assert.equal(load(second.id).opinion, null);
  assert.equal((await action(second, 'approve', 0)).body.outcome, 'stale');
  assert.equal((await action(second, 'submit_opinion', 1, { opinion: '  ' })).body.outcome, 'invalid_opinion');
  assert.equal((await action(second, 'submit_opinion', 1, { opinion: ' 原文\n' })).body.outcome, 'approved');
  assert.equal(load(second.id).opinion, ' 原文\n');

  assert.equal((await action(third, 'open_reject', 0)).body.outcome, 'opened');
  assert.equal(load(third.id).state, 'review');
  assert.equal((await action(third, 'submit_reject', 1, { opinion: '后台理由。' })).body.outcome, 'rejected');
  assert.equal(load(third.id).state, 'rejected');
  assert.deepEqual((await request('/updates')).body, { updates: [], next: null });
  now += 14 * 24 * 60 * 60 * 1000;
  assert.equal((await action(third, 'submit_reject', 1)).body.outcome, 'expired');
  await runJobs(env);
  assert.deepEqual(rows.map(({ id }) => load(id).state), ['publish', 'publish', 'rejected']);
});

test('a lost card delivery acknowledgement can recover from the signed click without resending', async (t) => {
  const { sql, env, request } = fixture();
  env.APPROVAL_MODE = 'card';
  env.AI = { run: async () => ({ response: modelFields }) };
  let delivery;
  let sends = 0;
  t.mock.method(globalThis, 'fetch', async (input, options) => {
    if (String(input) === proposed.url) return new Response(sourceText);
    assert.equal(new URL(input).pathname, '/cards');
    sends++;
    delivery = JSON.parse(options.body);
    return Response.json({}, { status: 503 });
  });
  assert.equal((await request('/submit', proposed)).status, 202);
  await runJobs(env);
  const load = () => sql.prepare('SELECT state,card_message_id,approval_id,last_error FROM submissions').get();
  assert.equal(load().state, 'submitted');
  assert.equal(load().last_error, 'retry_submitted:feishu_http_503');
  const answer = await request('/internal/card-action', {
    id: delivery.id, key: delivery.key, rev: 0, intent: 'approve', eventId: 'delivered-event',
    actor: owner, messageId: 'om_delivered_without_ack',
  }, { bridge: true });
  assert.equal(answer.body.outcome, 'approved');
  await runJobs(env);
  assert.deepEqual({ ...load() }, {
    state: 'publish', card_message_id: 'om_delivered_without_ack', approval_id: null, last_error: null,
  });
  assert.equal(sends, 1);
});
