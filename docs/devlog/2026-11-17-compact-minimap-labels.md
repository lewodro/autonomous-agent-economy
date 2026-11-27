---
date: 2026-11-17
title: Keep compact minimap labels readable
summary: The minimap keeps its small labels as DOM text, so they stay crisp on high-density screens and clear of the touch controls.
commit: https://github.com/lewodro/autonomous-agent-economy/commit/a51443c8ebcacfcb771c52870e37a953503f185c
---
## Why
Drawing place names into the canvas blurred them on retina and mobile screens, and the smallest labels collided once the map gained more points of interest.

## Frontend
Labels are rendered as positioned DOM elements over the canvas rather than baked pixels. The compact set keeps short names, avoids overlap and stays out of the bottom-left touch area.

## Tests
Responsive browser runs cover the minimap at desktop and mobile sizes.
