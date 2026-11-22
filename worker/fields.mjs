import '../public/resources.js';

const allowedTags = new Set(globalThis.RESOURCE_TAGS);

export const sections = ['实用工具', '百科资料', '影像档案', '亲历回顾', '二创作品'];
export const receiptPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function cleanText(value, limit) {
  if (typeof value !== 'string') throw new Error('invalid_field');
  const result = value.trim();
  if (!result || result.length > limit || /[\x00-\x08\x0b-\x1f\x7f]/.test(result)) {
    throw new Error('invalid_field');
  }
  return result;
}

export function sourceLink(value) {
  const url = new URL(cleanText(value, 2048));
  const host = url.hostname;
  if (url.protocol !== 'https:' || url.username || url.password || url.port ||
      !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z][a-z0-9-]*$/i.test(host) ||
      /\.(?:local|localhost|internal|invalid|test|example|onion)$/i.test(host)) {
    throw new Error('invalid_url');
  }
  return url.href;
}

export function linkKey(value) {
  const url = new URL(sourceLink(value));
  url.hostname = url.hostname.replace(/\.$/, '');
  if (url.hostname === 'www.bilibili.com' && /^\/video\/BV[\da-z]+\/?$/i.test(url.pathname)) {
    const video = url.pathname.split('/')[2];
    const page = url.searchParams.get('p');
    return `https://www.bilibili.com/video/${video}${page && page !== '1' ? '?p=' + encodeURIComponent(page) : ''}`;
  }
  url.pathname = url.pathname.replace(/\/+$/, '') || '/';
  for (const name of Array.from(url.searchParams.keys())) {
    if (/^(utm_.+|fbclid|gclid|spm_id_from|vd_source)$/i.test(name)) url.searchParams.delete(name);
  }
  url.searchParams.sort();
  return url.href;
}

export function tagsFrom(value) {
  if (!Array.isArray(value) || value.length > 6) throw new Error('invalid_tags');
  const tags = [...new Set(value.map((tag) => cleanText(tag, 20)))];
  if (tags.some((tag) => !allowedTags.has(tag))) throw new Error('invalid_tags');
  return tags;
}

export function existingTags(value) {
  return [...new Set(value.filter((tag) => allowedTags.has(tag)))].slice(0, 6);
}

export function submission(input) {
  if (!sections.includes(input.section)) throw new Error('invalid_section');
  return {
    title: cleanText(input.title, 100),
    url: sourceLink(input.url),
    section: input.section,
    description: cleanText(input.description, 800),
    tags: tagsFrom(input.tags === undefined || input.tags === '' ? [] : input.tags),
  };
}

export function editedFields(input) {
  const allowed = ['title', 'section', 'description', 'tags'];
  if (!input || Object.keys(input).length !== allowed.length ||
      !allowed.every((key) => Object.hasOwn(input, key)) || !sections.includes(input.section)) {
    throw new Error('invalid_edit');
  }
  const title = cleanText(input.title, 100);
  const description = cleanText(input.description, 220);
  const tags = tagsFrom(input.tags);
  if ([title, description, ...tags].some((value) =>
    /[<>]|https?:\/\/|[\w.%+-]+@[\w.-]+\.[a-z]{2,}/i.test(value))) {
    throw new Error('invalid_public_text');
  }
  return { title, section: input.section, description, tags };
}

export function parseCatalog(source) {
  const prefix = 'window.HINOME_RECOMMENDATIONS = ';
  if (!source.startsWith(prefix) || !source.trimEnd().endsWith(';')) {
    throw new Error('invalid_catalog');
  }
  const rows = JSON.parse(source.trimEnd().slice(prefix.length, -1));
  if (!Array.isArray(rows)) throw new Error('invalid_catalog');
  return rows;
}
