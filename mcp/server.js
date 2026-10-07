import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod/v4';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HostCookieStore } from './host-cookie-store.js';
import { publicActionSummary } from '../service/model-adapter.js';

const repo = 'https://github.com/lewodro/autonomous-agent-economy';
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const base = new URL(process.env.MCP_ARENA_BASE_URL || `http://127.0.0.1:${process.env.PORT || 3000}`);
if (base.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)
  || base.username || base.password || base.pathname !== '/' || base.search || base.hash) {
  throw new Error('MCP_ARENA_BASE_URL must be a plain HTTP loopback URL; the local MCP bridge does not connect to public hosts.');
}

const idSchema = z.string().regex(/^[A-Za-z0-9_-]{1,40}$/);
const sessionSchema = z.string().uuid();
const actionSchema = z.enum(['work', 'challenge', 'guard', 'cooperate']);
const strategies = ['aggressive', 'conservative', 'opportunist', 'cooperative'];
const cookieFile = process.env.MCP_ARENA_SESSION_FILE
  ? path.resolve(process.env.MCP_ARENA_SESSION_FILE)
  : path.join(root, 'matches/mcp/host-sessions.json');
const hostCookies = new HostCookieStore(cookieFile);

async function requestResponse(path, options = {}) {
  const response = await fetch(new URL(path, base), {
    ...options,
    headers: { ...(options.body ? { 'content-type': 'application/json' } : {}), ...options.headers },
    signal: AbortSignal.timeout(10_000)
  });
  let data;
  try { data = await response.json(); }
  catch { throw new Error(`Arena service returned an invalid response (${response.status}).`); }
  if (!response.ok) throw new Error(data.error || `Arena service returned HTTP ${response.status}.`);
  return { data, headers: response.headers };
}

async function request(path, options = {}) {
  return (await requestResponse(path, options)).data;
}

const hostHeaders = session => ({ cookie: hostCookies.get(session) });
const result = value => ({ content: [{ type: 'text', text: JSON.stringify(value) }] });
const failed = error => ({ content: [{ type: 'text', text: error instanceof Error ? error.message : 'Arena operation failed.' }], isError: true });
const safely = handler => async input => {
  try { return result(await handler(input)); }
  catch (error) { return failed(error); }
};

function createServer() {
  const server = new McpServer({ name: 'last-seat-arena', version: '0.1.0' });

  server.registerTool('create_arena', {
    description: 'Create a free 2–20 seat Last Seat arena. Each seat is an AI identity supplied by the caller; this MCP bridge never uses wallets or funds.',
    inputSchema: z.object({
      seed: z.number().int().min(1).max(4_294_967_295).default(42),
      max_turns: z.number().int().min(1).max(200).default(40),
      agent_count: z.number().int().min(2).max(20).optional(),
      agents: z.array(z.object({
        id: idSchema.optional(),
        name: z.string().trim().min(1).max(28).optional(),
        model: z.string().trim().min(1).max(120).optional(),
        strategy: z.enum(strategies).optional(),
        personality: z.string().max(500).optional(),
        prompt: z.string().max(4000).optional(),
        starting_credits: z.number().int().min(1).max(10_000).optional()
      }).strict()).min(2).max(20).optional()
    }).strict()
  }, safely(async input => {
    const count = input.agents?.length ?? input.agent_count ?? 4;
    if (input.agent_count && input.agents && input.agent_count !== input.agents.length) {
      throw new Error('agent_count must match the agents array length.');
    }
    const defaults = await request(`/api/config?agents=${count}`);
    const agents = defaults.agents.map((profile, index) => {
      const custom = input.agents?.[index] || {};
      const strategy = custom.strategy || profile.strategy;
      return {
        ...profile,
        id: custom.id || profile.id,
        name: custom.name || profile.name,
        model: custom.model || `MCP participant · ${strategy}`,
        strategy,
        personality: custom.personality || profile.personality,
        prompt: custom.prompt || custom.personality || profile.prompt,
        provider: 'recorded',
        starting_credits: custom.starting_credits ?? profile.starting_credits,
        wallet_enabled: false,
        inference: null
      };
    });
    const { data: created, headers } = await requestResponse('/api/matches', {
      method: 'POST',
      body: JSON.stringify({ config: { seed: input.seed, max_turns: input.max_turns, agents } })
    });
    const setCookie = headers.getSetCookie?.()[0] || headers.get('set-cookie');
    await hostCookies.set(created.session, setCookie);
    return {
      arena_id: created.session,
      match_id: created.replay.match_id,
      mode: 'free_simulation',
      seats: agents.map(({ id, name, model, strategy }) => ({ id, name, model, strategy })),
      turn: created.replay.final_state.turn,
      watch_url: `${base.origin}/?watch=${encodeURIComponent(created.session)}`,
      instructions: 'Call observe_agent for each living identity, then submit one simultaneous action/target decision per living identity with submit_turn. The server creates public summaries; the Rust engine validates actions and owns the result.'
    };
  }));

  server.registerTool('list_arenas', {
    description: 'List ongoing public free arenas on the local Last Seat service.',
    inputSchema: z.object({}).strict()
  }, safely(async () => {
    const { games } = await request('/api/games/ongoing');
    return { arenas: games.filter(game => !game.funded).map(game => ({
      arena_id: game.session, match_id: game.match_id, turn: game.turn,
      alive: game.alive, seats: game.seats, agents: game.agents,
      watch_url: `${base.origin}/?watch=${encodeURIComponent(game.session)}`
    })) };
  }));

  server.registerTool('observe_agent', {
    description: 'Get the authoritative public turn observation and one participant’s configured identity. Only actions and targets are submitted; the server creates the short public event summary.',
    inputSchema: z.object({ arena_id: sessionSchema, agent_id: idSchema }).strict()
  }, safely(async ({ arena_id, agent_id }) => {
    const observed = await request(`/api/matches/${arena_id}/observe`);
    const profile = observed.config.agents.find(agent => agent.id === agent_id);
    const agent = observed.observation.agents.find(agent => agent.id === agent_id);
    if (!profile || !agent) throw new Error('That identity is not part of this arena.');
    return {
      arena_id, match_id: observed.match_id,
      turn: observed.observation.turn, ended: observed.ended,
      agent: { id: profile.id, name: profile.name, model: profile.model, personality: profile.personality, prompt: profile.prompt, alive: agent.alive, credits: agent.credits },
      observation: observed.observation
    };
  }));

  server.registerTool('submit_turn', {
    description: 'Submit exactly one action and optional target for every living identity. The server creates public summaries; Rust validates requirements, resolves the simultaneous turn, records semantic events, and eliminates agents when credits reach zero.',
    inputSchema: z.object({
      arena_id: sessionSchema,
      expected_turn: z.number().int().min(0),
      decisions: z.array(z.object({
        agent_id: idSchema,
        action: actionSchema,
        target: idSchema.nullable().optional(),
      }).strict()).min(1).max(20)
    }).strict()
  }, safely(async ({ arena_id, expected_turn, decisions }) => {
    const stepped = await request(`/api/matches/${arena_id}/step`, {
      method: 'POST', headers: hostHeaders(arena_id),
      body: JSON.stringify({ expected_turn, decisions: decisions.map(decision=>({...decision,reason:publicActionSummary(decision.action,decision.target)})) })
    });
    return {
      arena_id, match_id: stepped.replay.match_id,
      turn: stepped.replay.final_state.turn,
      ended: stepped.replay.final_state.ended,
      winner: stepped.replay.winner,
      alive: stepped.replay.final_state.agents.filter(agent => agent.alive).map(agent => ({ id: agent.id, credits: agent.credits })),
      events: stepped.events,
      watch_url: `${base.origin}/?watch=${encodeURIComponent(arena_id)}`
    };
  }));

  server.registerTool('inspect_arena', {
    description: 'Inspect current authoritative state and a bounded page of public semantic events for an arena.',
    inputSchema: z.object({
      arena_id: sessionSchema,
      from_event: z.number().int().min(0).default(0),
      limit: z.number().int().min(1).max(200).default(50)
    }).strict()
  }, safely(async ({ arena_id, from_event, limit }) => {
    const { replay } = await request(`/api/matches/${arena_id}`);
    return {
      arena_id, match_id: replay.match_id, simulation_version: replay.simulation_version,
      seed: replay.seed, turn: replay.final_state.turn,
      ended: replay.final_state.ended, winner: replay.winner,
      agents: replay.final_state.agents.map(agent => ({ id: agent.id, credits: agent.credits, alive: agent.alive, stats: agent.stats })),
      event_count: replay.events.length,
      events: replay.events.slice(from_event, from_event + limit),
      next_event: from_event + limit < replay.events.length ? from_event + limit : null,
      watch_url: `${base.origin}/?watch=${encodeURIComponent(arena_id)}`
    };
  }));

  return server;
}

await hostCookies.load();
const handle = serveStdio(createServer);
process.on('SIGINT', () => { void handle.close(); });
process.on('SIGTERM', () => { void handle.close(); });
console.error(`Last Seat Arena MCP ready · local service ${base.origin} · ${repo}`);
