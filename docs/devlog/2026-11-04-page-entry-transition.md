---
date: 2026-11-04
title: Give every page entrance a short, readable transition
summary: Every public page now opens through the shared matrix transition with a slim progress bar that starts slowly and accelerates near the end, including on repeat visits.
commit: https://github.com/lewodro/autonomous-agent-economy/commit/af10349bd8f90ed91679cd073b9edcb35ed3874c
---
## Why
Page loads jumped straight from the previous screen into the next one. The short matrix wipe that already existed on public pages now carries one shared progress bar, so navigation reads as a deliberate entrance instead of a flash of unstyled content.

## Entry transition
The shared entry script adds a compact track to the transition overlay and fills it on a gentle ease-in curve: slow at first, then a quick sweep to the end. The bar appears on every page load, not just the first visit, and the overlay clears itself after the fill. A timer fallback removes it even when requestAnimationFrame is paused in a background tab.

Reduced-motion visitors still skip the overlay entirely.

## Tests
The full test suite passed with 298 tests and 4 skipped. The repository syntax check passed, and a browser check confirmed the bar, the eased fill and clean removal on the root, World and build-log pages across repeat loads.
