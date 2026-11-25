---
date: 2026-11-22
title: Bring the overworld grass back to one palette
summary: Every normal terrain band now shares close green shades and clustered world-space variation, so the outer wilderness stops reading as generated colour blocks.
commit: https://github.com/lewodro/autonomous-agent-economy/commit/1befaf2c851b930311c9a96579af6d767621077a
pr: https://github.com/lewodro/autonomous-agent-economy/pull/100
---
## Why
Terrain patches used high-contrast biome colours and an alternating per-tile palette. From normal camera distance that produced large checkerboard regions instead of one continuous field.

## Terrain
All normal overworld patch colours were pulled onto the plaza's green band, keeping several subtle regional variants. Tone selection now comes from deterministic smooth noise at two scales rather than a modulo pattern, so neighbouring tiles share close tints and patches grow organically.

## Boundaries
Snow, roads, buildings, resources, discoveries, minimap and world size were left untouched. Painting stays in world coordinates, so chunk boundaries cannot show.

## Tests
A palette test asserts every normal terrain colour stays within a subtle green band of the plaza grass, and browser smoke covers the plaza, outer loop and mobile sizes.
