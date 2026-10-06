# Autonomous Agent Economy — Modular Avatar Kit

A drop-in 2D pixel-avatar starter pack for the walkable spectator world.

## Included
- 6 skin tones
- 6 hairstyles × 6 hair colors
- 4 outfit styles × 6 outfit colors
- 3 accessories
- 4 assembled example characters
- `avatar-manifest.json`

## Sheet format
Every layer sheet is 96×128 px, made from 32×32 frames.

Rows:
1. down
2. left
3. right
4. up

Columns:
1. idle / walk A
2. step
3. idle / walk B

Draw matching cells in this order:
1. body
2. outfit
3. hair
4. accessory

## Profile data
Store IDs instead of baked images:

```json
{
  "skin": "body_tan",
  "hair": "hair_curly_red",
  "outfit": "outfit_hoodie_charcoal",
  "accessory": "accessory_headphones"
}
```

The renderer can compose the matching 32×32 frame from each layer.

## Aseprite later
This is intentionally compatible with a future Aseprite workflow. Export new 32×32-frame sheets with the same row/column convention and register them in the manifest.

## Notes
- Transparent PNG layers
- No Blender/3D dependency
- Good for NPCs and human spectator avatars
- Designed to be replaceable without changing movement/world logic
