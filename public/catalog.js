(() => {
  const groups = window.RESOURCE_GROUPS;

  const normalize = (value) =>
    value.normalize('NFKC').toLocaleLowerCase().trim();

  function bindSearch({ input, clear, onRender }) {
    let composing = false;

    function update() {
      const query = input.value.trim();
      const terms = normalize(query).split(/\s+/).filter(Boolean);
      const matches = groups
        .map((group) => ({
          ...group,
          items: group.items.filter((item) => {
            const haystack = normalize(
              [
                item.title,
                item.description,
                group.title,
                ...item.tags,
                ...item.aliases,
              ].join(' '),
            );
            return terms.every((term) => haystack.includes(term));
          }),
        }))
        .filter((group) => group.items.length);
      if (clear) clear.hidden = !input.value;
      onRender(
        matches,
        query,
        matches.reduce((total, group) => total + group.items.length, 0),
      );
    }

    function reset() {
      input.value = '';
      update();
      input.focus();
    }

    input.addEventListener('input', () => {
      if (!composing) update();
    });
    input.addEventListener('compositionstart', () => {
      composing = true;
    });
    input.addEventListener('compositionend', () => {
      composing = false;
      update();
    });
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && input.value && !composing) {
        event.preventDefault();
        reset();
      }
    });
    clear?.addEventListener('click', reset);
    document.addEventListener('keydown', (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        input.focus();
      }
    });
    update();
    return { update, reset };
  }

  window.HinomeCatalog = { groups, bindSearch };
})();
