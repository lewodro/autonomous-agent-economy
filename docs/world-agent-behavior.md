# Shared world agent behavior

The public plaza uses the existing canvas renderer, map collision, sprite catalog, and Arena profile gateway. Canonical identities and stats come from the public profile API; a browser may animate their current location, but it never settles a match.

## State machine

NPCs move through typed presentation states: `idle`, `wander`, `walk_to_arena`, `inside_arena`, `exit_arena`, `walk_to_poi`, `studying`, `attention`, `talking`, and `cooldown`. Fighting profiles are removed from the plaza while their authoritative `arenaStatus` is `fighting`. Finished profiles return at the Arena doorway, pause briefly, study the public result, and then resume a plaza route. If a live room does not expose a participant mapping, the scheduler uses a deterministic presentation-only route as a fallback; it never fabricates match results.

Movement uses the existing animation loop, collision system and ordered waypoint network. Controllers enter that network at the nearest reachable waypoint instead of targeting an arbitrary distant waypoint through buildings. A stable hash of the canonical profile id gives each strategy a small behavior profile: aggressive and gambler profiles travel faster, analysts pause near research routes, defenders favor stable routes, and traders are more social. This is lightweight and requires no model calls.

Canonical identity, Arena participation and research are shared server data. Human visitor positions use the shared presence service. Ambient NPC coordinates remain ephemeral browser presentation and are not persisted or broadcast as visitor sessions; clients use the same deterministic profiles and route network, but exact animation phase can differ between browsers. A future server NPC snapshot can replace this presentation boundary without changing match authority.

## Speech and privacy

Thought opportunities are rate-limited to one opportunity per agent per minute and three globally per minute. A nearby visitor sees a small pixel `!`; dialogue appears only after interaction. The NPC pauses for attention and talking, enters a short cooldown, then resumes its route. Ignored thoughts expire after 24 seconds.

Thought text uses only public profile strategy, retained public memory, current activity and public Survival research. Exact match language is shown only when it came from those records. Fixed synthetic trace lines add character flavor; they are not read from source files and never include paths, secrets, prompts, private experiments or credentials.

## Terrain-aware decoration

Trees, bushes, flower beds and rocks pass centralized placement rules in `map.ts`. The rules reject map boundaries, buildings, roads, the paved plaza and market lanes before those decorations enter the rendered or collision arrays. Twelve stable vegetation groups distribute nature across north, south, east and west while keeping the central plaza open.

## Adding a canonical profile

Add the profile through the existing canonical agent configuration and public profile projection. Keep identity, sprite, strategy, and research schema stable. Do not put runtime history, private experiments, or controller credentials in source configuration.

## Local operation

Built-in deterministic strategies remain the default. The world supports twenty canonical definitions without twenty model processes. Optional MCP controllers are described in [the controller boundary](mcp-agent-controller.md); timeouts and invalid intents fall back safely to a validated builtin action.
