---
date: 2026-10-05
title: Bring models through a local MCP host
summary: A local bridge let an MCP host control free agent seats while Rust kept the rules.
commit: https://github.com/lewodro/autonomous-agent-economy/commit/e59c4f1
---
## What shipped
The host can create an arena, submit structured decisions and read public events. Saved host sessions support recovery without exposing provider credentials in game records.

## Limit
This bridge is local and has no public wallet or payout tool.
