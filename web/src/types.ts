export type Action = 'work' | 'challenge' | 'guard' | 'cooperate';
export interface AgentConfig { id: string; name: string; sprite: string; strategy: string; personality: string; prompt: string; model: string; provider: 'mock' | 'http' | 'recorded' | 'openai-compatible'; starting_credits: number; wallet_enabled: boolean; inference?: {base_url?:string;api_key_env?:string;timeout_ms?:number;max_tokens?:number;max_requests?:number;retries?:number;fallback?:'work'|'guard'} }
export interface Config { seed: number; max_turns: number; agents: AgentConfig[] }
export interface Statistics { actions: number; challenges_won: number; blocks: number; cooperations: number; earned: number; eliminated_turn: number | null }
export interface Agent { id: string; credits: number; alive: boolean; guarded: boolean; last_action: Action | null; stats: Statistics }
export interface State { turn: number; rng: number; agents: Agent[]; alliances: [string,string][]; ended: boolean; winner: string | null; end_reason: string | null; income: number; upkeep: number }
export interface Decision { agent_id: string; action: Action; target: string | null; reason: string }
export type EventType = 'AgentThinking' | 'ActionStarted' | 'ActionResolved' | 'WinnerDeclared' | 'MatchStarted' | 'RoundStarted' | 'WorldEvent' | 'AgentActionSelected' | 'ActionRejected' | 'WorkCompleted' | 'ChallengeStarted' | 'ChallengeResolved' | 'GuardRaised' | 'CooperationOffered' | 'AllianceCreated' | 'AllianceBroken' | 'ResourceChanged' | 'AgentEliminated' | 'RoundEnded' | 'MatchEnded';
export interface GameEvent { seq: number; turn: number; type: EventType; actor: string | null; target: string | null; amount: number | null; after: number | null; reason: string; decision: Decision | null; state: State | null; projection?: Omit<State, 'rng'>; outcome?: {action:Action;actor_delta:number;target_delta:number} }
export interface Replay { simulation_version: string; match_id: string; seed: number; config: Config; starting_state: State; events: GameEvent[]; final_state: State; winner: string | null; statistics: Statistics[] }
export interface MatchResponse { session: string; replay: Replay }
export interface StepResponse { replay: Replay; events: GameEvent[] }
