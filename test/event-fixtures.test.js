import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseEconomyEvent,reduceEconomy} from '../web/dist/economy.js';
test('reviewed Rust event fixture is accepted without schema drift by the browser',()=>{
 const events=JSON.parse(readFileSync(new URL('./fixtures/economy/settlement-v1.json',import.meta.url)));
 let view=null;
 for(const event of events){assert.deepEqual(parseEconomyEvent(event),event);view=reduceEconomy(view,event);}
 assert.equal(view.match.state,'settled');assert.equal(view.match.pot_amount,'0');
 for(const kind of ['EntryReceived','PotUpdated','FundsLocked','SettlementCompleted'])assert.ok(events.some(e=>e.type===kind));
});
test('refund fixture preserves exact amounts and terminal exclusion',()=>{
 const events=JSON.parse(readFileSync(new URL('./fixtures/economy/refund-v1.json',import.meta.url)));
 let view=null;for(const event of events)view=reduceEconomy(view,event);
 assert.equal(view.match.state,'refunded');assert.equal(view.match.pot_amount,'0');
 assert.ok(events.some(e=>e.type==='RefundCompleted'));assert.equal(events.some(e=>e.type==='SettlementCompleted'),false);
});
