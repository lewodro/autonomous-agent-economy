const base=process.env.GAME_URL||'http://localhost:3000';
const response=await fetch(base+'/premium-tool');if(response.status!==402)throw new Error('Expected payment-required');
const {payment_required}=await response.json();
const paid=await fetch(base+'/api/payments/pay',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({challenge_id:payment_required.id,payer:'demo-agent'})}).then(r=>r.json());
if(!paid.receipt)throw new Error(paid.error||'Payment failed');
const result=await fetch(base+'/premium-tool',{headers:{'X-Demo-Payment':paid.receipt}}).then(r=>r.json());
console.log(JSON.stringify({payment_required,result,events:paid.events,note:'Experimental x402-inspired flow; mock units and signed local receipt, no blockchain payment.'},null,2));
