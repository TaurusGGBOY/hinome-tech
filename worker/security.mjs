export const query = (db, sql, ...inputs) => db.prepare(sql).bind(...inputs);
const bytes = new TextEncoder();
export async function digest(secret, value) {
  const key = await crypto.subtle.importKey('raw', bytes.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const valueBytes = new Uint8Array(await crypto.subtle.sign('HMAC', key, bytes.encode(value)));
  return Array.from(valueBytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function equal(left, right) {
  if (!left || !right || left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i++) diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return diff === 0;
}
