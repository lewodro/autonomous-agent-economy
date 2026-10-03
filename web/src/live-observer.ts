import {mergeTransition} from './transport.js';
import type {Transition} from './transport.js';
import type {Replay} from './types.js';
/** EventSource reconnection sends a fresh checkpoint; no POST or game rules. */
export class LiveObserver {
 private source:EventSource;
 private run:Replay|null=null;
 private timer:ReturnType<typeof setTimeout>|null=null;
 private closed=false;
 constructor(private session:string,private changed:(run:Replay)=>void,private status:(connected:boolean)=>void){this.source=this.open();}
 private open(){
  const source=new EventSource(`/api/matches/${encodeURIComponent(this.session)}/events`);
  source.addEventListener('snapshot',event=>{
   if(this.closed||source!==this.source)return;
   try{this.acceptSnapshot(JSON.parse((event as MessageEvent<string>).data).replay as Replay);}catch{this.reconnect();}
  });
  source.addEventListener('transition',event=>{
   if(this.closed||source!==this.source)return;
   try{if(!this.run)throw new Error('Missing snapshot');const next=JSON.parse((event as MessageEvent<string>).data) as Transition;
    if(next.events.length&&next.events[next.events.length-1]!.seq<this.run.events.length)return;
    this.run=mergeTransition(this.run,next);this.changed(this.run);
   }catch{this.reconnect();}
  });
  source.onopen=()=>{if(!this.closed&&source===this.source)this.status(true);};source.onerror=()=>{if(!this.closed&&source===this.source)this.status(false);};
  return source;
 }
 private acceptSnapshot(run:Replay){this.run=run;this.changed(run);this.status(true);}
 private reconnect(){this.status(false);this.source.close();if(this.timer)clearTimeout(this.timer);this.timer=setTimeout(()=>{if(!this.closed)this.source=this.open();},500);}
 close(){this.closed=true;if(this.timer)clearTimeout(this.timer);this.source.close();}
}
