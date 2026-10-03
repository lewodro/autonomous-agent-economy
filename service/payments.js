import {randomUUID,randomBytes,createHmac,timingSafeEqual} from 'node:crypto';
/** Experimental x402-inspired local protocol. Mock units; NOT x402 wire compatible. */
export class MachinePayments {
 constructor({now=Date.now}={}){this.now=now;this.secret=randomBytes(32);this.challenges=new Map();this.receipts=new Map();this.balances=new Map([['demo-agent',10]]);this.events=[];}
 emit(type,details){this.events.push({seq:this.events.length,type,...details});}
 quote(){const now=this.now();for(const [id,quote] of this.challenges){if(quote.expires<=now){this.challenges.delete(id);this.receipts.delete(id);}}if(this.challenges.size>=1000)throw new Error('Quote limit reached');const challenge={id:randomUUID(),resource:'/premium-tool',amount:2,currency:'mock-tool-credit',mode:'mock',expires:now+60000};this.challenges.set(challenge.id,challenge);return structuredClone(challenge);}
 pay(id,payer){
  const q=this.challenges.get(id);if(!q||q.expires<=this.now())throw new Error('Unknown or expired payment requirement');
  const existing=this.receipts.get(id);if(existing){if(existing.payer!==payer)throw new Error('Payment belongs to another payer');return existing.token;}
  const before=this.balances.get(payer)||0;if(before<q.amount)throw new Error('Payment budget exhausted');
  this.emit('MachinePaymentRequested',{payer,amount:q.amount,resource:q.resource});
  const payload=Buffer.from(JSON.stringify({...q,payer})).toString('base64url');const signature=createHmac('sha256',this.secret).update(payload).digest('base64url');const token=`${payload}.${signature}`;
  this.balances.set(payer,before-q.amount);this.receipts.set(id,{token,payer,result:{tool_result:'Guard blocks a challenge. Consider mutual cooperation and consult the match rules for current action costs.',mode:'mock',payment_id:id}});
  this.emit('MachinePaymentConfirmed',{payer,amount:q.amount,receipt:id});return token;
 }
 verify(token){
  if(typeof token!=='string'||token.length>2048)throw new Error('Invalid demo receipt');
  const [payload,sig,...extra]=token.split('.');if(!payload||!sig||extra.length)throw new Error('Invalid demo receipt');
  const expected=createHmac('sha256',this.secret).update(payload).digest(),given=Buffer.from(sig,'base64url');
  if(expected.length!==given.length||!timingSafeEqual(expected,given))throw new Error('Forged demo receipt');
  const decoded=JSON.parse(Buffer.from(payload,'base64url'));const receipt=this.receipts.get(decoded.id);
  if(!receipt||receipt.token!==token||decoded.resource!=='/premium-tool'||decoded.expires<=this.now())throw new Error('Receipt expired or not settled');
  return structuredClone(receipt.result); // Idempotent delivery; no additional debit.
 }
}
