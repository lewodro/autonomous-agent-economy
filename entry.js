const VISIT_KEY = 'last-seat-entry-seen-v1';
const glyphs = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZアイウエオカキクケコサシスセソタチツテト';
const DURATIONS = { intro: 3000, transition: 1050 };
// Gentle ease-in: the bar starts slow, then sweeps to the end. Kept close to
// linear so it still reads as one steady fill rather than a stepped loader.
const easeIn = amount => amount * amount * (1.4 - 0.4 * amount);

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

  // The transition markup is only a matrix wipe, so build its slim progress
  // bar here. That keeps every page on the shared entry script.
  if (mode === 'transition' && !loader.querySelector('[role="progressbar"]')) {
    const track = document.createElement('div');
    track.className = 'entry-loader__track entry-loader__track--transition';
    track.setAttribute('role', 'progressbar');
    track.setAttribute('aria-label', 'Loading page');
    track.setAttribute('aria-valuemin', '0');
    track.setAttribute('aria-valuemax', '100');
    track.setAttribute('aria-valuenow', '0');
    track.innerHTML = '<span></span>';
    loader.appendChild(track);
  }

  const progress = loader.querySelector('[role="progressbar"]');
  const bar = loader.querySelector('.entry-loader__track span');
  const skip = loader.querySelector('.entry-loader__skip');
  let frame = 0;
  let completionTimer = 0;
  let columns = [];
  let started = 0;
  let finished = false;

  function teardown() {
    cancelAnimationFrame(frame);
    clearTimeout(completionTimer);
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
      loader.classList.add('is-closing');
      window.setTimeout(removeNow, 200);
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
    const fill = amount >= 1 ? 1 : easeIn(amount);
    if (bar) bar.style.width = `${fill * 100}%`;
    progress?.setAttribute('aria-valuenow', String(Math.round(fill * 100)));
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
    // rAF is paused in background tabs; make sure the entry always clears.
    completionTimer = window.setTimeout(finish, duration + 60);
  }
}
