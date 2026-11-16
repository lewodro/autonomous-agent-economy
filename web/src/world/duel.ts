/**
 * One authoritative shared duel, opened by the two visitors who accepted a
 * proximity challenge. This page only renders server state and submits a move
 * or a pick; all rules, turn order and results stay on the server.
 */
type Game='tictactoe'|'rps';
type Marker='a'|'b';
type RpsMove='rock'|'paper'|'scissors';
interface DuelPlayerView{player_id:string;name:string;marker:Marker;picked?:boolean;pick?:RpsMove|null}
interface DuelView{
  duel_id:string;game:Game;status:'playing'|'finished'|'expired';revision:number;created_at:string;expires_at:string;
  you:DuelPlayerView;opponent:DuelPlayerView;result:Marker|'draw'|null;winner_player_id:string|null;
  board?:Array<Marker|null>;moves?:Array<{player_id:string;cell:number}>;turn_player_id?:string|null;
}
const $=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T;
const title=$<HTMLElement>('duel-title'),status=$<HTMLElement>('duel-status'),players=$<HTMLDivElement>('duel-players'),board=$<HTMLDivElement>('duel-board'),actions=$<HTMLDivElement>('duel-actions'),hint=$<HTMLElement>('duel-hint'),result=$<HTMLElement>('duel-result');
const POLL_MS=800;
const GAME_LABEL:Record<Game,string>={tictactoe:'TIC-TAC-TOE',rps:'ROCK PAPER SCISSORS'};
const MOVES:RpsMove[]=['rock','paper','scissors'];
const duelId=location.pathname.match(/^\/duel\/(duel-[a-f0-9-]{36})$/)?.[1]??'';
let view:DuelView|null=null,busy=false,stopped=false,timer=0,errorText='';

function setStatus(message:string,tone:'info'|'good'|'warn'|'bad'='info'):void{
  status.textContent=message;status.dataset.tone=tone;
}
async function duelRequest<T>(path:string,init?:RequestInit):Promise<T>{
  const response=await fetch(path,{...init,credentials:'same-origin',signal:AbortSignal.timeout(8_000)});
  const data=await response.json().catch(()=>({})) as {error?:string;code?:string};
  if(!response.ok)throw Object.assign(new Error(data?.error||'Match request failed'),{status:response.status,code:data?.code});
  return data as T;
}
function codeOf(error:unknown):string{return error&&typeof error==='object'&&'code'in error?String((error as{code:unknown}).code):'';}
function playerCard(player:DuelPlayerView,label:string,turn:boolean):HTMLElement{
  const card=document.createElement('div');card.className='duel-player'+(turn?' is-turn':'');
  const name=document.createElement('strong');name.textContent=player.name.toUpperCase();
  const sub=document.createElement('small');sub.textContent=label;
  card.append(name,sub);return card;
}
function renderPlayers():void{
  if(!view)return;
  players.replaceChildren();
  const yourTurn=view.status==='playing'&&view.turn_player_id===view.you.player_id;
  const theirTurn=view.status==='playing'&&view.turn_player_id===view.opponent.player_id;
  players.append(
    playerCard(view.you,view.game==='tictactoe'?`YOU · ${view.you.marker==='a'?'X':'O'}`:'YOU',yourTurn),
    Object.assign(document.createElement('span'),{className:'duel-vs',textContent:'VS'}),
    playerCard(view.opponent,view.game==='tictactoe'?`${view.opponent.marker==='a'?'X':'O'} · OPPONENT`:'OPPONENT',theirTurn),
  );
}
function renderBoard():void{
  board.hidden=view?.game!=='tictactoe';
  if(!view||view.game!=='tictactoe')return;
  const cells=view.board??[];
  board.replaceChildren();
  for(let index=0;index<9;index++){
    const marker=cells[index]??null;
    const cell=document.createElement('button');cell.type='button';cell.className='duel-cell';cell.dataset.cell=String(index);
    cell.textContent=marker==='a'?'X':marker==='b'?'O':'';
    if(marker)cell.dataset.marker=marker;
    cell.setAttribute('aria-label',marker?`Cell ${index+1}, ${marker==='a'?'X':'O'}`:`Cell ${index+1}, empty`);
    cell.disabled=busy||view.status!=='playing'||view.turn_player_id!==view.you.player_id||marker!==null;
    cell.addEventListener('click',()=>{if(!cell.disabled)void submit('move',{cell:index,revision:view!.revision});});
    board.append(cell);
  }
}
function renderActions():void{
  actions.hidden=view?.game!=='rps';
  if(!view||view.game!=='rps')return;
  const picked=Boolean(view.you.picked);
  actions.replaceChildren();
  for(const move of MOVES){
    const button=document.createElement('button');button.type='button';button.dataset.pick=move;
    button.textContent=move.toUpperCase();
    const mine=view.status==='playing'?picked:view.you.pick===move;
    if(mine)button.classList.add('is-picked');
    button.disabled=busy||view.status!=='playing'||picked;
    button.addEventListener('click',()=>{if(!button.disabled)void submit('pick',{move});});
    actions.append(button);
  }
}
function renderResult():void{
  result.hidden=true;hint.textContent='';
  if(!view)return;
  if(view.status==='expired'){
    setStatus('THIS MATCH EXPIRED','warn');
    result.hidden=false;result.textContent='MATCH EXPIRED';
    return;
  }
  if(view.status!=='finished'){
    setStatus(view.game==='tictactoe'?(view.turn_player_id===view.you.player_id?'YOUR MOVE':'WAITING FOR OPPONENT'):(view.you.picked?'WAITING FOR OPPONENT':'CHOOSE YOUR MOVE'),view.turn_player_id===view.you.player_id||view.you.picked?'good':'info');
    hint.textContent=view.game==='tictactoe'?'Click an empty square. The server owns the board and decides the winner.':'Pick rock, paper or scissors. Your pick stays hidden until your opponent has chosen.';
    return;
  }
  const won=view.winner_player_id===view.you.player_id,draw=view.result==='draw';
  setStatus(won?'YOU WON':draw?'DRAW':'YOU LOST',won?'good':draw?'warn':'bad');
  result.hidden=false;result.textContent=won?'YOU WIN':draw?'DRAW':`${view.opponent.name.toUpperCase()} WINS`;
  if(view.game==='rps'){
    const pick=view.you.pick??'—',opponentPick=view.opponent.pick??'—';
    hint.textContent=`YOU ${pick.toUpperCase()} · ${view.opponent.name.toUpperCase()} ${opponentPick.toUpperCase()}`;
  }else hint.textContent='The match is complete. Both visitors keep their own saved world position.';
}
function render():void{
  if(!view)return;
  title.textContent=GAME_LABEL[view.game];
  renderPlayers();renderBoard();renderActions();renderResult();
  if(errorText){setStatus(errorText,'bad');errorText='';}
}
function schedule():void{
  if(timer)window.clearTimeout(timer);timer=0;
  if(stopped||!view||view.status!=='playing')return;
  timer=window.setTimeout(()=>{void load();},POLL_MS);
}
async function load():Promise<void>{
  if(stopped||!duelId)return;
  try{
    view=await duelRequest<DuelView>(`/api/world/duels/${encodeURIComponent(duelId)}`);
    errorText='';render();
  }catch(error){
    const code=codeOf(error);
    if(code==='DUEL_NOT_FOUND'||code==='DUEL_NOT_YOURS'){
      setStatus(code==='DUEL_NOT_YOURS'?'THIS MATCH BELONGS TO ANOTHER PAIR':'THIS MATCH IS NO LONGER AVAILABLE','bad');
      board.hidden=true;actions.hidden=true;players.replaceChildren();hint.textContent='';
      stopped=true;return;
    }
    setStatus('RECONNECTING TO THE MATCH…','warn');
  }
  schedule();
}
async function submit(action:'move'|'pick',body:Record<string,unknown>):Promise<void>{
  if(busy||stopped||!view||view.status!=='playing')return;
  busy=true;render();
  try{
    view=await duelRequest<DuelView>(`/api/world/duels/${encodeURIComponent(duelId)}/${action}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    errorText='';render();
  }catch(error){
    const code=codeOf(error);
    if(code==='DUEL_REVISION'||code==='PICK_LOCKED'||code==='DUEL_FINISHED'){
      busy=false;
      try{view=await duelRequest<DuelView>(`/api/world/duels/${encodeURIComponent(duelId)}`);}catch{/* keep the last board */ }
      render();
    }else{
      errorText=code==='INVALID_MOVE'?'THAT MOVE IS NOT LEGAL':code==='NOT_NEARBY'?'MOVE CLOSER TOGETHER':code==='WRONG_GAME'?'WRONG MATCH TYPE':'COULD NOT SEND THAT MOVE';
    }
  }finally{busy=false;render();schedule();}
}
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&view?.status==='playing')void load();});
window.addEventListener('pagehide',()=>{stopped=true;if(timer)window.clearTimeout(timer);});
if(!duelId){setStatus('THIS MATCH LINK IS INVALID','bad');stopped=true;}
else void load();
export {};
