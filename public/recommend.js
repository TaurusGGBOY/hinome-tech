(() => {
  let api;
  async function request(path, body) {
    if (!api) {
      api = fetch('recommend-config.json', { signal: AbortSignal.timeout(8_000) })
        .then((response) => response.json())
        .then((config) => config.api)
        .catch((error) => {
          api = undefined;
          throw error;
        });
    }
    const response = await fetch(new URL(path, await api), {
      ...(body && {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
      signal: AbortSignal.timeout(18_000),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || '服务暂不可用，请稍后再试。');
    return data;
  }

  function onOpen(dialog, run) {
    new MutationObserver(() => {
      if (dialog.open) void run();
    }).observe(dialog, { attributeFilter: ['open'] });
    if (dialog.open) void run();
  }

  const dialog = document.querySelector('#recommend');
  const form = document.querySelector('#recommend-form');
  const status = document.querySelector('#recommend-status');
  const send = form.querySelector('button[type=submit]');
  const picker = form.querySelector('.tag-picker');
  const tagOptions = picker.querySelector('.tag-options');
  const tagCount = picker.querySelector('.tag-count');
  let connecting = false;
  let sending = false;

  for (const { title } of window.RESOURCE_GROUPS) {
    form.elements.section.add(new Option(title, title));
  }
  for (const tag of window.RESOURCE_TAGS) {
    const label = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.name = 'tags';
    input.value = tag;
    label.append(input, tag);
    tagOptions.append(label);
  }
  function updateTags() {
    const selected = tagOptions.querySelectorAll(':checked').length;
    for (const input of tagOptions.querySelectorAll('input')) {
      input.disabled = !input.checked && selected >= 6;
    }
    tagCount.textContent = selected ? `已选 ${selected} / 6` : '最多选 6 个。';
  }
  tagOptions.addEventListener('change', updateTags);

  onOpen(dialog, async () => {
    if (connecting || !send.disabled) return;
    connecting = true;
    status.textContent = '正在连接投稿服务…';
    try {
      if (!(await request('/config')).accepting) throw new Error();
      send.disabled = false;
      status.textContent = '';
    } catch {
      status.textContent = '投稿服务暂不可用，请稍后再试。';
    } finally {
      connecting = false;
    }
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (sending) return;
    if (!/^https:\/\//i.test(form.elements.url.value.trim())) {
      status.textContent = '请输入 HTTPS 资源链接。';
      form.elements.url.focus();
      return;
    }
    const data = new FormData(form);
    const fields = { ...Object.fromEntries(data), tags: data.getAll('tags') };
    sending = true;
    send.disabled = true;
    status.textContent = '正在提交推荐…';
    try {
      await request('/submit', fields);
      form.reset();
      picker.open = false;
      updateTags();
      status.textContent = '推荐已收到，感谢补充。';
    } catch (error) {
      status.textContent = ['TypeError', 'TimeoutError'].includes(error.name) ? '连接失败，请重试。' : error.message;
    } finally {
      sending = false;
      send.disabled = false;
    }
  });

  const updates = document.querySelector('#updates');
  const updatesStatus = document.querySelector('#updates-status');
  const list = document.querySelector('#updates-list');
  const more = document.querySelector('#updates-more');
  const date = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  });
  let next;
  let loadingUpdates = false;

  function updateArticle(update) {
    const article = document.createElement('article');
    const label = document.createElement('small');
    const time = document.createElement('time');
    time.dateTime = new Date(update.published).toISOString();
    time.textContent = date.format(update.published).replaceAll('/', '.');
    label.append(time, ` · 新增至「${update.section}」`);
    const heading = document.createElement('h3');
    const link = document.createElement('a');
    link.href = update.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = update.title;
    heading.append(link);
    const description = document.createElement('p');
    description.textContent = update.description;
    article.append(label, heading, description);
    return article;
  }

  async function loadUpdates(before) {
    if (loadingUpdates) return;
    loadingUpdates = true;
    more.disabled = true;
    updatesStatus.textContent = '正在读取更新记录…';
    try {
      const path = before ? '/updates?before=' + encodeURIComponent(before) : '/updates';
      const result = await request(path);
      if (!before) list.replaceChildren();
      list.append(...result.updates.map(updateArticle));
      next = result.next;
      more.hidden = !next;
      updatesStatus.textContent = list.childElementCount ? '' : '暂时没有新增收录。';
    } catch {
      updatesStatus.textContent = '暂时无法读取更新记录，请稍后重试。';
    } finally {
      loadingUpdates = false;
      more.disabled = false;
    }
  }

  onOpen(updates, () => loadUpdates());
  more.addEventListener('click', () => loadUpdates(next));
})();
