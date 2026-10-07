const emptyGame=()=>({matches:0,draws:0,decisions:0});
export function emptyArenaSummary(){return {version:1,matches:0,draws:0,decisions:0,updated_at:null,games:{rps:emptyGame(),tictactoe:emptyGame()},agents:{}};}
const add=(left,right)=>{
  const value=left+right;
  if(!Number.isSafeInteger(value))throw new Error('Arena cumulative statistics exceed the supported range');
  return value;
};
export function validateArenaSummary(value){
  const count=v=>Number.isSafeInteger(v)&&v>=0;
  if(value?.version!==1||!count(value.matches)||!count(value.draws)||!count(value.decisions)||!(value.updated_at===null||typeof value.updated_at==='string'&&!Number.isNaN(Date.parse(value.updated_at)))||!value.games||!value.agents)throw new Error('Invalid arena cumulative statistics');
  for(const game of ['rps','tictactoe'])if(!count(value.games[game]?.matches)||!count(value.games[game]?.draws)||!count(value.games[game]?.decisions))throw new Error('Invalid arena cumulative game statistics');
  for(const [id,agent] of Object.entries(value.agents))if(!/^agent-[1-9][0-9]*$/.test(id)||!count(agent?.matches)||!count(agent?.wins)||!count(agent?.draws)||agent.wins+agent.draws>agent.matches)throw new Error('Invalid arena cumulative agent statistics');
  const gameMatches=add(value.games.rps.matches,value.games.tictactoe.matches);
  const gameDraws=add(value.games.rps.draws,value.games.tictactoe.draws);
  const gameDecisions=add(value.games.rps.decisions,value.games.tictactoe.decisions);
  if(gameMatches!==value.matches||gameDraws!==value.draws||gameDecisions!==value.decisions)throw new Error('Arena cumulative totals do not reconcile with game totals');
  const agentTotals=Object.values(value.agents).reduce((totals,agent)=>({matches:add(totals.matches,agent.matches),wins:add(totals.wins,agent.wins),draws:add(totals.draws,agent.draws)}),{matches:0,wins:0,draws:0});
  if(agentTotals.matches!==add(value.matches,value.matches)||agentTotals.wins!==value.matches-value.draws||agentTotals.draws!==add(value.draws,value.draws))throw new Error('Arena cumulative totals do not reconcile with agent statistics');
  return structuredClone(value);
}
export function summarizeArenaRun(run){
  const summary=emptyArenaSummary();
  for(const match of run.state.matches.filter(value=>value.status==='settled')){
    const game=match.type==='tictactoe'?'tictactoe':run.game==='tictactoe'?'tictactoe':'rps';
    const decisions=game==='tictactoe'?match.moves.length:Object.keys(match.reveals||{}).length;
    summary.matches=add(summary.matches,1);summary.decisions=add(summary.decisions,decisions);
    summary.games[game].matches=add(summary.games[game].matches,1);summary.games[game].decisions=add(summary.games[game].decisions,decisions);
    if(match.result==='draw'){summary.draws=add(summary.draws,1);summary.games[game].draws=add(summary.games[game].draws,1);}
    for(const [index,id] of match.players.entries()){
      const agent=summary.agents[id]??={matches:0,wins:0,draws:0};agent.matches=add(agent.matches,1);
      if(match.result==='draw')agent.draws=add(agent.draws,1);
      else if(match.result===(index===0?'a':'b'))agent.wins=add(agent.wins,1);
    }
    const completed=run.state.events.find(event=>event.type==='GAME_FINISHED'&&event.data.matchId===match.id)?.time;
    if(completed&&(!summary.updated_at||completed>summary.updated_at))summary.updated_at=completed;
  }
  return summary;
}
export function mergeArenaSummaries(left,right){
  const a=validateArenaSummary(left),b=validateArenaSummary(right),result=emptyArenaSummary();
  result.matches=add(a.matches,b.matches);result.draws=add(a.draws,b.draws);result.decisions=add(a.decisions,b.decisions);
  result.updated_at=[a.updated_at,b.updated_at].filter(Boolean).sort().at(-1)||null;
  for(const game of ['rps','tictactoe'])for(const field of ['matches','draws','decisions'])result.games[game][field]=add(a.games[game][field],b.games[game][field]);
  for(const id of new Set([...Object.keys(a.agents),...Object.keys(b.agents)])){
    const first=a.agents[id]||{matches:0,wins:0,draws:0},second=b.agents[id]||{matches:0,wins:0,draws:0};
    result.agents[id]={matches:add(first.matches,second.matches),wins:add(first.wins,second.wins),draws:add(first.draws,second.draws)};
  }
  return validateArenaSummary(result);
}
