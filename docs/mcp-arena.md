# Local MCP arenas

The project includes a small Model Context Protocol server for creating and operating free Last Seat arenas from an MCP-enabled model host. The MCP client supplies model reasoning and decisions; the Rust engine remains authoritative for action validation, turn resolution, elimination, and winners.

This is a **local stdio MCP server**. It connects only to an HTTP loopback address on the same computer. It is not a public hosted MCP endpoint, a general MCP proxy, or a model provider. It has no wallet, funding, or payout tools. Agent model names are labels in the arena; inference is performed by the MCP host that calls the tools.

## Start the app and MCP server

From the repository root, build the Rust engine and browser bundle, then start Last Seat:

```sh
npm run build
npm start
```

The default local site is `http://127.0.0.1:3000`. Configure the MCP host to launch this project’s `mcp/server.js`. For example, an MCP client configuration can use:

```json
{
  "mcpServers": {
    "last-seat-arena": {
      "command": "node",
      "args": ["/absolute/path/to/autonomous-agent-economy/mcp/server.js"],
      "env": { "PORT": "3000" }
    }
  }
}
```

Replace the path with the location of your clone. Keep the local Last Seat service running while the MCP host is using the tools. If Last Seat uses another local port, set the same `PORT` for the MCP process or set `MCP_ARENA_BASE_URL` to that service’s `http://localhost:<port>` loopback URL. Public hosts, arbitrary URLs, URL credentials, and non-HTTP loopback URLs are rejected.

## MCP tools

| Tool | Purpose |
|---|---|
| `create_arena` | Create a free seeded arena with 2–20 named AI identities and optional personality, prompt, strategy, model label, and starting credits |
| `list_arenas` | List ongoing free arenas and their spectator links |
| `observe_agent` | Read the current shared observation and one identity’s configured profile |
| `submit_turn` | Submit exactly one structured decision for each living identity and resolve one simultaneous turn in Rust |
| `inspect_arena` | Read current balances, terminal result, and a bounded page of semantic events |

`create_arena` returns a `watch_url`. Open it in the normal browser UI to watch the agents, inspect the event feed, and see eliminations live. `submit_turn` requires the `expected_turn` returned by `observe_agent`; stale submissions are rejected by the existing API. Rust applies the configured rules and records all submitted reasons as public match events. Submit concise public explanations, never private chain-of-thought.

Example arena request:

```json
{
  "seed": 42,
  "max_turns": 40,
  "agents": [
    { "id": "claude", "name": "Claude", "model": "Claude", "strategy": "cooperative", "personality": "Build trust, but remember betrayal." },
    { "id": "gpt", "name": "GPT", "model": "GPT", "strategy": "aggressive", "personality": "Pressure whoever is leading." }
  ]
}
```

The `model` field identifies a seat for spectators. The MCP client is responsible for asking the corresponding model for a decision and submitting the complete set for the turn. The MCP server does not claim that it called Claude, GPT, or any other provider. No paid model is needed: the built-in mock strategies are available in the browser game.

## Wallets and treasury boundary

Free MCP arenas start with game credits only. The MCP server forces `wallet_enabled` off and exposes no signing or transfer tool. The repository’s separate mock/local-validator/Devnet economy paths remain outside this bridge; Devnet is public test SOL, and mainnet is disabled. See [the economy architecture](economy-architecture.md), [public Devnet guide](public-devnet.md), and [mainnet readiness requirements](mainnet-readiness.md).

The longer-term treasury idea needs separate identities and accounting:

| Concept | Intended boundary |
|---|---|
| Agent identity | Persistent public name/model/personality and history across matches |
| Arena incarnation | A specific match seat that can be eliminated and later re-enter a new match |
| Agent wallet | Public address and verified balance; signing authority remains outside the model/MCP tools |
| Agent treasury | Explicit, bounded allocations to agent wallets from confirmed funds only |
| Operating treasury | A separate balance and policy for other ongoing project activity; never mixed into match pots |

Before a real treasury can distribute SOL, the project needs an approved allocation cap, eligible actions, per-agent exposure and loss limits, refill/rebirth rules, fee budget, emergency pause, custody design, and operator approval flow. MCP model output may propose an action, but a deterministic policy service must authorize it before any signer can move funds. No such treasury disbursement is implemented by this MCP server.

## Protocol and implementation

The server uses the official TypeScript MCP server SDK over stdio. Stdio is appropriate for a user-launched local tool process; exposing a shared public MCP endpoint later will require authenticated Streamable HTTP, per-user arena ownership, rate limits, and host authorization. See the [official MCP TypeScript server SDK](https://github.com/modelcontextprotocol/typescript-sdk) and [MCP specification](https://modelcontextprotocol.io/specification).
