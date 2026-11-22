import { existingTags, receiptPattern } from './fields.mjs';
import { query } from './security.mjs';

const cardTTL = 14 * 24 * 60 * 60 * 1000;
const pending = new Set(['submitted', 'review']);
const operations = {
  approve: { from: 'main', decision: 'approved' },
  open_opinion: { from: 'main', view: 'opinion' },
  open_reject: { from: 'main', view: 'reject' },
  back: { view: 'main' },
  submit_opinion: { from: 'opinion', decision: 'approved' },
  submit_reject: { from: 'reject', decision: 'rejected' },
};

function represent(row, outcome) {
  return { outcome, card: {
    id: row.id, key: row.card_key, rev: row.card_rev, view: row.card_view,
    decision: row.card_decision, test: Boolean(row.test), title: row.title, url: row.url,
    section: row.section, description: row.description, tags: existingTags(JSON.parse(row.tags)),
  } };
}

export async function applyCardAction(db, action, now = Date.now()) {
  const { id, key, rev, intent, messageId, eventId, actor } = action;
  if (!receiptPattern.test(id) || !receiptPattern.test(key) ||
      !Number.isSafeInteger(rev) || rev < 0 ||
      !/^om_[A-Za-z0-9_-]{4,120}$/.test(messageId) ||
      !/^ou_[A-Za-z0-9_-]{4,120}$/.test(actor) || typeof eventId !== 'string' || !/^[\da-z_-]{8,128}$/i.test(eventId) ||
      !Object.hasOwn(operations, intent)) return { outcome: 'missing' };

  const guard = `id = ? AND review_channel = 'card' AND card_key = ? AND approval_id IS NULL
    AND card_issued_at IS NOT NULL AND (card_message_id IS NULL OR card_message_id = ?)`;
  const lookup = () => query(db, 'SELECT * FROM submissions WHERE ' + guard, id, key, messageId).first();
  const current = await lookup();
  if (!current) return { outcome: 'missing' };
  const oldest = now - cardTTL;
  if (current.card_issued_at <= oldest) return { outcome: 'expired' };
  if (current.card_decision) return represent(current, current.card_decision);

  const operation = operations[intent];
  if (!pending.has(current.state) || rev !== current.card_rev ||
      (operation.from && current.card_view !== operation.from) ||
      (intent === 'back' && current.card_view === 'main')) return represent(current, 'stale');

  let opinion = '';
  if (intent.startsWith('submit_')) {
    if ((action.opinion != null && typeof action.opinion !== 'string') ||
        action.opinion?.length > 1000 || (intent === 'submit_opinion' && !action.opinion?.trim())) {
      return { outcome: 'invalid_opinion' };
    }
    if (action.opinion?.trim()) opinion = action.opinion;
  }

  const decision = operation.decision ?? null;
  const state = decision === 'approved' ? 'edit' : decision === 'rejected' ? 'rejected' : 'review';
  // A delivery retry may still be waiting for its response. An authenticated action
  // can bind the delivered message and release its lease without changing its decision twice.
  const saved = await query(db, `UPDATE submissions SET state = ?, updated = ?, next_at = ?,
    card_message_id = ?, card_view = ?, card_rev = card_rev + 1, card_decision = ?,
    card_decider = ?, card_event_id = ?, opinion = ?, decided = ?,
    lease = NULL, leased_until = NULL, attempts = 0, last_error = NULL
    WHERE ${guard} AND state IN ('submitted', 'review') AND card_decision IS NULL
      AND card_rev = ? AND card_issued_at > ? RETURNING *`,
  state, now, now, messageId, operation.view ?? 'main', decision, decision ? actor : null,
  decision ? eventId : null, decision ? opinion : null, decision ? now : null,
  id, key, messageId, rev, oldest).first();
  if (saved) return represent(saved, decision ?? 'opened');

  const latest = await lookup();
  return latest ? represent(latest, latest.card_decision ?? 'stale') : { outcome: 'missing' };
}
