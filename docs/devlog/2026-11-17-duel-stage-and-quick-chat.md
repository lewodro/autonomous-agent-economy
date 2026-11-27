---
date: 2026-11-17
title: Make short duels readable at a glance
summary: Duel staging, game feel and an eight-phrase quick chat make RPS and Tic-Tac-Toe easy to follow and easy to play with someone nearby.
commit: https://github.com/lewodro/autonomous-agent-economy/commit/d93135d937919b59d98c44ad6e3f1add0197d0ff
pr: https://github.com/lewodro/autonomous-agent-economy/pull/92
---
## Why
RPS and Tic-Tac-Toe resolve in seconds. Without staging and readable feedback the result arrives before a visitor understands what happened.

## Frontend
The duel stage now frames both players, shows the deciding line, and uses restrained motion so the outcome is obvious without confetti. Quick chat expanded to eight phrases across two pages, which is enough for short social matches without a full chat system.

## Boundaries
Chat stays a fixed phrase list. It never accepts free text, so nothing enters match records or public history from it.

## Tests
Browser regressions cover the duel stage, the winning line and both quick-chat pages.
