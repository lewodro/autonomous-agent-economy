/** Opt-in stderr JSON; allowlisted public identifiers only. Never serialize an entire object. */
export function economyLog(event,context={},write=line=>process.stderr.write(line+'\n')){
 if(process.env.ECONOMY_LOG!=='1')return;
 const row={timestamp:new Date().toISOString(),component:'economy',event};
 for(const key of ['session','match_id','operation_id','payment_mode','reference','code','seq']){
  const value=context[key];if(typeof value==='string'||(typeof value==='number'&&Number.isSafeInteger(value)))row[key]=value;
 }
 write(JSON.stringify(row));
}
