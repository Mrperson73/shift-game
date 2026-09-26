export interface RGBA { r: number; g: number; b: number; a: number }
export type ColorFormat = 'hex' | 'rgb' | 'hsl' | 'named';
export interface ParsedColor extends RGBA { format: ColorFormat; hasAlpha: boolean }

const NAMED_SRC =
  'aliceblue:f0f8ff,antiquewhite:faebd7,aqua:00ffff,aquamarine:7fffd4,azure:f0ffff,beige:f5f5dc,bisque:ffe4c4,black:000000,' +
  'blanchedalmond:ffebcd,blue:0000ff,blueviolet:8a2be2,brown:a52a2a,burlywood:deb887,cadetblue:5f9ea0,chartreuse:7fff00,' +
  'chocolate:d2691e,coral:ff7f50,cornflowerblue:6495ed,cornsilk:fff8dc,crimson:dc143c,cyan:00ffff,darkblue:00008b,' +
  'darkcyan:008b8b,darkgoldenrod:b8860b,darkgray:a9a9a9,darkgreen:006400,darkgrey:a9a9a9,darkkhaki:bdb76b,darkmagenta:8b008b,' +
  'darkolivegreen:556b2f,darkorange:ff8c00,darkorchid:9932cc,darkred:8b0000,darksalmon:e9967a,darkseagreen:8fbc8f,' +
  'darkslateblue:483d8b,darkslategray:2f4f4f,darkslategrey:2f4f4f,darkturquoise:00ced1,darkviolet:9400d3,deeppink:ff1493,' +
  'deepskyblue:00bfff,dimgray:696969,dimgrey:696969,dodgerblue:1e90ff,firebrick:b22222,floralwhite:fffaf0,forestgreen:228b22,' +
  'fuchsia:ff00ff,gainsboro:dcdcdc,ghostwhite:f8f8ff,gold:ffd700,goldenrod:daa520,gray:808080,green:008000,greenyellow:adff2f,' +
  'grey:808080,honeydew:f0fff0,hotpink:ff69b4,indianred:cd5c5c,indigo:4b0082,ivory:fffff0,khaki:f0e68c,lavender:e6e6fa,' +
  'lavenderblush:fff0f5,lawngreen:7cfc00,lemonchiffon:fffacd,lightblue:add8e6,lightcoral:f08080,lightcyan:e0ffff,' +
  'lightgoldenrodyellow:fafad2,lightgray:d3d3d3,lightgreen:90ee90,lightgrey:d3d3d3,lightpink:ffb6c1,lightsalmon:ffa07a,' +
  'lightseagreen:20b2aa,lightskyblue:87cefa,lightslategray:778899,lightslategrey:778899,lightsteelblue:b0c4de,' +
  'lightyellow:ffffe0,lime:00ff00,limegreen:32cd32,linen:faf0e6,magenta:ff00ff,maroon:800000,mediumaquamarine:66cdaa,' +
  'mediumblue:0000cd,mediumorchid:ba55d3,mediumpurple:9370db,mediumseagreen:3cb371,mediumslateblue:7b68ee,' +
  'mediumspringgreen:00fa9a,mediumturquoise:48d1cc,mediumvioletred:c71585,midnightblue:191970,mintcream:f5fffa,' +
  'mistyrose:ffe4e1,moccasin:ffe4b5,navajowhite:ffdead,navy:000080,oldlace:fdf5e6,olive:808000,olivedrab:6b8e23,' +
  'orange:ffa500,orangered:ff4500,orchid:da70d6,palegoldenrod:eee8aa,palegreen:98fb98,paleturquoise:afeeee,' +
  'palevioletred:db7093,papayawhip:ffefd5,peachpuff:ffdab9,peru:cd853f,pink:ffc0cb,plum:dda0dd,powderblue:b0e0e6,' +
  'purple:800080,rebeccapurple:663399,red:ff0000,rosybrown:bc8f8f,royalblue:4169e1,saddlebrown:8b4513,salmon:fa8072,' +
  'sandybrown:f4a460,seagreen:2e8b57,seashell:fff5ee,sienna:a0522d,silver:c0c0c0,skyblue:87ceeb,slateblue:6a5acd,' +
  'slategray:708090,slategrey:708090,snow:fffafa,springgreen:00ff7f,steelblue:4682b4,tan:d2b48c,teal:008080,thistle:d8bfd8,' +
  'tomato:ff6347,turquoise:40e0d0,violet:ee82ee,wheat:f5deb3,white:ffffff,whitesmoke:f5f5f5,yellow:ffff00,yellowgreen:9acd32';

const NAMED = new Map(NAMED_SRC.split(',').map((p) => p.split(':') as [string, string]));

const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const FN_RE = /^(rgba?|hsla?)\(\s*([^()]*?)\s*\)$/i;

export const isNamedColor = (s: string) => NAMED.has(s.trim().toLowerCase());
/** Unambiguous color syntax (hex or rgb()/hsl()); named colors need context. */
export const isColorLiteral = (s: string) => HEX_RE.test(s.trim()) || (FN_RE.test(s.trim()) && parseColor(s) !== null);

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function num(tok: string, scale: number): number | null {
  const m = /^(-?\d*\.?\d+(?:e[+-]?\d+)?)(%?)$/i.exec(tok);
  if (!m) return null;
  const v = parseFloat(m[1]);
  return m[2] ? (v / 100) * scale : v;
}

export function parseColor(input: string): ParsedColor | null {
  const s = input.trim();
  let m = HEX_RE.exec(s);
  if (m) {
    let h = m[1];
    if (h.length <= 4) h = [...h].map((c) => c + c).join('');
    const n = (i: number) => parseInt(h.slice(i, i + 2), 16);
    const hasAlpha = h.length === 8;
    return { r: n(0), g: n(2), b: n(4), a: hasAlpha ? Math.round((n(6) / 255) * 1000) / 1000 : 1, format: 'hex', hasAlpha };
  }
  const named = NAMED.get(s.toLowerCase());
  if (named) return { ...parseColor('#' + named)!, format: 'named', hasAlpha: false };
  m = FN_RE.exec(s);
  if (!m) return null;
  const fn = m[1].toLowerCase();
  const parts = m[2].split(/\s*[,/]\s*|\s+/).filter(Boolean);
  if (parts.length !== 3 && parts.length !== 4) return null;
  const hasAlpha = parts.length === 4;
  const a = hasAlpha ? num(parts[3], 1) : 1;
  if (a === null) return null;
  if (fn.startsWith('rgb')) {
    const [r, g, b] = parts.slice(0, 3).map((p) => num(p, 255));
    if (r === null || g === null || b === null) return null;
    return { r: clamp(Math.round(r), 0, 255), g: clamp(Math.round(g), 0, 255), b: clamp(Math.round(b), 0, 255), a: clamp(a, 0, 1), format: 'rgb', hasAlpha };
  }
  const h = num(parts[0].replace(/deg$/i, ''), 360);
  const sat = num(parts[1], 1);
  const lig = num(parts[2], 1);
  if (h === null || sat === null || lig === null || !parts[1].endsWith('%') || !parts[2].endsWith('%')) return null;
  return { ...hslToRgb(h, sat, lig), a: clamp(a, 0, 1), format: 'hsl', hasAlpha };
}

function hslToRgb(h: number, s: number, l: number): RGBA {
  h = ((h % 360) + 360) % 360;
  s = clamp(s, 0, 1);
  l = clamp(l, 0, 1);
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return { r: Math.round(f(0) * 255), g: Math.round(f(8) * 255), b: Math.round(f(4) * 255), a: 1 };
}

export function rgbToHsl({ r, g, b }: RGBA): { h: number; s: number; l: number } {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h *= 60;
  }
  return { h, s, l };
}

const hex2 = (n: number) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0');
const round = (v: number, d: number) => String(Math.round(v * 10 ** d) / 10 ** d);

export function toHex6(c: RGBA): string {
  return '#' + hex2(c.r) + hex2(c.g) + hex2(c.b);
}

/** Format a color in the same notation as `like` (the original source text). */
export function formatColor(c: RGBA, like: string): string {
  const orig = parseColor(like);
  const alpha = c.a < 1 || !!orig?.hasAlpha;
  const fmt = orig?.format ?? 'hex';
  if (fmt === 'hex' || fmt === 'named') {
    let out = hex2(c.r) + hex2(c.g) + hex2(c.b) + (alpha ? hex2(c.a * 255) : '');
    const short = like.trim().length <= 5 && [...out].every((ch, i) => i % 2 === 1 || ch === out[i + 1]);
    if (short && fmt === 'hex') out = [...out].filter((_, i) => i % 2 === 0).join('');
    if (fmt === 'hex' && /[A-F]/.test(like)) out = out.toUpperCase();
    return '#' + out;
  }
  const m = FN_RE.exec(like.trim())!;
  let name = m[1];
  const comma = m[2].includes(',');
  const sep = comma ? ', ' : ' ';
  let body: string;
  if (fmt === 'rgb') body = [c.r, c.g, c.b].map((v) => String(Math.round(v))).join(sep);
  else {
    const { h, s, l } = rgbToHsl(c);
    body = `${round(h, 0)}${sep}${round(s * 100, 1)}%${sep}${round(l * 100, 1)}%`;
  }
  const named4 = /a$/i.test(name);
  if (!alpha && !named4) return `${name}(${body})`;
  const a = round(c.a, 3);
  if (!comma) return `${name}(${body} / ${a})`;
  if (!named4) name += name === name.toUpperCase() ? 'A' : 'a';
  return `${name}(${body}, ${a})`;
}
