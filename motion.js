(() => {
  const selectors = [
    'main > section', 'main > .world-bar', 'main > .world-footer',
    '.game-header', '.controls', '.action-lane', '.site-footer',
    '.site-head', '.site-foot', '.intro', '.status-line', '.next-note',
    '.entry', '.room-card', '.private-panel', '.compound-card'
  ].join(',');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const root = document.documentElement;
  root.classList.add('motion');

  let observer;
  if (!reducedMotion) {
    observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add('is-revealed');
        observer.unobserve(entry.target);
      }
    }, { rootMargin: '0px 0px -6% 0px', threshold: 0.06 });
  }

  function scan() {
    if (!observer) return;
    const found = document.querySelectorAll(selectors);
    let index = 0;
    for (const node of found) {
      if (node.dataset.motionReady === '1') continue;
      node.dataset.motionReady = '1';
      // Stagger items that share a parent so groups ripple instead of popping together.
      const siblings = node.parentElement ? node.parentElement.querySelectorAll(':scope > ' + node.tagName.toLowerCase()) : [];
      if (siblings.length > 1 && siblings.length < 9) {
        node.style.animationDelay = `${Math.min(index, 6) * 55}ms`;
        index += 1;
      }
      observer.observe(node);
    }
  }

  function setupProgress() {
    if (reducedMotion) return;
    const bar = document.createElement('div');
    bar.className = 'scroll-progress';
    bar.setAttribute('aria-hidden', 'true');
    const fill = document.createElement('span');
    bar.append(fill);
    document.body.append(bar);
    let queued = false;
    const update = () => {
      queued = false;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      const ratio = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
      fill.style.transform = `scaleX(${ratio})`;
    };
    const request = () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(update);
    };
    window.addEventListener('scroll', request, { passive: true });
    window.addEventListener('resize', request, { passive: true });
    update();
  }

  scan();
  setupProgress();
  document.addEventListener('motion:scan', scan);
})();
