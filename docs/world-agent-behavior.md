# Shared world agent behavior

The public plaza uses the existing canvas renderer, map collision, sprite catalog, and Arena profile gateway. Canonical identities and stats come from the public profile API; a browser may animate their current location, but it never settles a match.

## State machine

NPCs move through typed presentation states: `idle`, `wander`, `walk_to_arena`, `inside_arena`, `exit_arena`, `walk_to_poi`, `studying`, `talking`, and `cooldown`. Fighting profiles are removed from the plaza while their authoritative `arenaStatus` is `fighting`. Finished profiles return at the Arena doorway, pause briefly, study the public result, and then resume a plaza route. If a live room does not expose a participant mapping, the scheduler uses a deterministic presentation-only route as a fallback; it never fabricates match results.

Movement is one shared animation loop with collision-aware destinations. A stable hash of the canonical profile id gives each strategy a small behavior profile: aggressive and gambler profiles travel faster, analysts pause near research routes, defenders favor stable routes, and traders are more social. This is lightweight and requires no model calls.

## Speech and privacy

Speech is rate-limited per agent and globally. It uses only public profile strategy, public memory, activity, and recent public observations. Fixed synthetic trace lines add character flavor; they are not read from source files and never include paths, secrets, prompts, private experiments, or credentials. A nearby visitor sees a small notification and can open the existing profile/research dialog.

## Adding a canonical profile

Add the profile through the existing canonical agent configuration and public profile projection. Keep identity, sprite, strategy, and research schema stable. Do not put runtime history, private experiments, or controller credentials in source configuration.

## Local operation

Built-in deterministic strategies remain the default. The world supports twenty canonical definitions without twenty model processes. Optional MCP controllers are described in [the controller boundary](mcp-agent-controller.md); timeouts and invalid intents fall back safely to a validated builtin action.
