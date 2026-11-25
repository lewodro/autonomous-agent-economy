---
date: 2026-11-23
title: Remove the last grass tint cutoffs
summary: Terrain patches now feather with a noise-warped edge and grass tones dither between neighbours, so the plaza, roads and market stop showing hard rectangular bands.
commit: https://github.com/lewodro/autonomous-agent-economy/commit/5dac2d868698ffbc8c1d1a427cc60cac8171f8d0
pr: https://github.com/lewodro/autonomous-agent-economy/pull/105
---
## Why
Two rules still produced visible cutoffs: authored terrain patches were painted at full opacity with a straight edge, and each 32px tile snapped to a single tone, turning smooth noise contours into blocky bands. A distance gate kept the old five-tone grain alive near the plaza, which is why the band north of the Agent House still looked like a checkerboard.

## Fix
Every patch feathers with a wide, world-space noise-warped falloff. Grass tone stays continuous and each tile dithers between its two neighbouring tones across pixel quadrants. The authored grain became a low-amplitude jitter, and the smooth field breathes with the envelope instead of switching off near the plaza.

## Boundaries
Palette, contrast, grass detail, roads, buildings, resources, discoveries, minimap, snow and world bounds are unchanged. Painting is world-space, so chunk seams cannot appear.

## Tests
Unit tests bound tile-to-tile tone steps in the outskirts and in the Agent House band. TypeScript, check, the full Node suite and world browser smoke all pass.
