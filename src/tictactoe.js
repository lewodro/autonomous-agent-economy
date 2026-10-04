export const WIN_LINES = Object.freeze([
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
]);

export function outcome(board) {
  if (!Array.isArray(board) || board.length !== 9 || board.some(cell => cell !== null && cell !== 'a' && cell !== 'b')) {
    throw new Error('Invalid tic-tac-toe board');
  }
  const a = board.filter(cell => cell === 'a').length;
  const b = board.filter(cell => cell === 'b').length;
  if (a < b || a > b + 1) throw new Error('Invalid tic-tac-toe turn order');
  const winners = new Set(WIN_LINES.filter(line => line.every(index => board[index] && board[index] === board[line[0]])).map(line => board[line[0]]));
  if (winners.size > 1 || (winners.has('a') && a !== b + 1) || (winners.has('b') && a !== b)) {
    throw new Error('Invalid tic-tac-toe winner');
  }
  return winners.values().next().value || (a + b === 9 ? 'draw' : null);
}

export function legalCells(board) {
  if (outcome(board) !== null) return [];
  return board.flatMap((cell, index) => cell === null ? [index] : []);
}

export function winningCell(board, marker) {
  if (outcome(board) !== null || !['a', 'b'].includes(marker)) return null;
  for (const cell of legalCells(board)) {
    const next = [...board]; next[cell] = marker;
    if (WIN_LINES.some(line => line.every(index => next[index] === marker))) return cell;
  }
  return null;
}

export function playCell(board, marker, cell) {
  if (outcome(board) !== null) throw new Error('Tic-tac-toe game has ended');
  const a = board.filter(value => value === 'a').length;
  const b = board.filter(value => value === 'b').length;
  if (marker !== (a === b ? 'a' : 'b')) throw new Error('Not this agent’s turn');
  if (!Number.isInteger(cell) || cell < 0 || cell > 8 || board[cell] !== null) throw new Error('Choose an empty tic-tac-toe cell');
  const next = [...board]; next[cell] = marker;
  return { board: next, result: outcome(next) };
}

export function verifyTicTacToeProof(match) {
  if (match?.type !== 'tictactoe' || !Array.isArray(match.players) || match.players.length !== 2
    || match.players[0] === match.players[1] || !Array.isArray(match.moves)
    || !['ready_to_settle', 'settled'].includes(match.status)) return false;
  let board = Array(9).fill(null), result = null;
  try {
    for (const move of match.moves) {
      if (result !== null) return false;
      const marker = match.players.indexOf(move.agentId) === 0 ? 'a' : match.players.indexOf(move.agentId) === 1 ? 'b' : null;
      ({ board, result } = playCell(board, marker, move.cell));
    }
  } catch { return false; }
  return result !== null && result === match.result && JSON.stringify(board) === JSON.stringify(match.board);
}
