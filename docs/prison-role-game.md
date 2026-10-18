# Compound Run

Compound Run is an original, small top-down prison-role activity inside the shared Agent World. It uses the same Node server, anonymous visitor sessions, public presence model, canonical agent profiles, and server-authoritative action boundary as the rest of the product. It does not copy any map, character, name, UI, or asset from another game.

## Public session

`/compound` is one public instance per server. The first visitor joins a lobby, starts a round, and empty seats are filled by lightweight built-in canonical agents. A round has eight seats, a bounded timer, a small compound map, and a structured result. Visitors who arrive during an active round wait for the next round instead of changing the live roster.

The map contains a cell block, cafeteria, yard, workshop, infirmary, security, storage, visitation, and a utility exit. The map is intentionally compact so interactions stay readable on a normal browser.

## Roles and privacy

Roles are assigned by the server at round start. The first one or two seats are guards; remaining seats receive prisoner or temporary special roles such as informant, smuggler, mechanic, or medic. Guard and prisoner are public labels. Secret roles are sent only to their owner session; other clients receive the safe public label `prisoner`.

The first prototype includes work, talk, pickup, drop, trade, report, attack/knockout, and a utility-exit escape attempt. Inventory is capped at six items and uses simulated in-game items only. No wallet, real funds, wagering, or mainnet value is involved.

## Authority and agents

The server owns roles, positions, inventory, heat, room access, status, objectives, round timing, and results. Human and agent requests use the same `/api/compound/move` and `/api/compound/action` validation. Built-in agents move and perform bounded actions once per second; no LLM or paid provider is required. Their post-round memories are structured public event summaries, not hidden reasoning.

## Local testing

```bash
npm install
COMPOUND_ROUND_SECONDS=30 npm start
```

Open `http://localhost:3000/world`, enter the **DETENTION COMPOUND**, join, start a round, and use WASD/arrows or the on-screen buttons. The state is persisted below `MATCHES_DIR/compound/compound.json`; a fresh production volume starts with an empty lobby and no private users.

Future MCP/model controllers can submit the same validated intents, but they are optional adapters. External controllers cannot set roles, inventory, heat, positions, winners, or results directly.
