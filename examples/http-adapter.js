// Replace this deterministic example with your preferred model SDK.
// Input: {agent, observation, response_schema}. Output: {action,target,reason}.
import http from 'node:http';
http.createServer(async(req,res)=>{
  try {
    let text='';for await(const chunk of req){text+=chunk;if(text.length>65536)throw new Error('Too large');}
    const {agent,observation}=JSON.parse(text);
    const others=observation.agents.filter(a=>a.id!==agent.id&&a.alive);
    const target=others.sort((a,b)=>b.credits-a.credits||a.id.localeCompare(b.id))[0];
    const challenge=observation.turn%3===0&&target;
    res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({action:challenge?'challenge':'work',target:challenge?target.id:null,reason:challenge?'Challenge the richest seat every third turn.':'Earn while studying the table.'}));
  }catch{res.writeHead(400).end();}
}).listen(4010,'127.0.0.1',()=>console.log('Example decision adapter: http://127.0.0.1:4010'));
