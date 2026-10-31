export interface CompoundPoint { x: number; y: number }
export interface CompoundRoom { id: string; label: string; x: number; y: number; w: number; h: number; terrain: string; restricted: boolean }
export interface CompoundProp { id: string; kind: string; x: number; y: number; solid: boolean }

type PixelContext = CanvasRenderingContext2D;

const FLOOR: Record<string, { base: string; dark: string; light: string }> = {
  corridor: { base: '#756d5a', dark: '#655e4f', light: '#827965' },
  cell: { base: '#7a8878', dark: '#687766', light: '#879683' },
  cafeteria: { base: '#867b62', dark: '#746a55', light: '#94886e' },
  kitchen: { base: '#776c56', dark: '#655b49', light: '#887b62' },
  security: { base: '#5d525a', dark: '#4b4149', light: '#6c6068' },
  visitation: { base: '#796f5d', dark: '#675e50', light: '#897d68' },
  yard: { base: '#557252', dark: '#466143', light: '#63805d' },
  gym: { base: '#626b5b', dark: '#525b4d', light: '#727c69' },
  workshop: { base: '#716a57', dark: '#5f594a', light: '#817963' },
  infirmary: { base: '#6d8078', dark: '#5b6d66', light: '#7d9188' },
  showers: { base: '#577679', dark: '#486568', light: '#66888b' },
  storage: { base: '#655f52', dark: '#554f45', light: '#746d5e' },
  utility: { base: '#56615c', dark: '#46514d', light: '#65706b' },
  service: { base: '#505d56', dark: '#414d47', light: '#606b64' },
};

function rect(context: PixelContext, color: string, x: number, y: number, width: number, height: number): void {
  context.fillStyle = color;
  context.fillRect(Math.round(x), Math.round(y), Math.round(width), Math.round(height));
}

function line(context: PixelContext, color: string, x: number, y: number, width: number, height: number): void {
  rect(context, color, x, y, Math.max(1, width), Math.max(1, height));
}

export function drawCompoundFloor(context: PixelContext, room: CompoundRoom | undefined, tileX: number, tileY: number, size: number): void {
  const palette = FLOOR[room?.terrain || 'corridor'] ?? FLOOR.corridor!;
  const x = tileX * size;
  const y = tileY * size;
  rect(context, palette.base, x, y, size, size);

  if (room?.terrain === 'yard') {
    if ((tileX * 7 + tileY * 11) % 9 === 0) {
      line(context, palette.light, x + 7, y + 9, 2, 5);
      line(context, palette.dark, x + 10, y + 12, 2, 3);
    }
    return;
  }

  if (room?.terrain === 'showers' || room?.terrain === 'infirmary' || room?.terrain === 'kitchen') {
    line(context, palette.dark, x, y + size - 1, size, 1);
    line(context, palette.dark, x + size - 1, y, 1, size);
    if ((tileX + tileY) % 2 === 0) {
      rect(context, palette.light, x + 3, y + 3, 2, 2);
    }
    return;
  }

  if ((tileX * 17 + tileY * 31) % 13 === 0) {
    line(context, palette.dark, x + 6, y + 9, 4, 2);
    line(context, palette.light, x + 10, y + 11, 2, 1);
  }
  if ((tileX * 23 + tileY * 5) % 29 === 0) {
    line(context, palette.dark, x + size - 9, y + size - 7, 3, 1);
  }
}

export function drawCompoundWall(context: PixelContext, point: CompoundPoint, size: number, mapWidth: number, mapHeight: number): void {
  const x = point.x * size;
  const y = point.y * size;
  const perimeter = point.x === 0 || point.y === 0 || point.x === mapWidth - 1 || point.y === mapHeight - 1;
  rect(context, '#15251f', x + 3, y + 6, size - 3, size - 2);
  if (perimeter) {
    rect(context, '#32473d', x + 2, y + 2, size - 4, size - 6);
    line(context, '#71806e', x + 4, y + 5, size - 8, 3);
    for (let offset = 6; offset < size - 3; offset += 8) line(context, '#1c3028', x + offset, y + 7, 2, size - 12);
    line(context, '#8a907b', x + 3, y + 3, size - 6, 2);
  } else {
    rect(context, '#2b4038', x, y + 4, size, size - 8);
    line(context, '#5d7164', x, y + 4, size, 5);
    line(context, '#1a2b25', x, y + size - 5, size, 5);
    if ((point.x + point.y) % 3 === 0) line(context, '#40564b', x + size - 3, y + 10, 3, size - 16);
  }
}

export function drawCompoundDoor(context: PixelContext, point: CompoundPoint, size: number, restricted: boolean, alarmed: boolean, open = false): void {
  const x = point.x * size;
  const y = point.y * size;
  rect(context, '#172821', x, y + 2, size, size - 2);
  if (open) {
    rect(context, restricted ? '#81483f' : '#996b3f', x + 3, y + 4, 5, size - 7);
    rect(context, restricted ? '#81483f' : '#996b3f', x + size - 8, y + 4, 5, size - 7);
    line(context, alarmed ? '#ef654e' : '#d8b765', x + 4, y + 6, size - 8, 2);
    return;
  }
  rect(context, restricted ? '#81483f' : '#996b3f', x + 5, y + 4, size - 10, size - 7);
  line(context, restricted ? '#b15b4c' : '#bd8952', x + 8, y + 7, size - 16, 3);
  line(context, '#4b3628', x + 8, y + 12, 3, size - 19);
  rect(context, alarmed ? '#ef654e' : '#e5c16a', x + size - 10, y + Math.floor(size / 2), 3, 3);
  if (restricted) line(context, '#d7b56b', x + size / 2 - 3, y + 14, 6, 2);
}

function drawShadow(context: PixelContext, x: number, y: number, size: number): void {
  rect(context, 'rgba(13,24,21,.38)', x + 4, y + size - 6, size - 5, 5);
}

export function drawCompoundProp(context: PixelContext, prop: CompoundProp, size: number): void {
  const x = prop.x * size;
  const y = prop.y * size;
  drawShadow(context, x, y, size);

  if (prop.kind === 'bed' || prop.kind === 'medical_bed') {
    rect(context, '#45372e', x + 3, y + 5, size - 6, size - 8);
    rect(context, prop.kind === 'medical_bed' ? '#d7ded3' : '#6f5140', x + 5, y + 5, size - 10, size - 11);
    rect(context, '#eee5cf', x + 6, y + 6, size - 12, 7);
    line(context, prop.kind === 'medical_bed' ? '#7b9c91' : '#9d6851', x + 6, y + 15, size - 12, 3);
  } else if (prop.kind === 'locker' || prop.kind === 'cabinet') {
    rect(context, '#394943', x + 5, y + 3, size - 10, size - 6);
    rect(context, '#84928a', x + 7, y + 4, size - 14, size - 9);
    line(context, '#adb8ae', x + 9, y + 7, size - 18, 2);
    rect(context, '#263a33', x + size - 11, y + 16, 2, 3);
  } else if (['table', 'bench', 'workbench', 'counter', 'guard_desk', 'desk'].includes(prop.kind)) {
    const top = prop.kind === 'workbench' ? '#a06d3e' : prop.kind === 'counter' ? '#9a835f' : '#856445';
    rect(context, '#49372b', x + 4, y + 9, size - 8, size - 12);
    rect(context, top, x + 2, y + 6, size - 4, 7);
    line(context, '#c09a63', x + 3, y + 6, size - 6, 2);
    if (prop.kind === 'workbench') {
      rect(context, '#b8b9a7', x + 8, y + 4, 7, 3);
      rect(context, '#3e4e48', x + 19, y + 5, 4, 5);
    }
  } else if (prop.kind === 'toilet') {
    rect(context, '#d9ddd2', x + 8, y + 6, size - 16, 11);
    rect(context, '#aebeb6', x + 10, y + 16, size - 20, 10);
    rect(context, '#4c706d', x + 13, y + 18, size - 26, 5);
  } else if (prop.kind === 'stove') {
    rect(context, '#29312f', x + 4, y + 4, size - 8, size - 8);
    for (const offset of [8, size - 13]) {
      rect(context, '#111a18', x + offset, y + 8, 6, 6);
      rect(context, '#be5c39', x + offset + 1, y + 9, 4, 2);
    }
    line(context, '#9ca59e', x + 7, y + size - 10, size - 14, 3);
  } else if (prop.kind === 'weights') {
    line(context, '#c2c8b5', x + 5, y + 15, size - 10, 3);
    rect(context, '#27332f', x + 3, y + 10, 6, 13);
    rect(context, '#27332f', x + size - 9, y + 10, 6, 13);
    line(context, '#7f9487', x + 10, y + 23, size - 20, 4);
  } else if (prop.kind === 'treadmill') {
    rect(context, '#303a37', x + 4, y + size - 12, size - 8, 8);
    line(context, '#799085', x + 7, y + size - 10, size - 14, 3);
    line(context, '#9eb2a8', x + size - 10, y + 5, 4, size - 13);
  } else if (prop.kind === 'shower') {
    line(context, '#9ab8b6', x + 13, y + 3, 4, size - 8);
    line(context, '#9ab8b6', x + 13, y + 3, 10, 4);
    rect(context, '#6da4a8', x + 20, y + 7, 6, 6);
    for (let drop = 0; drop < 3; drop++) rect(context, '#8fc5c6', x + 17 + drop * 4, y + 16 + drop * 3, 2, 4);
  } else if (prop.kind === 'crate' || prop.kind === 'food_crate') {
    const color = prop.kind === 'food_crate' ? '#71824a' : '#79593b';
    rect(context, '#453725', x + 4, y + 4, size - 8, size - 8);
    rect(context, color, x + 6, y + 6, size - 12, size - 12);
    line(context, '#ad8959', x + 7, y + 9, size - 14, 3);
    line(context, '#ad8959', x + 7, y + size - 12, size - 14, 3);
  } else if (prop.kind === 'sink') {
    rect(context, '#a9bbb3', x + 6, y + 8, size - 12, size - 13);
    rect(context, '#557975', x + 10, y + 12, size - 20, size - 21);
    line(context, '#d6ddd5', x + size / 2 - 1, y + 4, 3, 8);
  } else if (['monitor', 'terminal', 'machine', 'panel'].includes(prop.kind)) {
    rect(context, '#26332f', x + 4, y + 4, size - 8, size - 8);
    rect(context, '#69a88c', x + 8, y + 7, size - 16, size - 17);
    line(context, '#a7dfb9', x + 10, y + 10, size - 22, 2);
    rect(context, '#d6bd64', x + 9, y + size - 8, 4, 3);
    rect(context, '#b85a4a', x + 16, y + size - 8, 3, 3);
  } else if (prop.kind === 'alarm') {
    rect(context, '#43282a', x + 8, y + 5, size - 16, size - 10);
    rect(context, '#e36550', x + 11, y + 8, size - 22, size - 18);
    line(context, '#ffd074', x + 13, y + 10, size - 26, 3);
  } else if (prop.kind === 'dirty_spot') {
    rect(context, '#3c4939', x + 8, y + 17, 4, 3);
    rect(context, '#465342', x + 14, y + 13, 7, 4);
    rect(context, '#344034', x + 20, y + 20, 3, 2);
  } else if (prop.kind === 'poster') {
    rect(context, '#d4c681', x + 7, y + 5, size - 14, size - 12);
    line(context, '#96594b', x + 10, y + 9, size - 20, 3);
    line(context, '#5c715f', x + 10, y + 15, size - 23, 2);
  } else if (prop.kind === 'tray') {
    rect(context, '#b3b29d', x + 6, y + 10, size - 12, 13);
    rect(context, '#786443', x + 9, y + 13, 7, 5);
    rect(context, '#758c4f', x + 19, y + 13, 5, 5);
  } else if (prop.kind === 'vent') {
    rect(context, '#28352f', x + 5, y + 7, size - 10, size - 14);
    for (let offset = 10; offset < size - 7; offset += 5) line(context, '#78857c', x + 8, y + offset, size - 16, 2);
  } else if (['shelf', 'pipes', 'divider', 'laundry', 'key_board'].includes(prop.kind)) {
    rect(context, '#40534b', x + 5, y + 4, size - 10, size - 8);
    line(context, '#95866a', x + 8, y + 8, size - 16, 3);
    line(context, '#95866a', x + 8, y + size - 11, size - 16, 3);
  } else {
    rect(context, '#314b45', x + 4, y + 4, size - 8, size - 8);
    line(context, '#e1bd66', x + 8, y + 8, size - 16, 4);
  }
}

export function drawCompoundItem(context: PixelContext, type: string, center: CompoundPoint, size: number): void {
  const x = center.x;
  const y = center.y;
  rect(context, 'rgba(14,24,21,.4)', x - 7, y + 5, 14, 4);
  const food = ['food', 'meal_tray', 'bread', 'fruit', 'snack', 'ration', 'energy_ration'].includes(type);
  if (food || type === 'medicine') {
    const foodColor = type === 'fruit' ? '#b85b48' : type === 'bread' ? '#c99b58' : type === 'meal_tray' ? '#778985' : type === 'ration' ? '#667d4c' : '#739650';
    rect(context, food ? foodColor : '#d8ddd0', x - 6, y - 7, 12, 13);
    if (type === 'medicine') {
      rect(context, '#c9564e', x - 2, y - 5, 4, 9);
      rect(context, '#c9564e', x - 4, y - 3, 8, 4);
    } else if(type==='meal_tray'){rect(context,'#d9c476',x-4,y-3,4,4);rect(context,'#93ad69',x+1,y-3,4,4);}else rect(context, '#f0ce7b', x - 3, y - 4, 6, 5);
  } else if (type.includes('card') || type.includes('key')) {
    rect(context, '#dfc265', x - 7, y - 4, 14, 9);
    rect(context, '#283833', x + 2, y - 2, 3, 3);
  } else {
    rect(context, '#aeb7aa', x - 6, y - 6, 12, 12);
    line(context, '#66756d', x - 4, y - 2, 8, 3);
  }
  void size;
}

export function drawEscapeMarker(context: PixelContext, point: CompoundPoint, size: number, alarmed: boolean, stage = 0): void {
  const x = point.x * size;
  const y = point.y * size;
  rect(context, '#172821', x + 3, y + 3, size - 6, size - 6);
  context.strokeStyle = alarmed ? '#ef654e' : '#d8b765';
  context.lineWidth = 2;
  context.strokeRect(x + 7, y + 7, size - 14, size - 14);
  line(context, alarmed ? '#ef654e' : '#d8b765', x + 11, y + size / 2 - 1, size - 22, 3);
  rect(context, '#172821', x + size - 10, y + 5, 6, 7);
  rect(context, alarmed ? '#ef654e' : '#d8b765', x + size - 8, y + 7, 2 + Math.min(2, stage), 3);
}
