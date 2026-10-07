const avatarSprites=Object.freeze({
 visitor_ember:'assets/avatars/clean/ember.png',
 visitor_atlas:'assets/avatars/clean/atlas.png',
 visitor_nova:'assets/avatars/clean/nova.png',
 visitor_echo:'assets/avatars/clean/echo.png',
});

/** Convert sanitized owner-directory entries into inspectable world actors. */
export function toWorldAgentProfiles(agents){
 return agents.flatMap(agent=>{
  const sprite=avatarSprites[agent.avatar];
  if(!sprite)return [];
  return [{id:agent.id,name:agent.name,sprite,strategy:agent.strategy,matches:0,wins:0,losses:0,draws:0,
   scope:'user-created agent',recentWinner:false,roomId:null,arenaStatus:'owned',memory:[],latestMatch:null,
   ownership_status:'user',owner_wallet:agent.owner_wallet||null}];
 });
}
