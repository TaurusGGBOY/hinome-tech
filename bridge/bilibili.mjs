const headers = { Referer: 'https://www.bilibili.com/', 'User-Agent': 'Mozilla/5.0' };

async function readJson(url) {
  const response = await fetch(url, { headers, redirect: 'error', signal: AbortSignal.timeout(6500) });
  if (!response.ok || Number(response.headers.get('Content-Length')) > 1024 * 1024) {
    await response.body?.cancel();
    throw new Error('Bilibili source unavailable');
  }
  return response.json();
}

async function api(path, params) {
  const url = new URL(path, 'https://api.bilibili.com');
  url.search = new URLSearchParams(params);
  const result = await readJson(url);
  if (result.code !== 0 || !result.data) throw new Error('Bilibili source unavailable');
  return result.data;
}

async function storyboard(params) {
  const shots = await api('/x/player/videoshot', { ...params, index: '1' });
  if (!Array.isArray(shots.image) || !shots.image.length || !Array.isArray(shots.index) || shots.index.length < 2) return [];
  const indices = [...new Set([0, Math.floor(shots.image.length / 2), shots.image.length - 1])];
  return indices.map((index) => shots.image[index]).filter((url) => typeof url === 'string');
}

async function subtitles(params) {
  const player = await api('/x/player/wbi/v2', params);
  const tracks = player.subtitle?.subtitles ?? [];
  const track = tracks.find((item) => item.lan === 'zh-CN') ?? tracks[0];
  if (!track?.subtitle_url) return '';
  const url = new URL(track.subtitle_url, 'https://api.bilibili.com');
  if (url.protocol !== 'https:' || url.port || url.username || url.password ||
      !/\.(hdslb\.com|biliapi\.net)$/.test(url.hostname)) return '';
  const subtitle = await readJson(url);
  return (subtitle.body ?? []).map(({ content }) => content).join(' ').slice(0, 6500);
}

export async function bilibiliSource({ bvid, page }) {
  if (typeof bvid !== 'string' || !/^BV[0-9A-Za-z]{10}$/.test(bvid) || !Number.isInteger(page) || page < 1) {
    throw new Error('Invalid Bilibili video');
  }
  const view = await api('/x/web-interface/view', { bvid });
  const part = view.pages?.find((item) => item.page === page);
  if (!part?.cid) throw new Error('Bilibili part unavailable');
  const params = { bvid, cid: String(part.cid) };
  const [sprites, transcript] = await Promise.all([
    storyboard(params).catch(() => []),
    subtitles(params).catch(() => ''),
  ]);
  if (!sprites.length && !transcript) throw new Error('Bilibili source unavailable');
  const title = [...new Set([view.title, part.part].filter(Boolean))].join(' · ').slice(0, 180);
  return { title, sprites, subtitles: transcript };
}
