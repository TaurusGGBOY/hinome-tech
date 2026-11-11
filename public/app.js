(() => {
  const groups = document.querySelector('#groups');
  const input = document.querySelector('#search');
  const clear = document.querySelector('#clear');
  const empty = document.querySelector('#empty');
  const status = document.querySelector('#search-status');
  const icons = {
    tool: '<path d="M14 5a5 5 0 0 0-6 6l-4 4a2.1 2.1 0 0 0 3 3l4-4a5 5 0 0 0 6-6l-3 3-3-3z"/>',
    eye: '<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z"/><circle cx="12" cy="12" r="2.5"/>',
    sail: '<path d="M12 3v13M10 5 5 14h5zM14 6l5 8h-5zM3 18h18l-2 3H6z"/>',
    spark: '<path d="M12 3 14 9l6 3-6 2-2 7-2-7-6-2 6-3z"/>',
    letter: '<rect x="3" y="5" width="18" height="14" rx="1"/><path d="m3 7 9 7 9-7"/>',
    music: '<path d="M10 18V6l9-2v12M10 9l9-2"/><ellipse cx="7" cy="18" rx="3" ry="2"/><ellipse cx="16" cy="16" rx="3" ry="2"/>',
    book: '<path d="M12 6c-3-2-6-2-9-1v13c3-1 6-1 9 1 3-2 6-2 9-1V5c-3-1-6-1-9 1ZM12 6v13"/>',
    play: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m10 9 5 3-5 3z"/>'
  };
  const svg = name => `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[name] || icons.book}</svg>`;
  const normalize = s => s.normalize('NFKC').toLocaleLowerCase().trim();
  function render() {
    const query = normalize(input.value);
    const terms = query.split(/\s+/).filter(Boolean);
    let total = 0;
    groups.replaceChildren();
    for (const group of window.RESOURCE_GROUPS) {
      const items = group.items.filter(item => {
        const haystack = normalize([item.title, item.description, ...item.tags, ...item.aliases, group.title].join(' '));
        return terms.every(term => haystack.includes(term));
      });
      if (!items.length) continue;
      total += items.length;
      const section = document.createElement('section');
      section.className = 'group';
      const heading = document.createElement('div');
      heading.className = 'group-heading';
      heading.innerHTML = `<div class="group-icon">${svg(group.icon)}</div><div><div class="group-title"><h3></h3></div><p></p></div><div class="group-rule"></div>`;
      heading.querySelector('h3').textContent = group.title;
      heading.querySelector('p').textContent = group.description;
      const list = document.createElement('ul');
      list.className = 'cards';
      for (const item of items) {
        const li = document.createElement('li');
        const a = document.createElement('a');
        a.className = 'card'; a.href = item.url; a.target = '_blank'; a.rel = 'noopener noreferrer';
        a.setAttribute('aria-label', `${item.title}（在新标签页打开）`);
        a.innerHTML = `<div class="card-top"><span class="card-icon">${svg(item.icon)}</span><span class="arrow" aria-hidden="true">↗</span></div><h4></h4><p></p><div class="tags"></div>`;
        a.querySelector('h4').textContent = item.title;
        a.querySelector('p').textContent = item.description;
        for (const tag of item.tags) { const el = document.createElement('span'); el.textContent = tag; a.querySelector('.tags').append(el); }
        li.append(a); list.append(li);
      }
      section.append(heading, list); groups.append(section);
    }
    clear.hidden = !input.value;
    empty.hidden = total !== 0;
    status.textContent = query ? `找到 ${total} 项资源` : '';
  }
  let composing = false;
  input.addEventListener('compositionstart', () => { composing = true; });
  input.addEventListener('compositionend', () => { composing = false; render(); });
  input.addEventListener('input', () => { if (!composing) render(); });
  function reset() { input.value = ''; render(); input.focus(); }
  clear.addEventListener('click', reset);
  document.querySelector('#empty-clear').addEventListener('click', reset);
  document.addEventListener('keydown', event => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); input.focus(); }
  });
  render();
})();
