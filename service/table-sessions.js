import { randomUUID } from 'node:crypto';
import { playCell } from '../src/tictactoe.js';

function fail(code, message, status = 400) { return Object.assign(new Error(message), { code, status }); }
const id = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(value);

/** Server-owned free human table sessions. World coordinates never authorize moves. */
export class TableSessionService {
  constructor() { this.tables = new Map([['table-ttt-main', this.create('table-ttt-main')]]); }
  create(tableId) { return { table_id: tableId, game_type: 'tictactoe', status: 'Empty', seats: [null, null], ready: new Set(), board: Array(9).fill(null), moves: [], moveReceipts: new Map(), match_id: null, result: null, updated_at: new Date().toISOString() }; }
  table(tableId) { const table = this.tables.get(tableId); if (!table) throw fail('TABLE_NOT_FOUND', 'Table not found', 404); return table; }
  summary(table) { return { table_id: table.table_id, game_type: table.game_type, status: table.status, seats: [...table.seats], match_id: table.match_id, board: [...table.board], moves: table.moves.map(move => ({ ...move })), result: table.result, updated_at: table.updated_at }; }
  list() { return [...this.tables.values()].map(table => this.summary(table)); }
  touch(table) { table.updated_at = new Date().toISOString(); }
  sit(tableId, playerId) {
    if (!id(playerId)) throw fail('INVALID_PLAYER', 'Player identity is invalid');
    const table = this.table(tableId), existing = table.seats.indexOf(playerId);
    if (existing >= 0) return { table: this.summary(table), seat: existing };
    const seat = table.seats.indexOf(null); if (seat < 0) throw fail('TABLE_OCCUPIED', 'All table seats are occupied', 409);
    if (!['Empty', 'Waiting', 'Ready'].includes(table.status)) throw fail('MATCH_ALREADY_STARTED', 'This table is already playing', 409);
    table.seats[seat] = playerId; table.status = table.seats.every(Boolean) ? 'Waiting' : 'Waiting'; this.touch(table);
    return { table: this.summary(table), seat };
  }
  leave(tableId, playerId) {
    const table = this.table(tableId), seat = table.seats.indexOf(playerId); if (seat < 0) return { table: this.summary(table), left: false };
    if (table.status === 'Playing') throw fail('MATCH_ALREADY_STARTED', 'Cannot leave a playing table', 409);
    table.seats[seat] = null; table.ready.delete(playerId); table.status = table.seats.some(Boolean) ? 'Waiting' : 'Empty'; this.touch(table);
    return { table: this.summary(table), left: true };
  }
  ready(tableId, playerId) {
    const table = this.table(tableId); if (!table.seats.includes(playerId)) throw fail('NOT_SEATED', 'Sit at this table first', 403);
    if (table.status !== 'Waiting') throw fail('TABLE_NOT_READY', 'Table cannot be readied', 409);
    table.ready.add(playerId);
    if (table.seats.every(player => table.ready.has(player))) { table.status = 'Playing'; table.match_id = `table-${randomUUID()}`; table.board = Array(9).fill(null); table.moves = []; table.moveReceipts.clear(); table.result = null; }
    this.touch(table); return { table: this.summary(table) };
  }
  move(tableId, playerId, cell, moveId) {
    if (!id(moveId)) throw fail('INVALID_MOVE_ID', 'Move id is invalid');
    const table = this.table(tableId), receipt = table.moveReceipts.get(moveId); if (receipt) return structuredClone(receipt);
    if (table.status !== 'Playing') throw fail('MATCH_NOT_PLAYING', 'This table is not playing', 409);
    const seat = table.seats.indexOf(playerId); if (seat < 0) throw fail('NOT_SEATED', 'Only seated players may move', 403);
    const marker = seat === 0 ? 'a' : 'b';
    let next; try { next = playCell(table.board, marker, cell); } catch (error) { throw fail('INVALID_MOVE', error.message, 409); }
    table.board = next.board; table.moves.push({ move_id: moveId, player_id: playerId, cell, marker });
    if (next.result !== null) { table.result = next.result; table.status = 'Finished'; }
    this.touch(table); const result = { table: this.summary(table) }; table.moveReceipts.set(moveId, result); return structuredClone(result);
  }
}
