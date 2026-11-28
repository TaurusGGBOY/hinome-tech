import { createDecipheriv, createHash, timingSafeEqual } from 'node:crypto';

const uuid = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i;
const message = /^om_[A-Za-z0-9_-]{4,120}$/;
const chat = /^oc_[A-Za-z0-9_-]{4,120}$/;
const event = /^[\da-z_-]{8,128}$/i;
const fiveMinutes = 300_000;
const actions = new Set(['approve', 'open_opinion', 'open_reject', 'back', 'submit_opinion', 'submit_reject']);
const plain = (content) => ({ tag: 'plain_text', content });

function sameValue(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const actual = Buffer.from(left);
  const expected = Buffer.from(right);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function decodeEnvelope(envelope, key) {
  if (!Object.hasOwn(envelope, 'encrypt')) return envelope;
  if (typeof envelope.encrypt !== 'string' || !/^[A-Za-z0-9+/]+=*$/.test(envelope.encrypt)) {
    throw new Error('Invalid encrypted envelope');
  }
  const ciphertext = Buffer.from(envelope.encrypt, 'base64');
  if (ciphertext.length < 32 || ciphertext.length % 16 !== 0) throw new Error('Invalid ciphertext');
  const decipher = createDecipheriv('aes-256-cbc', createHash('sha256').update(key).digest(), ciphertext.subarray(0, 16));
  const plaintext = Buffer.concat([decipher.update(ciphertext.subarray(16)), decipher.final()]);
  return JSON.parse(plaintext.toString('utf8'));
}

function timestampMillis(value) {
  if (typeof value !== 'string' || !/^\d{10}(?:\d{3}){0,3}$/.test(value)) return null;
  return value.length === 10 ? Number(value) * 1000 : Number(value.slice(0, 13));
}

export function cardCallback(raw, headers, config, now = Date.now(), onReject = () => {}) {
  function reject(reason) {
    onReject(reason);
    return null;
  }
  if (!config.encryptKey || !config.verificationToken) return null;
  try {
    const envelope = JSON.parse(raw.toString('utf8'));
    const signature = headers['x-lark-signature'];
    // Feishu's URL challenge is separate from signed interactivity and only echoes its challenge.
    if (!signature) {
      const payload = decodeEnvelope(envelope, config.encryptKey);
      return payload.type === 'url_verification' && sameValue(payload.token, config.verificationToken) &&
        typeof payload.challenge === 'string' && payload.challenge.length <= 256
        ? { challenge: payload.challenge } : reject('missing_signature');
    }
    const timestamp = headers['x-lark-request-timestamp'];
    const nonce = headers['x-lark-request-nonce'];
    if (typeof timestamp !== 'string' || !timestamp.length || timestamp.length > 64) return reject('timestamp_header');
    if (typeof nonce !== 'string' || !/^[\w.-]{1,128}$/.test(nonce)) return reject('nonce_format');
    if (!/^[0-9a-f]{64}$/i.test(signature)) return reject('signature_format');
    const expected = createHash('sha256').update(timestamp + nonce + config.encryptKey).update(raw).digest('hex');
    if (!sameValue(signature.toLowerCase(), expected)) return reject('signature_mismatch');

    const payload = decodeEnvelope(envelope, config.encryptKey);
    if (payload.type === 'url_verification' && sameValue(payload.token, config.verificationToken) &&
        typeof payload.challenge === 'string' && payload.challenge.length <= 256) {
      return { challenge: payload.challenge };
    }
    const header = payload.header;
    const value = payload.event?.action?.value;
    const operator = payload.event?.operator?.open_id;
    const messageId = payload.event?.context?.open_message_id;
    if (payload.schema !== '2.0' || header?.event_type !== 'card.action.trigger') return reject('event_type');
    if (header.app_id !== config.appId) return reject('app_mismatch');
    if (!sameValue(header.token, config.verificationToken)) return reject('token_mismatch');
    // The signature covers both fields. Feishu's card creation time is in microseconds.
    const created = timestampMillis(header.create_time) ?? timestampMillis(timestamp);
    if (created === null) return reject('timestamp_format');
    if (Math.abs(now - created) > fiveMinutes) return reject('timestamp_stale');
    if (!config.owner || operator !== config.owner) return reject('reviewer_mismatch');
    if (typeof header.event_id !== 'string' || !event.test(header.event_id)) return reject('event_id_format');
    if (!message.test(messageId)) return reject('message_id_format');
    if (value?.kind !== 'hinome-tech-review' || !uuid.test(value.id) || !uuid.test(value.key) ||
        !actions.has(value.intent) || !Number.isSafeInteger(value.rev) || value.rev < 0) return reject('action_format');

    let opinion;
    if (value.intent === 'submit_opinion' || value.intent === 'submit_reject') {
      let form = payload.event.action.form_value;
      if (typeof form === 'string') form = JSON.parse(form);
      opinion = form?.opinion;
    }
    return { id: value.id, key: value.key, rev: value.rev, intent: value.intent, messageId,
      eventId: header.event_id, actor: operator, opinion };
  } catch {
    return reject('invalid_body');
  }
}

function button(text, intent, row, type = 'default', submit = false) {
  return {
    tag: 'button', text: plain(text), type,
    ...(submit && { name: 'confirm_decision', form_action_type: 'submit' }),
    behaviors: [{ type: 'callback', value: { kind: 'hinome-tech-review', intent, id: row.id, key: row.key, rev: row.rev } }],
  };
}

export function reviewCard(row) {
  const elements = [
    { tag: 'div', text: plain(row.title) },
    { tag: 'div', text: plain('建议分区：' + row.section) },
    { tag: 'div', text: plain(row.description) },
    { tag: 'div', text: plain(row.url) },
  ];
  if (row.tags?.length) elements.push({ tag: 'div', text: plain('建议标签：' + row.tags.join('、')) });
  if (row.decision) {
    elements.push({ tag: 'div', text: plain(row.decision === 'approved' ? '已同意' : '已拒绝') });
  } else if (row.view === 'opinion' || row.view === 'reject') {
    const approve = row.view === 'opinion';
    elements.push({
      tag: 'form', name: 'decision_form', elements: [
        { tag: 'input', name: 'opinion', input_type: 'multiline_text', max_length: 1000,
          required: approve, placeholder: plain(approve ? '填写审批意见' : '可填写拒绝理由') },
        button(approve ? '确认同意' : '确认拒绝', approve ? 'submit_opinion' : 'submit_reject',
          row, approve ? 'primary_filled' : 'danger', true),
      ],
    }, button('返回', 'back', row));
  } else {
    elements.push(
      button('同意', 'approve', row, 'primary_filled'),
      button('同意并写意见', 'open_opinion', row),
      button('拒绝', 'open_reject', row, 'danger'),
    );
  }
  return {
    schema: '2.0', config: { update_multi: true, enable_forward: false },
    header: { title: plain(row.test ? '【联调·不公开】资源收录审核' : '资源收录审核'), template: 'blue' },
    body: { direction: 'vertical', vertical_spacing: '8px', elements },
  };
}

export async function sendReviewCard(api, owner, row) {
  if (!owner || !uuid.test(row?.id) || !uuid.test(row?.key) || typeof row.test !== 'boolean' ||
      !Array.isArray(row.tags) || row.tags.length > 6 ||
      ['title', 'section', 'description', 'url'].some((key) =>
        typeof row[key] !== 'string' || !row[key].trim() || row[key].length > 2048)) {
    throw new Error('Invalid card delivery request');
  }
  const result = await api('/im/v1/messages?receive_id_type=open_id', {
    receive_id: owner,
    msg_type: 'interactive',
    content: JSON.stringify(reviewCard({ ...row, view: 'main', rev: 0 })),
    uuid: row.key,
  });
  if (!message.test(result?.message_id)) throw new Error('Missing Feishu message id');
  return { messageId: result.message_id };
}

export async function sendProgressMessage(api, chatId, payload) {
  if (!chat.test(chatId) || !uuid.test(payload?.id) || !uuid.test(payload?.key) ||
      typeof payload?.text !== 'string' || !payload.text.trim() || payload.text.length > 4000) {
    throw new Error('Invalid progress report request');
  }
  const result = await api('/im/v1/messages?receive_id_type=chat_id', {
    receive_id: chatId,
    msg_type: 'text',
    content: JSON.stringify({ text: payload.text }),
    uuid: payload.key,
  });
  if (!message.test(result?.message_id)) throw new Error('Missing Feishu message id');
  return { messageId: result.message_id };
}

export async function handleCardAction(action, dispatch) {
  if (Object.hasOwn(action, 'challenge')) return { challenge: action.challenge };
  const result = await dispatch(action);
  const reply = {};
  if (result.card) reply.card = { type: 'raw', data: reviewCard(result.card) };
  const messages = {
    approved: ['success', '已同意'],
    rejected: ['success', '已拒绝'],
    stale: ['info', '已刷新审批状态，请按卡片当前内容操作。'],
    expired: ['warning', '这张审批卡已过期。'],
    missing: ['warning', '未找到当前审批卡。'],
    invalid_opinion: ['warning', '请填写有效意见，最多 1000 字。'],
  };
  if (messages[result.outcome]) {
    const [type, content] = messages[result.outcome];
    reply.toast = { type, content };
  }
  return reply;
}
