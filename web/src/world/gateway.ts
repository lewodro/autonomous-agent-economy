export interface ArenaRoom {
  id:string;game:'rps'|'tictactoe';status:'waiting'|'starting'|'live'|'finished'|'resetting'|'failed';phase:string;
  mode:'simulation';runId:string;matchId:string|null;participants:{id:string;name:string;sprite:string}[];url:string;spectators?:number;
}
export interface AgentProfile {
  id:string;name:string;sprite:string;strategy:string;matches:number;wins:number;losses:number;draws:number;
  scope:string;recentWinner:boolean;roomId:string|null;arenaStatus:'fighting'|'finished'|'queued';
  memory:{matchId:string;opponent:string;move:string;observed:string;runId:string;game:string}[];
  latestMatch:{runId:string;matchId:string;game:string}|null;
}
export interface MatchRecord {
  runId:string;roomId:string;game:string;id:string;result:'a'|'b'|'draw';players:{id:string;name:string}[];
  completedAt:string;logUrl:string;moves:{turn?:number;round?:number;agent:string;action:string;cell?:number[]}[];
}
export interface ArenaStatistics {
  scope:string;updated_at:string|null;totals:{matches:number;decisions:number;draws:number};
  games:{rps:{matches:number;draws:number;decisions:number};tictactoe:{matches:number;draws:number;decisions:number}};
  agents:(AgentProfile&{win_rate:number})[];
}
export interface ArenaGateway {
  listRooms():Promise<ArenaRoom[]>;
  getAgentProfiles():Promise<AgentProfile[]>;
  statistics():Promise<ArenaStatistics>;
  history():Promise<MatchRecord[]>;
  watchMatch(room:ArenaRoom):string;
}
export async function request<T>(url:string,options?:RequestInit):Promise<T> {
  const response=await fetch(url,{...options,signal:AbortSignal.timeout(8000)});
  if(!response.ok)throw new Error(response.status===404?'This room or record is no longer available.':'The Arena is unavailable. Please try again.');
  return response.json() as Promise<T>;
}
/** Browser uses this boundary, not rule modules, wallet APIs or engine commands. */
export class HttpArenaGateway implements ArenaGateway {
  async listRooms():Promise<ArenaRoom[]> {return (await request<{rooms:ArenaRoom[]}>('/api/arena/rooms')).rooms;}
  async getAgentProfiles():Promise<AgentProfile[]> {return (await request<{agents:AgentProfile[]}>('/api/arena/agents')).agents;}
  async statistics():Promise<ArenaStatistics> {return request<ArenaStatistics>('/api/arena/statistics');}
  async history():Promise<MatchRecord[]> {return (await request<{matches:MatchRecord[]}>('/api/arena/history')).matches;}
  watchMatch(room:ArenaRoom):string {
    if(!((room.game==='rps'&&/^rps-[12]$/.test(room.id))||(room.game==='tictactoe'&&/^ttt-[12]$/.test(room.id))))throw new Error('Unsupported room');
    return `/arena/${room.game}/${room.id}`;
  }
}
