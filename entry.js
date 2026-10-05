const DURATION_MS = 3600;
const VISIT_KEY = 'last-seat-entry-seen-v1';
const glyphs = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZアイウエオカキクケコサシスセソタチツテト';

const dialog = document.getElementById('entry-loader');
if (dialog) {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let alreadySeen = false;
  try { alreadySeen = sessionStorage.getItem(VISIT_KEY) === '1'; } catch { /* storage can be disabled */ }

  if (!reducedMotion && !alreadySeen && typeof dialog.showModal === 'function') {
    const canvas = dialog.querySelector('.entry-matrix');
    const context = canvas?.getContext('2d', { alpha: false });
    const progress = dialog.querySelector('[role="progressbar"]');
    const bar = dialog.querySelector('.entry-loader__track span');
    const skip = dialog.querySelector('.entry-loader__skip');
    let frame = 0;
    let columns = [];
    let started = 0;
    let finished = false;

    function resize() {
      if (!canvas || !context) return;
      const ratio = Math.min(window.devicePixelRatio || 1, 1.25);
      canvas.width = Math.max(1, Math.floor(window.innerWidth * ratio));
      canvas.height = Math.max(1, Math.floor(window.innerHeight * ratio));
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      const width = window.innerWidth;
      const fontSize = 15;
      columns = Array.from({ length: Math.ceil(width / fontSize) }, (_, index) => ({
        x: index * fontSize,
        y: Math.random() * window.innerHeight,
        speed: 1.1 + Math.random() * 2.7
      }));
      context.font = `${fontSize}px monospace`;
    }

    function draw(now) {
      if (finished || !context) return;
      const elapsed = now - started;
      const amount = Math.min(1, elapsed / DURATION_MS);
      context.fillStyle = 'rgba(2, 9, 6, 0.16)';
      context.fillRect(0, 0, window.innerWidth, window.innerHeight);
      for (const column of columns) {
        const glyph = glyphs[(Math.random() * glyphs.length) | 0];
        context.fillStyle = Math.random() > .975 ? '#d2ffe0' : '#35b765';
        context.fillText(glyph, column.x, column.y);
        column.y += column.speed * (1 + amount * .55);
        if (column.y > window.innerHeight + 20 && Math.random() > .985) column.y = -15;
      }
      if (bar) bar.style.width = `${amount * 100}%`;
      progress?.setAttribute('aria-valuenow', String(Math.round(amount * 100)));
      if (elapsed >= DURATION_MS) finish();
      else frame = requestAnimationFrame(draw);
    }

    function finish() {
      if (finished) return;
      finished = true;
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', resize);
      try { sessionStorage.setItem(VISIT_KEY, '1'); } catch { /* animation still works without storage */ }
      if (dialog.open) dialog.close();
      dialog.remove();
    }

    dialog.addEventListener('cancel', event => { event.preventDefault(); finish(); });
    skip?.addEventListener('click', finish);
    window.addEventListener('resize', resize, { passive: true });
    resize();
    dialog.showModal();
    started = performance.now();
    draw(started);
  } else {
    dialog.remove();
  }
}
