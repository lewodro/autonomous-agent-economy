import { api } from './api.js';

interface OngoingGame {
  session: string;
  turn: number;
  alive: number;
  seats: number;
  agents: { name: string; provider: string }[];
}

const escape = (value: string) => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);

export function mountOngoingGames(element: HTMLElement) {
  let active = true;
  async function refresh() {
    if (!active) return;
    try {
      const { games } = await api<{ games: OngoingGame[] }>('/api/games/ongoing');
      element.innerHTML = games.length ? games.map(game =>
        `<a class="ongoing-game" href="/?watch=${encodeURIComponent(game.session)}"><strong>TURN ${game.turn} · ${game.alive}/${game.seats} SEATED</strong><span>${game.agents.slice(0, 4).map(agent => escape(agent.name)).join(' · ')}${game.agents.length > 4 ? ` · +${game.agents.length - 4}` : ''}</span><small>Watch live ↗</small></a>`
      ).join('') : '<p class="personality">No other games are running. Start one and it will appear here.</p>';
    } catch { element.textContent = 'Games are temporarily unavailable. Retrying…'; }
  }
  void refresh();
  const timer = window.setInterval(() => { if (!document.hidden) void refresh(); }, 15_000);
  return () => { active = false; window.clearInterval(timer); };
}
