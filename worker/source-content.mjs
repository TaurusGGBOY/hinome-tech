import { sourceLink } from './fields.mjs';

const textLimit = 6500;
const imageLimit = 512 * 1024;
const bilibiliHeaders = { Referer: 'https://www.bilibili.com/', 'User-Agent': 'Mozilla/5.0' };

async function download(url, headers) {
  return fetch(url, { headers, redirect: 'manual', signal: AbortSignal.timeout(8000) });
}

async function readBytes(response, limit) {
  if (!response.ok || !response.body || Number(response.headers.get('Content-Length')) > limit) {
    await response.body?.cancel();
    throw new Error('source_unavailable');
  }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw new Error('source_unavailable');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function textOf(value) {
  return value.replace(/\s+/g, ' ').trim().slice(0, textLimit);
}

function contentType(response) {
  return (response.headers.get('Content-Type') ?? '').split(';')[0].trim().toLowerCase();
}

async function imageOf(response) {
  const type = contentType(response);
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(type)) {
    await response.body?.cancel();
    throw new Error('source_unavailable');
  }
  const bytes = await readBytes(response, imageLimit);
  let binary = '';
  for (let index = 0; index < bytes.length; index += 8192) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 8192));
  }
  if (!binary) throw new Error('source_unavailable');
  return 'data:' + type + ';base64,' + btoa(binary);
}

async function bilibiliFrames(sprites) {
  const images = await Promise.allSettled(sprites.slice(0, 3).map(async (source) => {
    const sprite = new URL(source, 'https://bimp.hdslb.com');
    if (sprite.origin !== 'https://bimp.hdslb.com' ||
        !/^\/(?:videoshot[^/]*\/)+[a-z0-9_-]+\.jpg$/i.test(sprite.pathname)) {
      throw new Error('source_unavailable');
    }
    sprite.pathname += '@1600w.jpg';
    return imageOf(await download(sprite, bilibiliHeaders));
  }));
  return images.flatMap((image) => image.status === 'fulfilled' ? [image.value] : []);
}

async function bilibiliContent(url, env) {
  const video = /^\/video\/(BV[a-z0-9]+)\/?$/i.exec(url.pathname);
  if (!video || !env.FEISHU_BRIDGE_URL || !env.FEISHU_BRIDGE_TOKEN) throw new Error('source_unavailable');
  const page = Number(url.searchParams.get('p') ?? 1);
  const response = await fetch(new URL('/sources/bilibili', env.FEISHU_BRIDGE_URL), {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + env.FEISHU_BRIDGE_TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ bvid: video[1], page }),
    redirect: 'manual',
    signal: AbortSignal.timeout(21_000),
  });
  const source = JSON.parse(new TextDecoder().decode(await readBytes(response, 64 * 1024)));
  const images = await bilibiliFrames(source.sprites);
  const subtitles = textOf(source.subtitles);
  if (!images.length && !subtitles) throw new Error('source_unavailable');
  return { kind: 'B站视频', title: textOf(source.title), subtitles, images };
}

async function webpageContent(response) {
  const type = contentType(response);
  if (type.startsWith('image/')) return { kind: '图片', images: [await imageOf(response)] };
  if (type !== 'text/html' && type !== 'text/plain') {
    await response.body?.cancel();
    throw new Error('source_unavailable');
  }
  const bytes = await readBytes(response, 768 * 1024);
  const source = new TextDecoder().decode(bytes);
  let title = '';
  let text = source;
  if (type === 'text/html') {
    text = '';
    let embeddedVideo = false;
    const rewriter = new HTMLRewriter()
      .on('title', { text(node) { if (title.length < 180) title += node.text; } })
      .on('video[src], video source[src], iframe[src*="youtube"], iframe[src*="bilibili"], iframe[src*="douyin"]', {
        element() { embeddedVideo = true; },
      })
      .on('header, nav, aside, footer, form, script, style, noscript, [hidden], [aria-hidden="true"]', {
        element(node) { node.remove(); },
      })
      .on('article p, main p, [role="main"] p, article li, main li, [role="main"] li', {
        text(node) {
          if (text.length < textLimit) text += node.text + (node.lastInTextNode ? ' ' : '');
        },
      });
    await rewriter.transform(new Response(source, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })).text();
    if (embeddedVideo) throw new Error('source_unavailable');
  }
  text = textOf(text);
  if (text.length < 70) throw new Error('source_unavailable');
  return { kind: '网页正文', title: textOf(title).slice(0, 180), text, images: [] };
}

export async function inspectSource(value, env) {
  let url = new URL(sourceLink(value));
  try {
    for (let attempt = 0; attempt < 4; attempt++) {
      if ((url.hostname === 'bilibili.com' || url.hostname.endsWith('.bilibili.com')) &&
          url.pathname.startsWith('/video/')) return await bilibiliContent(url, env);
      if (/(^|\.)(youtube\.com|youtu\.be|douyin\.com|tiktok\.com|bilibili\.com)$/.test(url.hostname) &&
          !url.pathname.startsWith('/read/')) throw new Error('source_unavailable');
      const response = await download(url);
      const location = response.headers.get('Location');
      if (response.status < 300 || response.status >= 400 || !location) return await webpageContent(response);
      await response.body?.cancel();
      url = new URL(sourceLink(new URL(location, url).href));
    }
  } catch {
    throw new Error('source_unavailable');
  }
  throw new Error('source_unavailable');
}
