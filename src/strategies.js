import { MOVES } from './rps.js';
import { legalCells, winningCell } from './tictactoe.js';
// Seeded strategy decisions are reproducible; commitment nonces use Web Crypto.
export function random(state) {
  let x = state.rng >>> 0;
  x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
  state.rng = x >>> 0;
  return state.rng / 4294967296;
}
export function chooseMove(state, agent, opponentId) {
  if (random(state) < agent.exploration) return MOVES[Math.floor(random(state) * 3)];
  const history = agent.opponents[opponentId];
  const weights = MOVES.map((move, i) => agent.prior[i] + (history?.[move] || 0));
  let sample = random(state) * weights.reduce((a, b) => a + b, 0);
  let predicted = 2;
  for (let i = 0; i < 3; i++) { sample -= weights[i]; if (sample < 0) { predicted = i; break; } }
  return MOVES[(predicted + 1) % 3];
}

export function chooseTicTacToeCell(state, agent, board, marker) {
  const legal = legalCells(board);
  if (!legal.length) throw new Error('No legal tic-tac-toe move');
  if (random(state) < agent.exploration) return legal[Math.floor(random(state) * legal.length)];
  const win = winningCell(board, marker);
  if (win !== null) return win;
  const block = winningCell(board, marker === 'a' ? 'b' : 'a');
  if (block !== null) return block;
  if (legal.includes(4)) return 4;
  const corners = legal.filter(cell => [0, 2, 6, 8].includes(cell));
  const choices = corners.length ? corners : legal;
  return choices[Math.floor(random(state) * choices.length)];
}
