// tilesvg.js — 牌面の本格SVG描画
// 実物の麻雀牌の意匠に準拠: 筒子=円の伝統配置 / 索子=竹(1索=孔雀) / 萬子=漢数字+萬 / 字牌
// viewBox 60x82。tileEl がこれを牌ボディに嵌め込む。

const BLUE = '#1e4f9c', RED = '#c0392b', GREEN = '#1d7a3c', INK = '#141a26';
const R_ALL = '#d61a1a'; // 赤5用

// --- 筒子: 二重丸(外輪+白地+芯) ---
function pin(cx, cy, r, color) {
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${color}"/>` +
         `<circle cx="${cx}" cy="${cy}" r="${r * 0.62}" fill="#faf9f0"/>` +
         `<circle cx="${cx}" cy="${cy}" r="${r * 0.30}" fill="${color}"/>`;
}
const PIN_LAYOUTS = {
  1: [[30, 41, 17]],
  2: [[30, 22, 11], [30, 60, 11]],
  3: [[16, 18, 10], [30, 41, 10], [44, 64, 10]],
  4: [[18, 21, 10], [42, 21, 10], [18, 61, 10], [42, 61, 10]],
  5: [[16, 18, 9], [44, 18, 9], [30, 41, 9], [16, 64, 9], [44, 64, 9]],
  6: [[18, 16, 9], [42, 16, 9], [18, 41, 9], [42, 41, 9], [18, 66, 9], [42, 66, 9]],
  7: [[14, 13, 7.5], [28, 18, 7.5], [42, 23, 7.5], [18, 47, 8], [42, 47, 8], [18, 67, 8], [42, 67, 8]],
  8: [[18, 13, 8], [42, 13, 8], [18, 32, 8], [42, 32, 8], [18, 51, 8], [42, 51, 8], [18, 70, 8], [42, 70, 8]],
  9: [[15, 16, 8], [30, 16, 8], [45, 16, 8], [15, 41, 8], [30, 41, 8], [45, 41, 8], [15, 66, 8], [30, 66, 8], [45, 66, 8]],
};
// 各筒の色(伝統柄に寄せた配色)。5の中央と7の上段は赤
function pinColors(n, red) {
  if (red) return Array(n).fill(R_ALL);
  const c = Array(n).fill(BLUE);
  if (n === 1) return [RED];
  if (n === 3) c[1] = RED;
  if (n === 5) c[2] = RED;
  if (n === 7) { c[0] = c[1] = c[2] = RED; }
  if (n === 9) { c[3] = c[4] = c[5] = RED; }
  if (n === 2 || n === 6) c[0] = GREEN;
  if (n === 4) { c[0] = c[3] = GREEN; }
  if (n === 8) { }
  return c;
}
function pinzu(n, red) {
  const colors = pinColors(n, red);
  if (n === 1) { // 1筒は大目玉(多重輪)
    const col = red ? R_ALL : RED;
    return `<circle cx="30" cy="41" r="19" fill="${col}"/>` +
           `<circle cx="30" cy="41" r="15" fill="#faf9f0"/>` +
           `<circle cx="30" cy="41" r="11.5" fill="${red ? R_ALL : BLUE}"/>` +
           `<circle cx="30" cy="41" r="7" fill="#faf9f0"/>` +
           `<circle cx="30" cy="41" r="3.5" fill="${col}"/>`;
  }
  return PIN_LAYOUTS[n].map(([x, y, r], i) => pin(x, y, r, colors[i])).join('');
}

// --- 索子: 竹 (棒の両端が膨らみ、中央に節) ---
function stick(cx, cy, color, h = 22) {
  const w = 6, t = cy - h / 2, b = cy + h / 2;
  const band = 2.2;
  return `<g fill="${color}">` +
    `<rect x="${cx - w / 2}" y="${t}" width="${w}" height="${h}" rx="2.6"/>` +
    `<rect x="${cx - w / 2 - 1.4}" y="${t}" width="${w + 2.8}" height="3.4" rx="1.7"/>` +
    `<rect x="${cx - w / 2 - 1.4}" y="${b - 3.4}" width="${w + 2.8}" height="3.4" rx="1.7"/>` +
    `<rect x="${cx - w / 2 - 0.4}" y="${cy - band / 2}" width="${w + 0.8}" height="${band}" fill="#f3f1e4"/>` +
    `</g>`;
}
const SOU_LAYOUTS = {
  2: [[30, 22], [30, 60]],
  3: [[30, 16], [18, 60], [42, 60]],
  4: [[18, 20], [42, 20], [18, 62], [42, 62]],
  5: [[16, 18], [44, 18], [30, 41], [16, 64], [44, 64]],
  6: [[18, 20], [30, 20], [42, 20], [18, 62], [30, 62], [42, 62]],
  7: [[30, 14], [16, 46], [30, 46], [44, 46], [16, 70], [30, 70], [44, 70]],
  8: [[18, 14], [42, 14], [18, 32], [42, 32], [18, 50], [42, 50], [18, 68], [42, 68]],
  9: [[15, 16], [30, 16], [45, 16], [15, 41], [30, 41], [45, 41], [15, 66], [30, 66], [45, 66]],
};
function souColors(n, red) {
  if (red) return Array(n).fill(R_ALL);
  const c = Array(n).fill(GREEN);
  if (n === 5) c[2] = RED;
  if (n === 7) c[0] = RED;
  if (n === 9) { c[3] = c[4] = c[5] = RED; }
  if (n === 3) c[0] = RED;
  return c;
}
function souzu(n, red) {
  if (n === 1) return bird(red);
  const h = n >= 7 ? 16 : (n >= 4 ? 20 : 26);
  const colors = souColors(n, red);
  return SOU_LAYOUTS[n].map(([x, y], i) => stick(x, y, colors[i], h)).join('');
}
// 1索=孔雀(様式化)
function bird(red) {
  const body = red ? R_ALL : GREEN, accent = red ? R_ALL : RED, gold = '#c8a02a';
  return `
  <g>
    <path d="M30 64 C 18 64 14 52 17 43 C 20 34 28 33 30 26 C 32 33 40 34 43 43 C 46 52 42 64 30 64 Z" fill="${body}"/>
    <path d="M30 30 C 27 22 21 20 16 22 C 20 24 22 27 22 31 Z" fill="${accent}"/>
    <circle cx="30" cy="20" r="6.5" fill="${accent}"/>
    <circle cx="32" cy="18.5" r="1.4" fill="#faf9f0"/>
    <path d="M35.5 20 L 42 18 L 36.5 23 Z" fill="${gold}"/>
    <path d="M22 62 C 14 70 12 76 14 78 C 20 77 26 72 28 66 Z" fill="${accent}"/>
    <path d="M38 62 C 46 70 48 76 46 78 C 40 77 34 72 32 66 Z" fill="${accent}"/>
    <path d="M30 64 C 28 70 28 74 30 78 C 32 74 32 70 30 64 Z" fill="${gold}"/>
    <path d="M23 45 C 26 50 34 50 37 45" stroke="${gold}" stroke-width="2" fill="none" stroke-linecap="round"/>
  </g>`;
}

// --- 萬子: 漢数字 + 萬 (明朝=筆文字系) ---
const KANJI = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];
const MINCHO = `'Yu Mincho','Hiragino Mincho ProN','MS Mincho',serif`;
function manzu(n, red) {
  const numCol = red ? R_ALL : INK;
  const manCol = red ? R_ALL : RED;
  return `<text x="30" y="34" text-anchor="middle" font-family="${MINCHO}" font-weight="800" font-size="31" fill="${numCol}" stroke="${numCol}" stroke-width="0.5">${KANJI[n - 1]}</text>` +
         `<text x="30" y="73" text-anchor="middle" font-family="${MINCHO}" font-weight="800" font-size="33" fill="${manCol}" stroke="${manCol}" stroke-width="0.5">萬</text>`;
}

// --- 字牌 ---
function honor(idx) { // 0=東..3=北 4=白 5=發 6=中
  const chars = ['東', '南', '西', '北', '', '發', '中'];
  const colors = [INK, INK, INK, INK, '', GREEN, RED];
  if (idx === 4) { // 白=枠のみ
    return `<rect x="12" y="14" width="36" height="54" rx="4" fill="none" stroke="${BLUE}" stroke-width="3.2"/>`;
  }
  return `<text x="30" y="57" text-anchor="middle" font-family="${MINCHO}" font-weight="800" font-size="44" fill="${colors[idx]}">${chars[idx]}</text>`;
}

// --- 入口 ---
export function svgFace(kind, red = false) {
  let body = '';
  if (kind < 9) body = manzu(kind + 1, red);
  else if (kind < 18) body = pinzu(kind - 9 + 1, red);
  else if (kind < 27) body = souzu(kind - 18 + 1, red);
  else body = honor(kind - 27);
  return `<svg viewBox="0 0 60 82" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet">${body}</svg>`;
}
