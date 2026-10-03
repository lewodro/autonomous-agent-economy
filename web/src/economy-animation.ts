import type {AnimationDriver} from './animation.js';
import type {EconomyEvent} from './economy.js';
/** Economic effects are cosmetic; completing them never authorizes funding or payout. */
export interface EconomyAnimationDriver {
 playDeposit(agent:string,amount:string):void;
 playPayout(winner:string,amount:string):void;
 playRefund():void;
}
export type EconomyEffect={type:'deposit';agent:string;amount:string}|{type:'payout';agent:string;amount:string}|{type:'refund'};
export function mapEconomyEffect(e:EconomyEvent):EconomyEffect[]{
 switch(e.type){
 case 'EntryReceived':return e.amount==='0'?[]:[{type:'deposit',agent:e.agent_id,amount:e.amount}];
 case 'SettlementCompleted':return e.amount==='0'?[]:[{type:'payout',agent:e.winner,amount:e.amount}];
 case 'RefundCompleted':return [{type:'refund'}];
 default:return [];
 }
}
export function dispatchEconomyEffect(driver:EconomyAnimationDriver,event:EconomyEvent):void {
 for(const e of mapEconomyEffect(event)){
  if(e.type==='deposit')driver.playDeposit(e.agent,e.amount);
  else if(e.type==='payout')driver.playPayout(e.agent,e.amount);
  else driver.playRefund();
 }
}
/** Reuse the existing bounded/reduced-motion scheduler without adding currency to game credits. */
export class BrowserEconomyAnimationDriver implements EconomyAnimationDriver {
 constructor(private readonly driver:AnimationDriver){}
 playDeposit(agent:string,_amount:string){this.driver.spawnParticles(agent,'coins',6);}
 playPayout(winner:string,_amount:string){this.driver.playCelebration(winner);}
 playRefund(){this.driver.reset();}
}
