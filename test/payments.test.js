import test from 'node:test';import assert from 'node:assert/strict';import {MachinePayments} from '../service/payments.js';
test('machine payment verifies settlement, binds resource and delivers retries without duplicate debits',()=>{
 const p=new MachinePayments(),q=p.quote();const receipt=p.pay(q.id,'demo-agent');assert.equal(p.balances.get('demo-agent'),8);assert.equal(p.pay(q.id,'demo-agent'),receipt);assert.deepEqual(p.verify(receipt),p.verify(receipt));assert.equal(p.balances.get('demo-agent'),8);
 assert.throws(()=>p.verify(receipt.slice(0,-3)+'xxx'),/Forged/);assert.throws(()=>p.pay(q.id,'other'),/another payer/);assert.equal(p.events.length,2);
});
test('machine payment limits, missing receipts and expirations cannot release a service',()=>{
 let now=0;const p=new MachinePayments({now:()=>now});assert.throws(()=>p.verify(''),/Invalid/);const q=p.quote();now=q.expires;assert.throws(()=>p.pay(q.id,'demo-agent'),/expired/);
 for(let i=0;i<5;i++)p.pay(p.quote().id,'demo-agent');assert.throws(()=>p.pay(p.quote().id,'demo-agent'),/budget/);assert.equal(p.balances.get('demo-agent'),0);
});

test('public quotes and tool results cannot mutate settlement authority',()=>{
 const p=new MachinePayments(),q=p.quote();q.amount=-100;q.resource='/arbitrary-service';q.expires=Infinity;
 const token=p.pay(q.id,'demo-agent');assert.equal(p.balances.get('demo-agent'),8);
 const result=p.verify(token);result.tool_result='Forged claim';result.mode='real-payment';
 assert.notEqual(p.verify(token).tool_result,'Forged claim');assert.equal(p.verify(token).mode,'mock');
});

test('expired quotes cannot permanently exhaust capacity and receipts expire at the deadline',()=>{
 let now=0;const p=new MachinePayments({now:()=>now});const first=p.quote(),token=p.pay(first.id,'demo-agent');
 for(let i=1;i<1000;i++)p.quote();assert.throws(()=>p.quote(),/limit/);
 now=first.expires;assert.throws(()=>p.verify(token),/expired/);
 const next=p.quote();assert.equal(p.challenges.size,1);assert.equal(p.receipts.size,0);assert.equal(next.expires,now+60000);
 assert.equal(p.balances.get('demo-agent'),8);
});
