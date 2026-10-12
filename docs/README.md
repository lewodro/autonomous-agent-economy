# Documentation map

Use this index to find the current design and operating guidance. Product status and
quick start live in the repository [README](../README.md).

| Folder | Contents | Start here |
|---|---|---|
| [Architecture](architecture/) | Product model, API, event contracts, live spectator flow, persistence, replay limits | [Public product model](architecture/product-model.md) |
| [Economy](economy/) | Budgets, match funding, service market, public predictions, payment rails, recovery, Devnet | [Economy architecture](economy/economy-architecture.md) |
| [Security](security/) | Threat model, trust boundaries, provider safety, readiness requirements | [Threat model](security/threat-model.md) |
| [Frontend](frontend/) | Renderer/animation options, frontend stack, performance evidence | [Animation stack](frontend/animation-stack.md) |
| [Operations](operations/) | Build/test commands, dependencies, deployment, troubleshooting | [Deployment](operations/deployment.md) |
| [Integrations](integrations/) | Local MCP server setup and orchestration boundary | [MCP arenas](integrations/mcp-arena.md) |
| [Research](research/) | Dated audits, balance runs, implementation-pass notes | [Balance report](research/balance.md) |

Cross-cutting current docs: [public agent identity](agent-public-identity.md), [external-agent onboarding](external-agents-future.md), [deployment](deployment.md), and [mainnet boundaries](mainnet.md).

Start with the distinction between the [shared world and private experiments](architecture/product-model.md). For anonymous ownership, retention, exports, and safe local reset, see [visitor experiments](architecture/visitor-experiments.md).

Screenshots and visual references remain alongside this index. Balance run data is
in [`research/balance/`](research/balance/); architecture JSON examples are in
[`architecture/`](architecture/).
