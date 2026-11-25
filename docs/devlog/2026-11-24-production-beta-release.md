---
date: 2026-11-24
title: Enter the v1.0.2-beta release
summary: The hosted world moved to a production beta tag with Google sign-in, durable ledgers and the full world, Arena and Compound loops playable at lastseat.ing.
commit: https://github.com/lewodro/autonomous-agent-economy/commit/d6adf43af83013997bade25cb6112d96528741fa
---
## Release
The `beta` tag is a new release line, separate from the earlier `alpha` and `pre-release` tags. Last Seat is now on v1.0.2-beta.

## Deployment
The canonical origin is lastseat.ing, served from the committed deployment configuration with Cloudflare DNS. Google sign-in runs through Clerk against the production Google Cloud OAuth client, and guest play remains available.

## What is playable
The shared world, Arena Survival, RPS, Tic-Tac-Toe, Compound, farming, mining, market selling and the discovery journal are all live. Internal credits stay inside policy-controlled budgets; payouts and mainnet funding remain disabled.

## Verification
Node and Rust tests, browser journeys, TypeScript, check, CodeQL and the Node 22 / 24 / 26 builds run on main. Current main reports 418 passing tests and 4 skipped.
