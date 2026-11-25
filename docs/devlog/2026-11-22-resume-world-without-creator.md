---
date: 2026-11-22
title: Resume the world without the character creator
summary: Returning from a cave no longer opens the creator modal, so a visitor who is already playing lands straight back in the world.
commit: https://github.com/lewodro/autonomous-agent-economy/commit/f74b477d2191f289fbeef0870c6e601c781be552
pr: https://github.com/lewodro/autonomous-agent-economy/pull/100
---
## Why
Leaving a cave with E dropped the visitor back into the character creator even though they had already been moving through the world. That modal interrupted normal play.

## Fix
Cave exits set a one-shot session flag. The world consumes it once, skips the intro modal and focuses the canvas. The Character/Profile button still opens customization whenever a visitor wants it.

## Tests
Browser smoke asserts that a normal cave exit returns to play with no modal and the canvas focused.
