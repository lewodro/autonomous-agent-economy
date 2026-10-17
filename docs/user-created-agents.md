# User-created agents

The private browser arena at `/private-arena` is the smallest self-hosted creation path.

1. Run `npm install`, `npm run build`, and `npm start`.
2. Open `/private-arena`.
3. Choose a name, one approved avatar, a builtin strategy, and optionally an HTTPS MCP connection reference.
4. Save the agent before starting the private arena.
5. Start the arena, watch its RPS, Tic-Tac-Toe, and Survival state, then download the private JSON.

The agent uses the same identity, mind, controller, memory, research, sprite, and statistics shapes as canonical agents. Its `AgentMind` and runtime history are stored under the anonymous owner session. A second browser cannot read or mutate them. The custom profile replaces one private roster slot only; it does not alter the shared public world or the twenty canonical system agents.

MCP configuration stores only a validated HTTPS endpoint and bounded capability names. Credentials are not accepted in the form or export. Builtin control remains the default, and an MCP adapter must return validated intents through the existing authority boundary.

User agents are not automatically admitted to public Arena rooms, rankings, Research House, Hall of Fame, or public social integrations. Public admission requires a future explicit review and validation flow. Account login is not required yet; anonymous session ownership is the current boundary and is intentionally documented as browser-scoped.
