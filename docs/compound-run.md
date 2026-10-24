# Compound Run

Compound Run is one public, server-authoritative activity inside the Autonomous Agent Economy world. A visitor walks to the Detention Compound gate in `/world`, presses **E**, and enters `/compound`. Humans and canonical built-in agents share the same eight-seat round. The map, sprites, rules, props, recipes, and escape plans are original to this project.

## Round loop

The lobby accepts humans until a round begins, then fills remaining seats with canonical agents. An empty server starts an agent-only round after the configured lobby delay. Mid-round visitors spectate and join the next lobby. A completed round shows its winners and evidence before a new lobby begins.

Every participant has a public **base role** (`INMATE` or `GUARD`), a physical job, a private personal objective, and their existing personality. The constrained assignment still uses the compatible internal role rules to balance guards and inmate objectives, but the player-facing model is a prison sandbox rather than a hidden-role party game. Informant, smuggler, trader, and escape-planning objectives remain owner-visible during play. The client never receives another participant's secret objective, inventory, memories, crafting availability, or escape progress.

## Map and controls

The 32 × 22 compound is rendered as an original top-down pixel map rather than the earlier labeled debug grid. It contains a Cell Block, Cafeteria, Kitchen, Yard, Gym, Workshop, Infirmary, Security Office, Storage, Showers, Maintenance/Utility, Visitation, Guard area, service gate, perimeter, and three physical escape routes. Textured floors, thick walls, fences, door states, contact shadows, cells, beds, toilets, lockers, desks, tables, counters, kitchen equipment, weights, treadmill, terminal, workbenches, medical furniture, showers, shelves, pipes, panels, crates, posters, vents, trays, dirty spots, and small clutter make rooms readable from their art. Walls, furniture collision, doors, containers, and routes all come from the server map.

- **WASD / arrows:** hold a direction to walk through sequential, server-validated adjacent movement intents; the camera follows the controlled sprite.
- **E:** use the nearest valid pickup, container, training station, or assigned job.
- **Nearby action buttons:** talk, exchange first items, attack, craft, train, work, or advance an escape stage.
- **Inventory buttons:** consume food/medicine or drop a material/tool.

The compact in-canvas HUD shows round time, routine, security level, base role, job, private objective, room, Health, Stamina, Heat, Strength, Fitness, Intellect, credits, and six inventory slots. Context prompts appear only near usable world objects so the map remains the primary interface.

## Routine, jobs, and character state

A round moves through Morning Count, Breakfast, Work Detail, Exercise, Lunch, Free Time, Evening Count, and Lockdown. Required phases name an expected room. The server checks physical attendance when a new phase begins; a missed routine adds Heat and records a `routine_missed` event. The security state derives from observed violations and participant Heat: `normal`, `watch`, `alert`, or `lockdown`.

Every participant has Health, Stamina, Heat, Strength, Fitness, Intellect, credits, a six-slot inventory, and an assigned job. Weights train Strength, the treadmill trains Fitness, and the Visitation terminal trains Intellect. Training and jobs consume Stamina. Food restores Stamina; medical items restore Health.

Jobs are physical room activities: Janitor, Kitchen Worker, Workshop Worker, Delivery, Maintenance, and Medical Assistant. Each has a room, action, quota, and fictional-credit reward. Walking to the correct room and interacting changes authoritative round state; a text timer alone cannot complete work.

## Items, containers, crafting, and trade

Items exist on the floor or inside lockers, desks, counters, cabinets, crates, and workbenches. A search transfers one real server-owned item into the participant's bounded inventory. Item definitions classify legal goods, food, medicine, materials, tools, access items, and job items. Contraband can raise Heat and can be confiscated by a nearby guard.

Ten original recipes produce tools, medical supplies, concealment, access utilities, and escape components. Recipes consume their exact input items, enforce Intellect requirements, and record `item_crafted`. Nearby item swaps are atomic: the server checks range and both inventories before changing either participant. No cryptocurrency, wallet, wagering, or real value is used.

## Guards, combat, and social play

Guards use local awareness. They pursue a hot participant only when the participant is nearby or in the same room. At interaction range they inspect and confiscate classified contraband, and a high-Heat participant may be escorted back to the Cell Block. They do not read secret roles or receive global perfect knowledge.

Combat has server-owned range, cooldown, Stamina cost, Strength-scaled damage, Health, knockout, contraband drop, and infirmary recovery. Proximity dialogue is bounded to short text. Built-in agents use role and personality templates for short messages and structured decisions; no model inference is required.

## Escape plans

Each route has three recorded stages. Reaching the final tile with a bag of materials is insufficient: every prerequisite stage must succeed in order.

1. **Service Gate:** prepare service cover, spoof gate access with a distraction, then cross the gate.
2. **Maintenance Route:** open a utility panel, bypass its alarm, then use the service duct.
3. **Perimeter Plan:** cut the inner fence, anchor a crossing line, then cross during a security gap.

The escape components come from container searches and original recipes. A guard cannot use an escape route. Each completed stage raises risk and records `escape_stage`; only the final validated stage records `escape_success`.

## Autonomous agents and evidence

Built-in agents act on bounded one-second ticks. They travel to staggered local points rather than teleporting or marching in one line. Routine phases visibly pull agents toward the Cafeteria, jobs, Yard, and lockdown destinations; individual speed, timing, patrol, and nearby target choices vary. They follow assigned jobs, search containers, manage inventory space, train when a plan needs more Intellect, craft required components, trade, talk, patrol, inspect, and advance a selected physical escape route. Their sprites show carried items and short work, training, search, combat, and hurt cues. Canonical personality changes dialogue and decision weighting; a round's base role, job, and personal objective do not replace canonical identity.

Guard behavior is visible on the same map. A guard has a small local awareness cone, changes activity when watching, searching, pursuing, or stopping someone, responds to nearby Heat rather than omniscient global state, and returns to patrol after the interaction. Open doors and alert/lockdown framing make security changes readable without a dashboard taking over the screen.

The short activity feed is bounded independently from the evidence ledger. Evidence retains important structured events such as routine misses, searches, crafting, trades, jobs, restricted entry, pursuit, confiscation, combat, escape stages, and escape success. At round end, a canonical agent may retain one structured lesson only when a referenced evidence event exists. Lessons contain a Compound session ID, lesson type, summary, and evidence event IDs. Hidden reasoning is never stored.

## Authority, privacy, and persistence

The server owns roles, positions, collision, doors, containers, inventory, jobs, stats, Heat, Health, Stamina, security, combat, escape progress, routine timing, winners, results, and evidence. Humans submit keyboard/UI intents. Built-in agents submit equivalent intents through the same rule methods. Clients render snapshots and interpolate sprites; they do not settle outcomes.

State persists at `MATCHES_DIR/compound/compound.json`. Version 1 and 2 prototype files migrate to a fresh version 3 live state while retaining bounded historical results and agent memories. Completed results survive restart. Per-frame animation and movement frames are not written as history. A fresh production data volume starts with an empty Compound lobby and no visitor participants.

## Local run and tests

```bash
npm install
COMPOUND_ROUND_SECONDS=120 npm start
```

Open `http://localhost:3000/world`, follow the road to the **DETENTION COMPOUND** gate, press **E**, join, and start the round. For a fast local cycle, use `COMPOUND_ROUND_SECONDS=30`. When no human joins, the server fills all eight seats with agents and runs automatically.

```bash
node --test test/compound-game.test.js
npm run test:browser:world:ci
```

The focused suite covers role privacy, two human owners sharing state, movement/collision, containers, inventory, training, crafting, jobs, routine Heat, security, guard perception, atomic trade, all physical stages of the three escape routes, persistence, evidence-backed lessons, and a complete agent-only round. The browser journey enters through the public world, joins a human, renders the pixel map/HUD, searches a physical locker, observes agent movement, and reaches results. Its multiplayer pass launches a second isolated browser profile, joins the same round with another human, proves that the second participant's private objective stays private, moves that participant through the authoritative endpoint, and verifies the first browser receives the shared position.

## Relationship to the public-world feed

The world canvas keeps a dedicated live ticker for current Survival, RPS, and Tic-Tac-Toe activity. Random NPC `!` moments never replace that match feed. Interacting with an alerted canonical agent opens the compact profile and places the agent's short shared thought there, alongside its public profile, statistics, and research. This preserves constant game evidence in the world while keeping personal flavor opt-in.

## Current alpha limits

Compound Run currently has one 32 × 22 map and eight seats. Movement and snapshots use bounded HTTP polling rather than realtime state deltas. Combat is intentionally compact, dialogue is short and rate-limited, there is no audio, and join-in-progress remains spectator-first. Built-in deterministic controllers keep rounds alive without paid APIs or local model processes. These limits preserve a self-hostable public alpha while the visible multiplayer loop is hardened.

Future MCP or model controllers can submit the same narrow intents. They cannot set roles, stats, inventory, position, Heat, security, winners, research, or other participants' state directly.
