(() => {
  const root = document.querySelector('#groups');
  const status = document.querySelector('#status');
  const empty = document.querySelector('#empty');
  const controls = HinomeCatalog.bindSearch({
    input: document.querySelector('#search'),
    clear: document.querySelector('#clear'),
    onRender(groups, query, count) {
      root.replaceChildren();
      for (const group of groups) {
        const section = document.createElement('section');
        section.className = 'group';
        const h2 = document.createElement('h2');
        h2.textContent = group.title;
        const list = document.createElement('ul');
        list.className = 'items';
        for (const item of group.items) {
          const li = document.createElement('li');
          const link = document.createElement('a');
          link.className = 'item';
          link.href = item.url;
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          link.setAttribute('aria-label', `${item.title}（在新标签页打开）`);
          const icon = document.createElement('img');
          icon.className = 'resource-icon';
          icon.src = `assets/${item.icon}.png`;
          icon.alt = '';
          icon.width = 24;
          icon.height = 24;
          const body = document.createElement('span');
          body.className = 'item-body';
          const title = document.createElement('span');
          title.className = 'item-title';
          title.textContent = item.title;
          const description = document.createElement('span');
          description.className = 'description';
          description.textContent = item.description;
          const tags = document.createElement('span');
          tags.className = 'tags';
          item.tags.forEach((tag) => {
            const el = document.createElement('span');
            el.textContent = tag;
            tags.append(el);
          });
          const arrow = document.createElement('span');
          arrow.className = 'arrow';
          arrow.setAttribute('aria-hidden', 'true');
          arrow.textContent = '↗';
          body.append(title, description, tags);
          link.append(icon, body, arrow);
          li.append(link);
          list.append(li);
        }
        section.append(h2, list);
        root.append(section);
      }
      empty.hidden = count !== 0;
      status.textContent = query ? `找到 ${count} 项资源` : '';
    },
  });
  document
    .querySelector('#empty-clear')
    .addEventListener('click', controls.reset);
})();
