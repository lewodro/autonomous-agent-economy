const VISIT_KEY = 'last-seat-entry-seen-v1';
const glyphs = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZアイウエオカキクケコサシスセソタチツテト';
const DURATIONS = { intro: 3000, transition: 1050 };

const loader = document.getElementById('entry-loader');
let releaseEntry;
// The world module waits on this before opening the character picker, so the
// intro is never hidden behind another modal.
window.entryGate = new Promise(resolve => { releaseEntry = resolve; });

if (!loader) {
  releaseEntry();
} else {
  const mode = loader.dataset.mode === 'transition' ? 'transition' : 'intro';
  const duration = DURATIONS[mode];
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const isDialog = typeof HTMLDialogElement !== 'undefined' && loader instanceof HTMLDialogElement;
  let alreadySeen = false;
  try { alreadySeen = sessionStorage.getItem(VISIT_KEY) === '1'; } catch { /* storage can be disabled */ }

  const shouldRun = !reducedMotion && (mode === 'transition' || !alreadySeen);
  const canvas = loader.querySelector('.entry-matrix');
  const context = canvas?.getContext('2d', { alpha: false });
  const progress = loader.querySelector('[role="progressbar"]');
  const bar = loader.querySelector('.entry-loader__track span');
  const skip = loader.querySelector('.entry-loader__skip');
  let frame = 0;
  let columns = [];
  let started = 0;
  let finished = false;

  function teardown() {
    cancelAnimationFrame(frame);
    window.removeEventListener('resize', resize);
  }

  function removeNow() {
    if (isDialog && loader.open) loader.close();
    loader.remove();
    releaseEntry();
  }

  function finish() {
    if (finished) return;
    finished = true;
    teardown();
    if (mode === 'intro') {
      try { sessionStorage.setItem(VISIT_KEY, '1'); } catch { /* animation still works without storage */ }
    }
    if (mode === 'transition') {
      // The overlay fades itself out through CSS; just clear the node after it.
      window.setTimeout(removeNow, 180);
      return;
    }
    loader.classList.add('is-closing');
    window.setTimeout(removeNow, 380);
  }

  function resize() {
    if (!canvas || !context) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 1.25);
    canvas.width = Math.max(1, Math.floor(window.innerWidth * ratio));
    canvas.height = Math.max(1, Math.floor(window.innerHeight * ratio));
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    const fontSize = mode === 'intro' ? 15 : 17;
    columns = Array.from({ length: Math.ceil(window.innerWidth / fontSize) }, (_, index) => ({
      x: index * fontSize,
      y: Math.random() * window.innerHeight,
      speed: 1.1 + Math.random() * 2.7
    }));
    context.font = `${fontSize}px monospace`;
  }

  function draw(now) {
    if (finished || !context) return;
    const elapsed = now - started;
    const amount = Math.min(1, elapsed / duration);
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
    if (elapsed >= duration) finish();
    else frame = requestAnimationFrame(draw);
  }

  if (!shouldRun) {
    removeNow();
  } else {
    skip?.addEventListener('click', finish);
    loader.addEventListener('cancel', event => { event.preventDefault(); finish(); });
    window.addEventListener('resize', resize, { passive: true });
    resize();
    if (isDialog) {
      if (typeof loader.showModal === 'function') loader.showModal();
      else loader.setAttribute('open', '');
    }
    started = performance.now();
    frame = requestAnimationFrame(draw);
  }
}
