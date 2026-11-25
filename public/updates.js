(() => {
  const dialog = document.querySelector('#updates');
  const status = document.querySelector('#updates-status');
  const list = document.querySelector('#updates-list');
  const version = document.querySelector('#site-version');
  let loading = false;

  function releaseArticle(release) {
    const article = document.createElement('article');
    const label = document.createElement('small');
    const date = document.createElement('time');
    date.dateTime = release.date;
    date.textContent = release.date.replaceAll('-', '.');
    if (release.version) label.append(`${release.version} · `);
    label.append(date);
    const title = document.createElement('h3');
    title.textContent = release.title;
    const changes = document.createElement('ul');
    for (const change of release.changes ?? []) {
      const item = document.createElement('li');
      item.textContent = change;
      changes.append(item);
    }
    for (const resource of release.resources ?? []) {
      const item = document.createElement('li');
      const link = document.createElement('a');
      link.href = resource.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = resource.title;
      item.append(`「${resource.section}」新增`, link, `。${resource.description}`);
      changes.append(item);
    }
    article.append(label, title, changes);
    return article;
  }

  async function loadReleases() {
    if (loading || list.childElementCount) return;
    loading = true;
    status.textContent = '正在读取更新记录…';
    try {
      const response = await fetch('releases.json', { signal: AbortSignal.timeout(8_000) });
      if (!response.ok) throw new Error('Release notes unavailable');
      const releases = await response.json();
      list.append(...releases.map(releaseArticle));
      version.textContent = releases[0].version;
      version.hidden = false;
      status.textContent = '';
    } catch {
      status.textContent = '暂时无法读取更新记录，请稍后重试。';
    } finally {
      loading = false;
    }
  }

  new MutationObserver(() => {
    if (dialog.open) void loadReleases();
  }).observe(dialog, { attributeFilter: ['open'] });
  void loadReleases();
})();
