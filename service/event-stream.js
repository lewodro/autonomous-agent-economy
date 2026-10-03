/** Read-only SSE transport. It never schedules turns or waits for viewers. */
export class MatchEventStream {
 constructor(){this.viewers=new Map();this.count=0;}
 connect(session,replay,res){
  const group=this.viewers.get(session)||new Set();
  if(this.count>=16||group.size>=4)throw Object.assign(new Error('Live viewer limit reached'),{status:429});
  this.viewers.set(session,group);group.add(res);this.count++;
  let cleaned=false;
  const cleanup=()=>{if(cleaned)return;cleaned=true;clearInterval(heartbeat);group.delete(res);this.count--;if(!group.size)this.viewers.delete(session);};
  const heartbeat=setInterval(()=>{if(res.writableLength>2_000_000){res.destroy();return;}res.write(': keepalive\n\n');},15000);heartbeat.unref();
  res.on('close',cleanup);res.on('error',cleanup);
  res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache, no-transform','Connection':'keep-alive','X-Accel-Buffering':'no'});
  res.write(`event: snapshot\ndata: ${JSON.stringify({replay})}\n\n`);
 }
 publish(session,result){
  const group=this.viewers.get(session);if(!group)return;
  const replay=result.replay;
  const payload=`event: transition\nid: ${replay.events.length}\ndata: ${JSON.stringify({events:result.events,match_id:replay.match_id,final_state:replay.final_state,winner:replay.winner,statistics:replay.statistics})}\n\n`;
  for(const res of group){if(res.destroyed||res.writableLength>2_000_000){res.destroy();continue;}res.write(payload);}
 }
 close(){for(const group of this.viewers.values())for(const res of group)res.destroy();}
}
