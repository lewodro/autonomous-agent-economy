import { request } from './gateway.js';
interface TableView {
  status:'empty'|'waiting'|'ready'|'playing'|'finished';revision:number;mode:'free';yourSeat:string|null;expired?:boolean;
  players:{id:string;name:string;kind:'human'|'npc'}[];
  match:null|{id:string;players:string[];board:('a'|'b'|null)[];moves:{agentId:string;cell:number}[];result:'a'|'b'|'draw'|null};
}
/** All board changes go to the server; this component only renders and submits a cell. */
export function mountTable(parent:HTMLElement,isActive:()=>boolean,pollIntervalMs=1200):void {
  let state:TableView|null=null,busy=false,timer:ReturnType<typeof setTimeout>|undefined;
  const status=document.createElement('p'),actions=document.createElement('div'),board=document.createElement('div'),error=document.createElement('p');
  const explanation=document.createElement('p');explanation.textContent='One shared free table. Wait for another visitor, or practice against the existing Founder policy. World avatars are local; only seating and board moves are shared.';
  board.id='table-board';board.setAttribute('aria-label','Free Tic-Tac-Toe board');error.setAttribute('role','alert');error.className='error-text';parent.append(explanation,status,actions,board,error);
  const button=(label:string,action:string,data:Record<string,unknown>={})=>{const b=document.createElement('button');b.textContent=label;b.disabled=busy;b.onclick=()=>void act(action,data);actions.append(b);};
  function render():void {
    if(!state||!isActive())return;actions.replaceChildren();board.replaceChildren();
    if(state.status==='empty'){
      status.textContent=state.expired?'The inactive table expired. Choose a new game.':'The table is empty.';button('Wait for a human','join',{mode:'human'});button('Practice against Founder','join',{mode:'npc'});return;
    }
    if(state.status==='waiting')status.textContent=state.yourSeat?'You are seated as X. Waiting for another visitor…':'A visitor is waiting. Sit as O to play.';
    if(!state.yourSeat){if(state.status==='waiting')button('Sit as O','join',{mode:'human'});else status.textContent='This table is occupied. You can watch the board below.';}
    else {if(state.status==='ready'){status.textContent='Both seats ready. Start the free game.';button('Start game','start');}button('Leave table','leave');}
    if(!state.match)return;
    if(state.status==='playing'){
      const next=state.match.players[state.match.moves.length%2];
      status.textContent=next===state.yourSeat?'Your turn. Choose an empty cell.':`Waiting for ${state.players.find(p=>p.id===next)?.name||'the other player'}.`;
    }
    if(state.status==='finished'){
      status.textContent=state.match.result==='draw'?'Draw · board verified.':`${state.players[state.match.result==='a'?0:1]!.name} wins · board verified.`;
      const download=document.createElement('button');download.textContent='Download move record';download.onclick=()=>{
        const url=URL.createObjectURL(new Blob([JSON.stringify({version:1,mode:'free',match:state!.match},null,2)],{type:'application/json'}));
        const a=document.createElement('a');a.href=url;a.download='free-table-'+state!.match!.id+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
      };actions.append(download);
    }
    const myTurn=state.status==='playing'&&state.match.players[state.match.moves.length%2]===state.yourSeat;
    state.match.board.forEach((cell,index)=>{const b=document.createElement('button');b.textContent=cell==='a'?'X':cell==='b'?'O':'·';b.setAttribute('aria-label',`Row ${Math.floor(index/3)+1}, column ${index%3+1}: ${cell==='a'?'X':cell==='b'?'O':'empty'}`);b.disabled=busy||!!cell||!myTurn;b.onclick=()=>void act('move',{cell:index,revision:state!.revision});board.append(b);});
  }
  async function act(action:string,data:Record<string,unknown>):Promise<void>{
    if(busy||!isActive())return;busy=true;error.textContent='';render();
    try{state=await request<TableView>('/api/world/table/'+action,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});}
    catch{error.textContent='That action could not complete. The table may have changed; refresh and try again.';}
    finally{busy=false;render();}
  }
  async function poll():Promise<void>{
    if(!isActive()){if(timer)clearTimeout(timer);return;}
    if(!busy)try{
      const fresh=await request<TableView>('/api/world/table');
      if(!busy){
        const changed=!state||fresh.revision>=state.revision&&(fresh.revision!==state.revision||fresh.yourSeat!==state.yourSeat||fresh.status!==state.status);
        if(changed){state=fresh;render();}
        error.textContent='';
      }
    }catch{error.textContent='Connection interrupted. Reconnecting to the table…';}
    if(isActive())timer=setTimeout(poll,pollIntervalMs);
  }
  status.textContent='Opening the table…';void poll();
}
