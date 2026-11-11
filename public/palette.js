(() => {
  const palette = document.querySelector('#palette');
  const panel = document.querySelector('#panel-color');
  const title = document.querySelector('#title-color');
  const transparency = document.querySelector('#transparency');
  const sceneTransparency = document.querySelector('#scene-transparency');
  const amount = document.querySelector('#transparency-value');
  const sceneAmount = document.querySelector('#scene-transparency-value');
  const swatches = [...palette.querySelectorAll('[data-color]')];
  const fields = [panel, title, transparency, sceneTransparency];
  const theme = document.documentElement.style;
  const storageKey = 'hinome-tech-autumn-palette';

  function render() {
    theme.setProperty('--panel-color', panel.value);
    theme.setProperty('--title-color', title.value);
    theme.setProperty(
      '--panel-opacity',
      `${100 - transparency.valueAsNumber}%`,
    );
    theme.setProperty(
      '--scene-opacity',
      (100 - sceneTransparency.valueAsNumber) / 100,
    );
    amount.value = `${transparency.value}%`;
    sceneAmount.value = `${sceneTransparency.value}%`;
    for (const swatch of swatches) {
      swatch.setAttribute(
        'aria-pressed',
        String(swatch.dataset.color === panel.value),
      );
    }
  }

  function save() {
    try {
      localStorage.setItem(
        storageKey,
        JSON.stringify(fields.map((field) => field.value)),
      );
    } catch {
      // The controls also work in a local preview with storage disabled.
    }
  }

  try {
    const stored = JSON.parse(localStorage.getItem(storageKey));
    if (
      Array.isArray(stored) &&
      stored.length === fields.length &&
      stored.slice(0, 2).every((value) => /^#[0-9a-f]{6}$/i.test(value)) &&
      stored.slice(2).every((value) => /^\d{1,3}$/.test(value))
    ) {
      fields.forEach((field, index) => {
        field.value = stored[index];
      });
    }
  } catch {
    // Use the default colors and transparency.
  }

  for (const field of fields) {
    field.addEventListener('input', render);
    field.addEventListener('change', save);
  }
  for (const swatch of swatches) {
    swatch.addEventListener('click', () => {
      panel.value = swatch.dataset.color;
      render();
      save();
    });
  }
  document.querySelector('#reset-palette').addEventListener('click', () => {
    fields.forEach((field) => {
      field.value = field.defaultValue;
    });
    render();
    save();
  });
  palette.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && palette.open) {
      palette.open = false;
      palette.querySelector('summary').focus();
    }
  });
  const movingReflection = matchMedia(
    '(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)',
  );
  for (const control of document.querySelectorAll('[data-glass]')) {
    control.addEventListener('pointermove', (event) => {
      if (!movingReflection.matches) return;
      const { left, width } = control.getBoundingClientRect();
      const progress = (event.clientX - left) / width;
      control.style.setProperty('--shine-x', `${Math.round(progress * 100)}%`);
    });
    control.addEventListener('pointerleave', () =>
      control.style.removeProperty('--shine-x'),
    );
  }
  render();
})();
