const approvedSpritePath=/^\/assets\/avatars\/clean\/[a-z0-9_-]+\.png$/;

/** Keep character selection and world actors on the same approved asset manifest. */
export function approvedAvatarSpritesFromManifest(manifest){
 if(!Array.isArray(manifest?.avatars))throw new TypeError('Avatar manifest must contain an avatars list');
 return new Map(manifest.avatars.filter(avatar=>avatar?.approved===true&&typeof avatar.id==='string'&&/^[-_a-z0-9]{1,40}$/.test(avatar.id)&&typeof avatar.sheet==='string'&&approvedSpritePath.test(avatar.sheet)).map(avatar=>[avatar.id,avatar.sheet.slice(1)]));
}

/** Convert sanitized owner-directory entries into inspectable world actors. */
export function toWorldAgentProfiles(agents,approvedAvatarSprites){
 if(!(approvedAvatarSprites instanceof Map))throw new TypeError('An approved avatar sprite map is required');
 return agents.flatMap(agent=>{
  const sprite=approvedAvatarSprites.get(agent.avatar);
  if(!sprite)return [];
  return [{id:agent.id,name:agent.name,sprite,strategy:agent.strategy,matches:0,wins:0,losses:0,draws:0,
   scope:'user-created agent',recentWinner:false,roomId:null,arenaStatus:'owned',memory:[],latestMatch:null,
   ownership_status:'user',owner_wallet:agent.owner_wallet||null}];
 });
}
