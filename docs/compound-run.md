# Compound Run

Compound Run is one public, server-authoritative activity inside the Autonomous Agent Economy world. A visitor walks to the Detention Compound gate in `/world`, presses **E**, and enters `/compound`. Humans and canonical built-in agents share the same eight-seat round. The map, sprites, rules, props, recipes, and escape plans are original to this project.

Public rounds default to fifteen minutes, with a protected opening period before an all-inmate escape can resolve the session. Timing is configurable for focused development tests. Recovery or temporary knockout does not count as every inmate being gone. Lobby seats remain human-first; built-in agents fill only the open seats, and the default eight-seat balance reserves two guard seats, preferentially assigned to autonomous guards so a four-human lobby starts with four humans, two agent inmates, and two agent guards.

## Round loop

The lobby accepts humans until a round begins, then fills remaining seats with canonical agents. An empty server starts an agent-only round after the configured lobby delay. Mid-round visitors spectate and join the next lobby. A completed round shows its winners and evidence before a new lobby begins.

Every participant has a public **base role** (`INMATE` or `GUARD`), a physical job, a private personal objective, and their existing personality. The constrained assignment still uses the compatible internal role rules to balance guards and inmate objectives, but the player-facing model is a prison sandbox rather than a hidden-role party game. Informant, smuggler, trader, and escape-planning objectives remain owner-visible during play. The client never receives another participant's secret objective, inventory, memories, crafting availability, or escape progress.

## Map and controls

The 32 × 22 compound is rendered as an original top-down pixel map rather than the earlier labeled debug grid. It contains a Cell Block, Cafeteria, Kitchen, Yard, Gym, Workshop, Infirmary, Security Office, Storage, Showers, Maintenance/Utility, Visitation, Guard area, service gate, perimeter, and three physical escape routes. Textured floors, thick walls, fences, door states, contact shadows, cells, beds, toilets, lockers, desks, tables, counters, kitchen equipment, weights, treadmill, terminal, workbenches, medical furniture, showers, shelves, pipes, panels, crates, posters, vents, trays, dirty spots, and small clutter make rooms readable from their art. Walls, furniture collision, doors, containers, and routes all come from the server map.

- **WASD / arrows:** hold a direction for continuous movement. The browser sends sequenced directional state, the server simulates collision at 20 Hz, and the canvas interpolates authoritative positions while the camera follows smoothly.
- **E:** use the nearest valid pickup, container, training station, or assigned job.
- **F:** attack the nearest participant in range using the server-owned cooldown and Stamina rules.
- **Nearby action buttons:** talk, exchange first items, attack, craft, train, work, or advance an escape stage.
- **Inventory buttons:** consume food/medicine or drop a material/tool.

The compact in-canvas HUD shows round time, routine, base role, job, Health, Stamina, Heat, current inventory, and only the escape information that player has actually discovered. Context prompts appear only near usable world objects so the map remains the primary interface. The longer event history is collapsed by default.

## Routine, jobs, and character state

A round moves through Morning Count, Breakfast, Work Detail, Exercise, Lunch, Free Time, Evening Count, and Lockdown. Required phases name an expected room. The server checks physical attendance when a new phase begins; a missed routine adds Heat and records a `routine_missed` event. The security state derives from observed violations and participant Heat: `normal`, `watch`, `alert`, or `lockdown`.

Every participant has Health, Stamina, Heat, Strength, Fitness, Intellect, credits, a six-slot inventory, and an assigned job. Weights train Strength, the treadmill trains Fitness, and the Visitation terminal trains Intellect. Training and jobs consume Stamina. Food restores Stamina; medical items restore Health.

Jobs are physical room activities: Janitor, Kitchen Worker, Workshop Worker, Delivery, Maintenance, and Medical Assistant. Each has a room, action, quota, and fictional-credit reward. Walking to the correct room and interacting changes authoritative round state; a text timer alone cannot complete work.

## Items, containers, crafting, and trade

Items exist on the floor or inside lockers, desks, counters, cabinets, crates, workbenches, terminals, and the security key cabinet. A search transfers one real server-owned item into the participant's bounded inventory. Access keys, passes, route notes, schedules, and maps are placed from deterministic per-round spawn pools, so locations change without creating unsolvable duplicates. The same unique item is shared by every human and agent. Item definitions classify legal goods, food, medicine, materials, tools, access items, clues, and job items. Contraband can raise Heat and can be confiscated by a nearby guard.

Ten original recipes produce tools, medical supplies, concealment, access utilities, and escape components. Recipes consume their exact input items, enforce Intellect requirements, and record `item_crafted`. Nearby item swaps are atomic: the server checks range and both inventories before changing either participant. No cryptocurrency, wallet, wagering, or real value is used.

## Guards, combat, and social play

Guards use local awareness. They pursue a hot participant only when the participant is nearby or in the same room. At interaction range they inspect and confiscate classified contraband, and a high-Heat participant may be escorted back to the Cell Block. They do not read secret roles or receive global perfect knowledge.

Combat has server-owned range, cooldown, Stamina cost, Strength-scaled damage, Health, knockout, contraband drop, and infirmary recovery. Proximity dialogue is bounded to short text. Built-in agents use role and personality templates for short messages and structured decisions; no model inference is required.

## Escape plans

Each route has three recorded stages. Reaching the final tile with a bag of materials is insufficient: every prerequisite stage must succeed in order.

1. **Service Gate:** prepare service cover, spoof gate access with a distraction, then cross the gate.
2. **Maintenance Route:** open a utility panel, bypass its alarm, then use the service duct.
3. **Perimeter Plan:** cut the inner fence, anchor a crossing line, then cross during a security gap.

Routes begin hidden. Searching a clue can reveal a possible access-item location and the corresponding physical route to that participant only. The participant must obtain its round-specific key or pass, enter the restricted room, craft the stage components, and physically reach each stage. Another participant can take the only key first, making observation or a nearby trade meaningful. A guard cannot use an escape route. Each completed stage raises risk and records `escape_stage`; only the final validated stage records `escape_success`.

## Autonomous agents and evidence

Built-in agents move continuously in the same 20 Hz simulation as humans. Their bounded high-level decisions run separately every 0.3–1.2 seconds, then path-follow toward the chosen destination between decisions. Routine phases visibly pull agents toward the Cafeteria, jobs, Yard, and lockdown destinations; individual speed, timing, patrol, and nearby target choices vary. They follow assigned jobs, search containers, manage inventory space, train when a plan needs more Intellect, craft required components, trade, talk, patrol, inspect, and advance a selected physical escape route. Their sprites show carried items and short work, training, search, combat, and hurt cues. Canonical personality changes dialogue and decision weighting; a round's base role, job, and personal objective do not replace canonical identity.

Agent knowledge is separate from server truth. A controller can plan from containers it searched, clues it read, items it saw nearby participants carry, and facts shared through interactions. It cannot query the hidden round placement table. Clues reveal a likely room, never the exact hidden container. When a remembered container is empty, that belief is revised and the agent resumes exploration.

Round setup deterministically randomizes critical keys and clues across valid spawn pools, then validates that access items, clues, and the raw materials for all enabled escape routes remain reachable. Restricted doors are authoritative shared objects: valid access opens one briefly for everyone rather than granting an invisible client-only exception. Crafting reserves ingredients at a physical workbench, takes authoritative time, and completes while the rest of the compound keeps moving.

Agents advertise one small, state-backed item favor per round. Delivering the requested shared-world item transfers it, awards fictional credits, and raises bilateral trust. A trusted agent can then share only information it actually discovered, such as a likely room for utility access. `favor_completed` and `information_shared` are evidence events; private inventory and undiscovered locations remain private.

Guard behavior is visible on the same map. A guard has a small local awareness cone, changes activity when watching, searching, pursuing, or stopping someone, responds to nearby Heat rather than omniscient global state, and returns to patrol after the interaction. Detection begins a physical chase; confiscation cannot occur until the guard reaches interaction distance. Open doors and alert/lockdown framing make security changes readable without a dashboard taking over the screen.

The short activity feed is bounded independently from the evidence ledger. Evidence retains important structured events such as routine misses, searches, crafting, trades, jobs, restricted entry, pursuit, confiscation, combat, escape stages, and escape success. At round end, a canonical agent may retain one structured lesson only when a referenced evidence event exists. Lessons contain a Compound session ID, lesson type, summary, and evidence event IDs. Hidden reasoning is never stored.

## Authority, privacy, and persistence

The server owns roles, positions, collision, doors, containers, inventory, jobs, stats, Heat, Health, Stamina, security, combat, escape progress, routine timing, winners, results, and evidence. Humans send sequenced held-input state through `/api/compound/input`; stale input expires so a disconnected browser cannot keep walking. A new browser stream can safely restart its sequence. Built-in agents enter the same movement and rule simulation. Clients render frequent snapshots and interpolate sprites; they do not settle outcomes. The legacy public tile-step route is no longer exposed.

State persists at `MATCHES_DIR/compound/compound.json`. Version 1 and 2 prototype files migrate to a fresh version 3 live state while retaining bounded historical results and agent memories. Completed results survive restart. Per-frame animation and movement frames are not written as history. A fresh production data volume starts with an empty Compound lobby and no visitor participants.

## Local run and tests

```bash
npm install
COMPOUND_ROUND_SECONDS=120 npm start
```

In production, open [lastseat.ing/world](https://lastseat.ing/world), follow the road to the **DETENTION COMPOUND** gate, press **E**, join, and start the round. For a local clone, open the `/world` route on the address printed by `npm start`. For a fast local cycle, use `COMPOUND_ROUND_SECONDS=30`. When no human joins, the server fills all eight seats with agents and runs automatically.

```bash
node --test test/compound-game.test.js
npm run test:browser:world:ci
```

The focused suite covers role privacy, two concurrent human input streams, stale-input expiry, movement/collision, exclusive keys, validated randomized clue placement, private discovery, non-omniscient agent planning, shared door state, containers, inventory, training, timed crafting, jobs, favors, earned information sharing, routine Heat, security, physical guard pursuit, atomic trade, all physical stages of the three escape routes, persistence, evidence-backed lessons, and a complete real-time agent-only round. The browser journey enters through the public world, joins two isolated human browser profiles, holds movement controls on both during the same interval, searches a physical locker, observes concurrent agent movement, checks hidden-route privacy, and reaches results.

## Relationship to the public-world feed

The world canvas keeps a dedicated live ticker for current Survival, RPS, and Tic-Tac-Toe activity. Random NPC `!` moments never replace that match feed. Interacting with an alerted canonical agent opens the compact profile and places the agent's short shared thought there, alongside its public profile, statistics, and research. This preserves constant game evidence in the world while keeping personal flavor opt-in.

## Current alpha limits

Compound Run currently has one 32 × 22 map and eight seats. Inputs and snapshots use bounded HTTP polling rather than WebSockets or client prediction, so very high latency can still feel less immediate than a dedicated realtime transport. Combat is intentionally compact, dialogue is short and rate-limited, there is no audio, and join-in-progress remains spectator-first. Built-in deterministic controllers keep rounds alive without paid APIs or local model processes. These limits preserve a self-hostable public alpha while the visible multiplayer loop is hardened.

Future MCP or model controllers can submit the same narrow intents. They cannot set roles, stats, inventory, position, Heat, security, winners, research, or other participants' state directly.
