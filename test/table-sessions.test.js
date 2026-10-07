import test from 'node:test';
import assert from 'node:assert/strict';
import { TableSessionService } from '../service/table-sessions.js';

test('only one player wins a final table seat and a human tic-tac-toe game is authoritative', () => {
  const tables = new TableSessionService();
  assert.equal(tables.sit('table-ttt-main', 'alice').seat, 0);
  assert.equal(tables.sit('table-ttt-main', 'bob').seat, 1);
  assert.throws(() => tables.sit('table-ttt-main', 'charlie'), { code: 'TABLE_OCCUPIED' });
  tables.ready('table-ttt-main', 'alice'); const started = tables.ready('table-ttt-main', 'bob').table;
  assert.equal(started.status, 'Playing'); assert.match(started.match_id, /^table-/);
  for (const [player, cell, move] of [['alice', 0, 'move-1'], ['bob', 3, 'move-2'], ['alice', 1, 'move-3'], ['bob', 4, 'move-4'], ['alice', 2, 'move-5']]) tables.move('table-ttt-main', player, cell, move);
  const finished = tables.list()[0]; assert.equal(finished.status, 'Finished'); assert.equal(finished.result, 'a');
  assert.deepEqual(tables.move('table-ttt-main', 'alice', 2, 'move-5').table, finished);
  assert.throws(() => tables.move('table-ttt-main', 'bob', 8, 'move-6'), { code: 'MATCH_NOT_PLAYING' });
});

test('players cannot ready, move, or leave a table outside its valid state', () => {
  const tables = new TableSessionService();
  assert.throws(() => tables.ready('table-ttt-main', 'nobody'), { code: 'NOT_SEATED' });
  tables.sit('table-ttt-main', 'alice');
  assert.equal(tables.leave('table-ttt-main', 'alice').table.status, 'Empty');
  assert.throws(() => tables.move('table-ttt-main', 'alice', 0, 'one'), { code: 'MATCH_NOT_PLAYING' });
});
