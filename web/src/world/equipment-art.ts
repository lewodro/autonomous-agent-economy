/**
 * Original 12×12 pixel-art icons for the adventuring equipment catalog.
 * The same tiny matrices power the bazaar cards, the equipped badge and the
 * cave HUD, so icons stay consistent without shipping new sprite sheets.
 */
const PALETTE: Record<string, string | null> = {
  '.': null,
  o: '#1b1c24', O: '#1b1c24', d: '#33384a', s: '#7f8b9c', S: '#d6e2ea',
  b: '#4c6d8c', c: '#66d4e8', C: '#d8fbff',
  w: '#8a5a32', W: '#c79256', l: '#6b4a2e', L: '#a97948',
  r: '#b5353f', R: '#f07a72', g: '#d8bd73', p: '#f4e6bb',
};

const ICONS: Record<string, readonly string[]> = {
  wooden_sword: [
    '.....WW.....', '.....Ww.....', '.....Ww.....', '.....Ww.....',
    '.....Ww.....', '.....Ww.....', '...ggwwgg...', '..gLLLLLLg..',
    '.....ll.....', '.....ll.....', '....ollO....', '....oooo....',
  ],
  iron_sword: [
    '.....SS.....', '.....Ss.....', '.....Ss.....', '.....Ss.....',
    '.....Ss.....', '.....Ss.....', '...bssssb...', '..bbggggbb..',
    '.....ll.....', '.....Ll.....', '....ollO....', '....oooo....',
  ],
  steel_sword: [
    '.....SS.....', '.....SS.....', '.....Ss.....', '.....Ss.....',
    '.....Ss.....', '.....Ss.....', '...bSSSSb...', '..bbddddbb..',
    '.....Ll.....', '.....Ll.....', '....ollO....', '....oooo....',
  ],
  frostblade: [
    '.....CC.....', '....CcC.....', '....CcC.....', '...CcCcC...',
    '...CcCcC...', '..CcCCcC...', '..bcCCcb...', '.bbccccbb..',
    '.....Ll.....', '.....Ll.....', '....oclO....', '....oooo....',
  ],
  light_armor: [
    '..oooooooo..', '.oLLLLLLLLo.', '.oLllllllLo.', 'ooLllllllLoo',
    'oLlLLLLLLlLo', 'oLlLddddLlLo', 'oLlLllllLlLo', 'oLllllllllLo',
    '.ollllllllo.', '.ollllllllo.', '..o.oooo.o..', '..o......o..',
  ],
  health_potion: [
    '....oooo....', '....o..o....', '...o....o...', '...o.p..o...',
    '..o..pp..o..', '..oRrrrrRo..', '..oRRRRRRo..', '..oRRRRRRo..',
    '..oRrrrrRo..', '...oRRRRo...', '...oooooo...', '............',
  ],
};

export const EQUIPMENT_ICON_IDS = Object.freeze(Object.keys(ICONS));

/** Throws during build if any hand-written sprite drifts off the grid. */
export function verifyEquipmentIcons(): boolean {
  for (const [id, rows] of Object.entries(ICONS)) {
    if (rows.length !== 12 || rows.some(row => row.length !== 12)) throw new Error(`Invalid equipment icon: ${id}`);
    for (const row of rows) for (const key of row) if (!(key in PALETTE)) throw new Error(`Unknown equipment pixel in ${id}`);
  }
  return true;
}

export function drawEquipmentIcon(context: CanvasRenderingContext2D, id: string, scale = 3, originX = 0, originY = 0): void {
  const rows = ICONS[id] || ICONS.wooden_sword!;
  for (let y = 0; y < rows.length; y += 1) {
    const row = rows[y]!;
    for (let x = 0; x < row.length; x += 1) {
      const color = PALETTE[row[x]!];
      if (!color) continue;
      context.fillStyle = color;
      context.fillRect(originX + x * scale, originY + y * scale, scale, scale);
    }
  }
}

export function equipmentIconCanvas(id: string, scale = 3): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 12 * scale; canvas.height = 12 * scale;
  const context = canvas.getContext('2d');
  if (context) drawEquipmentIcon(context, id, scale);
  canvas.className = 'equipment-icon';
  canvas.setAttribute('aria-hidden', 'true');
  return canvas;
}
