---
date: 2026-11-23
title: Keep Clerk sign-in above world dialogs
summary: The sign-in surface now stacks above the world's own dialogs, so a visitor is never asked to log in behind an overlay they cannot dismiss.
commit: https://github.com/lewodro/autonomous-agent-economy/commit/a0186a78bd3d56f77efbccc597764a9e9a442218
pr: https://github.com/lewodro/autonomous-agent-economy/pull/103
---
## Why
World dialogs and the Clerk modal both use high stacking contexts. Depending on the entry path, the account prompt could render underneath a world overlay.

## Fix
Clerk's container is raised above world dialogs and the farm and world surfaces account for the active auth layer. Sign-in and the guest path both stay usable from inside the world.

## Tests
The Clerk browser smoke covers the sign-in handoff from a world dialog.
