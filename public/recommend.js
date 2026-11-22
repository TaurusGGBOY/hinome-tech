(() => {
  const dialog = document.querySelector('#recommend');
  const form = document.querySelector('#recommend-form');
  const status = document.querySelector('#recommend-status');
  const resultsStatus = document.querySelector('#recommend-results-status');
  const results = document.querySelector('#recommend-results');
  const send = form.querySelector('button[type=submit]');
  const lookup = document.querySelector('#recommend-lookup');
  const lookupStatus = document.querySelector('#recommend-lookup-status');
  const receiptPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
  let api;
  let loading;
  let sending = false;

  for (const { title } of window.RESOURCE_GROUPS) {
    form.elements.section.add(new Option(title, title));
  }

  async function request(path, body) {
    const response = await fetch(new URL(path, api), {
      ...(body && {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
      signal: AbortSignal.timeout(18_000),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || '操作暂时失败，请稍后再试。');
    return data;
  }

  function resultText(decision) {
    if (decision.status === 'published') return `已收录 · ${decision.title}`;
    if (decision.status === 'rejected') return `未收录 · ${decision.reason}`;
    if (decision.status === 'publishing') return '已通过审核，等待上线。';
    return '等待审核。';
  }

  async function showResults() {
    try {
      const { decisions } = await request('/results');
      results.replaceChildren(...decisions.map((decision) => {
        const item = document.createElement('li');
        item.textContent = `${resultText(decision)} · ${decision.id}`;
        return item;
      }));
      results.hidden = !decisions.length;
      resultsStatus.textContent = decisions.length ? '' : '暂无审核结果。';
    } catch {
      resultsStatus.textContent = '暂时无法读取审核结果。';
    }
  }

  async function prepare() {
    status.textContent = '正在连接投稿服务…';
    try {
      const response = await fetch('recommend-config.json', { signal: AbortSignal.timeout(8_000) });
      const config = await response.json();
      if (!config.api) throw new Error();
      api = config.api;
      void showResults();
      const service = await request('/config');
      if (!service.accepting) throw new Error();
      send.disabled = false;
      status.textContent = '';
    } catch {
      status.textContent = '投稿服务暂未开放或无法连接，请稍后再试。';
      loading = undefined;
    }
  }

  new MutationObserver(() => {
    if (dialog.open && !loading) loading = prepare();
  }).observe(dialog, { attributeFilter: ['open'] });
  if (dialog.open) loading = prepare();

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (sending) return;
    if (!/^https:\/\//i.test(form.elements.url.value.trim())) {
      status.textContent = '请输入 HTTPS 资源链接。';
      form.elements.url.focus();
      return;
    }
    sending = true;
    send.disabled = true;
    status.textContent = '正在提交推荐…';
    try {
      const fields = Object.fromEntries(new FormData(form));
      const { id } = await request('/submit', fields);
      form.reset();
      lookup.elements.receipt.value = id;
      status.textContent = `推荐已提交，等待审核。请保存编号 ${id}。`;
    } catch (error) {
      status.textContent = error instanceof TypeError ? '连接失败，请重试。' : error.message;
    } finally {
      sending = false;
      send.disabled = false;
    }
  });

  lookup.addEventListener('submit', async (event) => {
    event.preventDefault();
    const id = lookup.elements.receipt.value.trim().toLowerCase();
    if (!receiptPattern.test(id)) {
      lookupStatus.textContent = '请填写完整的投稿编号。';
      return;
    }
    if (!api) {
      lookupStatus.textContent = '投稿服务暂时不可用。';
      return;
    }
    const button = lookup.querySelector('button');
    button.disabled = true;
    lookupStatus.textContent = '正在查询…';
    try {
      lookupStatus.textContent = resultText(await request('/status/' + id));
    } catch (error) {
      lookupStatus.textContent = error instanceof TypeError ? '连接失败，请重试。' : error.message;
    } finally {
      button.disabled = false;
    }
  });
})();
