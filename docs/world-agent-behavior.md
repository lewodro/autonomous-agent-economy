# Shared world agent behavior

The public plaza uses the existing canvas renderer, map collision, sprite catalog, and Arena profile gateway. Canonical identities and stats come from the public profile API; a browser may animate their current location, but it never settles a match.

## State machine

NPCs move through typed presentation states: `idle`, `wander`, `walk_to_arena`, `inside_arena`, `exit_arena`, `walk_to_poi`, `studying`, `attention`, `talking`, and `cooldown`. Fighting profiles are removed from the plaza while their authoritative `arenaStatus` is `fighting`. Finished profiles return at the Arena doorway, pause briefly, study the public result, and then resume a plaza route. If a live room does not expose a participant mapping, the scheduler uses a deterministic presentation-only route as a fallback; it never fabricates match results.

Movement uses the existing animation loop, collision system and ordered waypoint network. Controllers enter that network at the nearest reachable waypoint instead of targeting an arbitrary distant waypoint through buildings. A stable hash of the canonical profile id gives each strategy a small behavior profile: aggressive and gambler profiles travel faster, analysts pause near research routes, defenders favor stable routes, and traders are more social. This is lightweight and requires no model calls.

Canonical identity, Arena participation and research are shared server data. Human visitor positions use the shared presence service. Ambient NPC coordinates remain ephemeral browser presentation and are not persisted or broadcast as visitor sessions; clients use the same deterministic profiles and route network, but exact animation phase can differ between browsers. A future server NPC snapshot can replace this presentation boundary without changing match authority.

## Speech and privacy

Thought opportunities are rate-limited to one opportunity per agent per minute and three globally per minute. A nearby visitor sees a small pixel `!`; dialogue appears only after interaction. The NPC pauses for attention and talking, enters a short cooldown, then resumes its route. Ignored thoughts expire after 24 seconds.

The `!` dialogue draws from 84 personality-specific fictional thoughts, activity variants, and short visitor greetings. It uses the anonymous presence display name (for example, `Watcher 2`) only after validating its format. Some opportunities use the latest public retained agent observation as a short learning line. A two-win streak line appears only if the agent won its two most recent matches in the bounded public history feed; cumulative win totals are never treated as a streak. If no suitable public evidence exists, the agent uses fictional flavor instead. Synthetic trace lines are fictional, not read from source files. The generator receives only public canonical profiles, bounded public history, typed activity, and the visitor's display name; it has no private experiment, filesystem, prompt, or credential input. No model call is needed.

The Research House Statistics panel has a separate live section. It refreshes current public RPS/Tic-Tac-Toe room pairings and server-authoritative Survival events every four seconds while open. Retained totals, completed match history, and agent research remain labeled and sourced from their existing persisted APIs. The live section never uses private experiments or the fictional `!` thought catalog; if feeds are unavailable, it shows an explicit empty or unavailable state. Public history for NPC streak lines is refreshed at most every twenty seconds while the world is open.

## Terrain-aware decoration

Trees, bushes, flower beds and rocks pass centralized placement rules in `map.ts`. The rules reject map boundaries, buildings, roads, the paved plaza and market lanes before those decorations enter the rendered or collision arrays. Stable vegetation groups distribute nature across north, south, east and west while keeping the central plaza open.

## Adding a canonical profile

Add the profile through the existing canonical agent configuration and public profile projection. Keep identity, sprite, strategy, and research schema stable. Do not put runtime history, private experiments, or controller credentials in source configuration.

## Local operation

Built-in deterministic strategies remain the default. The world supports twenty canonical definitions without twenty model processes. Optional MCP controllers are described in [the controller boundary](mcp-agent-controller.md); timeouts and invalid intents fall back safely to a validated builtin action.
