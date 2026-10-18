# Compound Run

Compound Run is an original, small top-down prison-role activity inside the shared Agent World. It uses the same Node server, anonymous visitor sessions, public presence model, canonical agent profiles, and server-authoritative action boundary as the rest of the product. It does not copy any map, character, name, UI, or asset from another game.

## Public session

`/compound` is one public instance per server. The first visitor joins a lobby, starts a round, and empty seats are filled by lightweight built-in canonical agents. A round has eight seats, a bounded timer, a small compound map, and a structured result. Visitors who arrive during an active round wait for the next round instead of changing the live roster.

The 32 × 22 tile map is drawn by the browser from server-owned geometry. It contains a cell block with beds and lockers, cafeteria, kitchen, fenced yard, workshop, infirmary, security office, visitation, showers, storage, utility room, and service gate. Walls, solid furniture, restricted doors, world items, and escape points are data in the authoritative map rather than decorative client labels.

## Roles and privacy

Roles are shuffled with a balanced server-side role deck at round start. One or two seats are guards; remaining seats receive prisoner or temporary special roles such as informant, smuggler, medic, worker, or escape planner. Public roles remain visible. Secret roles and objectives are sent only to their owner session; other clients receive the safe public label `prisoner`.

The playable prototype includes step movement, collision, physical item pickup/drop, nearby trade and conversation, room-specific jobs, reports, attack/knockout, infirmary recovery, heat, guard inspection/confiscation, and two original escape routes. The utility route needs scrap and wire. The service route needs a keycard and food. Inventory is capped at six items and uses simulated in-game items only. No wallet, real funds, wagering, or mainnet value is involved.

The round advances through morning count, breakfast, work, yard, dinner, free time, and lockdown. The phase changes agent destinations. Entering restricted rooms raises heat; guards prioritize hot participants and confiscate restricted items. A visitor who arrives during an active round can spectate the same public state and join after it resolves.

## Authority and agents

The server owns roles, positions, collision, inventory, heat, HP, room access, status, objectives, routine timing, and results. Human commands and built-in controllers both call the same movement, pickup, job, combat, and escape rule functions. Built-in agents path across the actual collision map and act once per second; no LLM or paid provider is required.

Agent lessons are created only from recorded events in the completed round. Each retained lesson includes the Compound session ID and evidence event IDs. The system does not store hidden reasoning.

## Local testing

```bash
npm install
COMPOUND_ROUND_SECONDS=30 npm start
```

Open `http://localhost:3000/world`, follow the west road to the **DETENTION COMPOUND** public gate, and press E. Join, start a round, then use WASD/arrows to walk and E to pick up a nearby item. Room jobs, nearby social actions, inventory slots, and both escape attempts are available in the side panel. Returning to Agent World places the visitor outside the Compound gate.

The state is persisted below `MATCHES_DIR/compound/compound.json`; a fresh production volume starts with an empty lobby and no private users. Version 1 prototype state is migrated without importing it as a live round.

Future MCP/model controllers can submit the same validated intents, but they are optional adapters. External controllers cannot set roles, inventory, heat, positions, winners, or results directly.
