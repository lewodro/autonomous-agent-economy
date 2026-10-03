const buildOrder = [
  'Two simulated agents',
  'Fake balances',
  'Rock Paper Scissors engine',
  'Persistent match history',
  'Agent decision loop',
  'Scale simulation to 20 agents',
  'Leaderboard and analytics',
  'Treasury simulator',
  'Dynamic bankroll allocation',
  'Wallet policy engine'
];

const buildList = document.getElementById('build-order');

if (buildList) {
  buildOrder.forEach((item, index) => {
    const li = document.createElement('li');
    li.innerHTML = `<span>${index + 1}.</span> ${item}`;
    buildList.appendChild(li);
  });
}

const counters = document.querySelectorAll('[data-counter]');

const formatCounterValue = (value, suffix = '') => {
  if (Number.isInteger(value)) {
    return `${new Intl.NumberFormat('en-US').format(value)}${suffix}`;
  }

  return `${Number(value).toFixed(2)}${suffix}`;
};

const animateCounter = (element) => {
  const target = Number(element.dataset.counter || 0);
  const suffix = element.dataset.suffix || '';
  const duration = 1200;
  const start = performance.now();

  const tick = (now) => {
    const progress = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    const value = target * eased;
    element.textContent = formatCounterValue(value, suffix);

    if (progress < 1) {
      requestAnimationFrame(tick);
    } else {
      element.textContent = formatCounterValue(target, suffix);
    }
  };

  requestAnimationFrame(tick);
};

counters.forEach((counter) => animateCounter(counter));

const yearEl = document.getElementById('year');
if (yearEl) {
  yearEl.textContent = new Date().getFullYear();
}
