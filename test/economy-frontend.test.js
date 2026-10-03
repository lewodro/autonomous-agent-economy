import test from 'node:test';
import assert from 'node:assert/strict';
import {parseEconomyEvent,reduceEconomy} from '../web/dist/economy.js';
const event=(seq=1)=>({schema_version:1,seq,match_id:'eco-test',type:'FundingOpened',projection:{match_id:'eco-test',simulation_start_id:'history',payment_mode:'mock',entry_amount:'20000000',required_agents:['a','b'],funded_agents:[],pot_amount:'0',state:'funding',settlement_status:'not_started'}});
test('economy projection keeps precision, rejects gaps and never computes payouts',()=>{
 const first=reduceEconomy(null,event());
 assert.equal(reduceEconomy(first,event()),first);
 assert.throws(()=>reduceEconomy(first,event(3)),/gap/);
 const received={...event(2),type:'EntryReceived',agent_id:'a',amount:'20000000',receipt_id:'receipt-a'};
 received.projection.pot_amount='18446744073709551615';
 received.projection.funded_agents=['a'];
 const next=reduceEconomy(first,received);
 assert.equal(next.payments.a,'received');assert.equal(next.match.pot_amount,'18446744073709551615');
 received.projection.pot_amount='0';assert.equal(next.match.pot_amount,'18446744073709551615');
});
test('economy parser rejects mainnet, numeric money, fake participants and malformed events',()=>{
 for(const mutate of [e=>e.projection.payment_mode='mainnet',e=>e.projection.pot_amount=0,e=>e.seq=1.2,e=>e.type='Unknown',e=>e.projection.funded_agents=['outsider'],e=>{e.type='EntryReceived';e.amount='1';e.receipt_id='receipt';},e=>e.projection.required_agents=['a','a']]){
  const e=event();mutate(e);assert.throws(()=>parseEconomyEvent(e));
 }
});
const {mapEconomyEffect,dispatchEconomyEffect,BrowserEconomyAnimationDriver}=await import('../web/dist/economy-animation.js');
test('economy animation only reacts to confirmations and is replaceable',()=>{
 assert.deepEqual(mapEconomyEffect({...event(),type:'EntryRequested',agent_id:'a',amount:'1'}),[]);
 const calls=[],driver={playDeposit:(...args)=>calls.push(args),playPayout:(...args)=>calls.push(args),playRefund:()=>calls.push(['refund'])};
 dispatchEconomyEffect(driver,{...event(),type:'EntryReceived',agent_id:'a',amount:'20000000',receipt_id:'r'});
 assert.deepEqual(calls,[['a','20000000']]);
 assert.deepEqual(mapEconomyEffect({...event(),type:'EntryReceived',agent_id:'a',amount:'0',receipt_id:'r'}),[]);
 const effects=[];const adapter=new BrowserEconomyAnimationDriver({spawnParticles:(...args)=>effects.push(args),playCelebration:id=>effects.push(id),reset:()=>effects.push('reset')});
 adapter.playDeposit('a','18446744073709551615');adapter.playPayout('a','1');adapter.playRefund();
 assert.deepEqual(effects,[['a','coins',6],'a','reset']);
});
