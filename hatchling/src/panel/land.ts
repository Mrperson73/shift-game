// The habitat's landscape: sky for the local hour, sun or moon, clouds, parallax hills, ground
// and plants for the theme's biome. Everything that doesn't move is rendered once into
// offscreen layers (refreshed once a minute as the light changes), so a frame is a handful of
// drawImage calls plus a few twinkling stars.

import { darken, lighten, mix } from '../pet/draw';
import { rng } from '../pet/math';
import type { Biome, PlantKind, PlantSpec } from './theme';

type Ctx = CanvasRenderingContext2D;
const TAU = Math.PI * 2;
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
const smooth = (t: number) => {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
};

// Sky colours (top, horizon) through the day.
const SKY: [number, string, string][] = [
  [0, '#0b1030', '#1c2653'],
  [4.6, '#0e1438', '#27305e'],
  [5.6, '#3a4583', '#e4958a'],
  [6.6, '#78a7dd', '#ffd0a4'],
  [8.3, '#5eaee8', '#cfeafd'],
  [12, '#4aa2ea', '#c2e6ff'],
  [16.6, '#58a4e3', '#d2ebff'],
  [18.1, '#6c8ed0', '#ffc794'],
  [19.2, '#4a4a8e', '#ff9670'],
  [20.3, '#232a5e', '#5b4786'],
  [21.4, '#0f1541', '#253068'],
  [24, '#0b1030', '#1c2653'],
];

export interface Light {
  hour: number;
  top: string;
  bottom: string;
  /** 1 by day, 0 at night. */
  day: number;
  night: number;
  /** Sunrise/sunset glow, 0..1. */
  warm: number;
}

export function lightAt(hour: number, b: Biome): Light {
  const h = ((hour % 24) + 24) % 24;
  let i = 0;
  while (i < SKY.length - 2 && SKY[i + 1][0] <= h) i++;
  const [h0, t0, b0] = SKY[i];
  const [h1, t1, b1] = SKY[i + 1];
  const f = (h - h0) / (h1 - h0);
  const day = h < 5 || h >= 20.6 ? 0 : h < 7.4 ? smooth((h - 5) / 2.4) : h < 17.6 ? 1 : 1 - smooth((h - 17.6) / 3);
  const g = (c: number, w: number) => Math.exp(-((h - c) ** 2) / (2 * w * w));
  const warm = Math.min(1, g(6.3, 0.75) + g(18.9, 0.85));
  const amt = b.tintAmt * (0.45 + 0.55 * day);
  return { hour: h, top: mix(mix(t0, t1, f), b.tint, amt * 0.75), bottom: mix(mix(b0, b1, f), b.tint, amt), day, night: 1 - day, warm };
}

/** A landscape colour under the current light: warmer at sunrise/sunset, blue-dark at night. */
function lit(c: string, L: Light, haze = 0): string {
  let x = haze > 0 ? mix(c, L.bottom, haze) : c;
  if (L.warm > 0) x = mix(x, '#ff9466', L.warm * 0.16);
  if (L.night > 0) x = mix(x, '#141a3c', L.night * 0.6);
  return x;
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function layer(w: number, h: number, dpr: number, paint: (g: Ctx) => void): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w * dpr));
  c.height = Math.max(1, Math.ceil(h * dpr));
  const g = c.getContext('2d')!;
  g.scale(dpr, dpr);
  paint(g);
  return c;
}

interface Sprite {
  img: HTMLCanvasElement;
  /** Where the sprite's root is drawn, in scene coordinates. */
  x: number;
  y: number;
  /** Root position inside the sprite. */
  ax: number;
  ay: number;
  w: number;
  h: number;
  /** How much it sways (0 = rocks). */
  sway: number;
  phase: number;
}

interface Cloud {
  x: number;
  y: number;
  speed: number;
  shape: number;
  s: number;
}

interface Star {
  x: number;
  y: number;
  r: number;
  ph: number;
  sp: number;
  big: boolean;
}

interface Glow {
  x: number;
  y: number;
  ax: number;
  ay: number;
  fx: number;
  fy: number;
  ph: number;
}

const PAR_FAR = 12;
const PAR_MID = 22;

export class Land {
  readonly w: number;
  readonly h: number;
  readonly dpr: number;
  readonly biome: Biome;
  readonly horizon: number;
  readonly groundTop: number;
  readonly groundY: number;
  light: Light;
  private minute = -1;
  private seed: number;
  private sky!: HTMLCanvasElement;
  private body!: { img: HTMLCanvasElement; x: number; y: number; size: number } | null;
  private far!: HTMLCanvasElement;
  private mid!: HTMLCanvasElement;
  private ground!: HTMLCanvasElement;
  private back: Sprite[] = [];
  private front: Sprite[] = [];
  private cloudImgs: HTMLCanvasElement[] = [];
  private glowImg!: HTMLCanvasElement;
  private clouds: Cloud[] = [];
  private stars: Star[] = [];
  private glows: Glow[] = [];
  private volcano: { x: number; y: number } | null = null;
  /** Top of the painted band in the far and mid layers (the rest is transparent). */
  private farTop = 0;
  private midTop = 0;

  constructor(w: number, h: number, dpr: number, biome: Biome, groundTop: number, groundY: number, hour: number) {
    this.w = w;
    this.h = h;
    this.dpr = dpr;
    this.biome = biome;
    this.groundTop = groundTop;
    this.groundY = groundY;
    this.horizon = groundTop - (h - groundTop) * 0.2;
    this.seed = hash(biome.id);
    const r = rng(this.seed);
    for (let i = 0; i < 4; i++) this.clouds.push({ x: r() * (w + 160) - 80, y: 10 + r() * this.horizon * 0.42, speed: 2.5 + r() * 4.5, shape: i % 3, s: 0.7 + r() * 0.55 });
    for (let i = 0; i < 48; i++) this.stars.push({ x: r() * w, y: r() * this.horizon * 0.82, r: 0.5 + r() * 1.1, ph: r() * TAU, sp: 0.8 + r() * 2.2, big: i < 5 });
    for (let i = 0; i < 9; i++) this.glows.push({ x: 20 + r() * (w - 40), y: groundTop - 34 + r() * 44, ax: 10 + r() * 24, ay: 5 + r() * 10, fx: 0.15 + r() * 0.3, fy: 0.3 + r() * 0.5, ph: r() * TAU });
    this.light = lightAt(hour, biome);
    this.refresh(hour, true);
  }

  /** Re-renders the still layers when the light has changed (about once a minute). */
  refresh(hour: number, force = false) {
    const minute = Math.floor(hour * 60);
    if (!force && minute === this.minute) return;
    this.minute = minute;
    this.light = lightAt(hour, this.biome);
    this.build();
  }

  private build() {
    const { w, h, dpr, biome: b, light: L } = this;
    this.sky = layer(w, this.groundTop + 4, dpr, (g) => {
      const gr = g.createLinearGradient(0, 0, 0, this.groundTop);
      gr.addColorStop(0, L.top);
      gr.addColorStop(1, L.bottom);
      g.fillStyle = gr;
      g.fillRect(0, 0, w, this.groundTop + 4);
    });
    this.body = this.celestial();
    this.cloudImgs = [0, 1, 2].map((k) => this.cloudSprite(k));
    this.glowImg = layer(18, 18, dpr, (g) => {
      const gr = g.createRadialGradient(9, 9, 0, 9, 9, 9);
      gr.addColorStop(0, '#ffffffff');
      gr.addColorStop(0.18, `${b.glow}ff`);
      gr.addColorStop(0.4, `${b.glow}66`);
      gr.addColorStop(1, `${b.glow}00`);
      g.fillStyle = gr;
      g.fillRect(0, 0, 18, 18);
    });
    const r = rng(this.seed ^ 0x9e3779b9);
    this.far = layer(w + PAR_FAR * 2, h, dpr, (g) => this.paintFar(g, w + PAR_FAR * 2, r));
    this.mid = layer(w + PAR_MID * 2, h, dpr, (g) => this.paintMid(g, w + PAR_MID * 2, r));
    this.ground = layer(w, h, dpr, (g) => this.paintGround(g, r));
    this.back = b.back.map((p, i) => this.plant(p, i, false));
    this.front = b.front.map((p, i) => this.plant(p, i + 10, true));
  }

  /** The ground's top edge at x. */
  groundAt(x: number): number {
    return this.groundTop + Math.sin(x * 0.021 + (this.seed % 7)) * 2.2 + Math.sin(x * 0.047 + 1.3) * 1.2;
  }

  // ---------------- still layers ----------------

  private celestial(): { img: HTMLCanvasElement; x: number; y: number; size: number } | null {
    const { w, light: L, dpr } = this;
    const hr = L.hour;
    const sun = hr >= 5.6 && hr <= 19.6;
    const t = sun ? (hr - 5.6) / 14 : ((hr - 19.6 + 24) % 24) / 10;
    if (t < 0 || t > 1) return null;
    const x = w * (0.08 + 0.84 * t);
    const top = 20;
    const y = this.horizon + 6 - Math.sin(Math.PI * t) * (this.horizon + 6 - top);
    const size = sun ? 17 : 14;
    const S = size * 5;
    const img = layer(S, S, dpr, (g) => {
      const c = S / 2;
      const glow = g.createRadialGradient(c, c, size * 0.4, c, c, S / 2);
      if (sun) {
        const core = mix('#fff4c2', '#ffb070', L.warm * 0.7);
        glow.addColorStop(0, `${mix(core, '#ffffff', 0.2)}cc`);
        glow.addColorStop(0.3, `${core}55`);
        glow.addColorStop(1, `${core}00`);
        g.fillStyle = glow;
        g.fillRect(0, 0, S, S);
        const disc = g.createRadialGradient(c - size * 0.3, c - size * 0.3, 1, c, c, size * 0.5);
        disc.addColorStop(0, '#fffdf0');
        disc.addColorStop(1, mix('#ffe07a', '#ff9a52', L.warm * 0.8));
        g.fillStyle = disc;
        g.beginPath();
        g.arc(c, c, size * 0.5, 0, TAU);
        g.fill();
      } else {
        glow.addColorStop(0, '#e9ecff55');
        glow.addColorStop(0.35, '#c9d0ff22');
        glow.addColorStop(1, '#c9d0ff00');
        g.fillStyle = glow;
        g.fillRect(0, 0, S, S);
        g.fillStyle = '#f5f2e4';
        g.beginPath();
        g.arc(c, c, size * 0.5, 0, TAU);
        g.fill();
        g.fillStyle = '#ded9c4';
        for (const [dx, dy, rr] of [
          [-0.18, -0.1, 0.13],
          [0.16, 0.12, 0.1],
          [0.02, 0.24, 0.07],
          [0.2, -0.2, 0.06],
        ])
          g.beginPath(), g.arc(c + dx * size, c + dy * size, rr * size, 0, TAU), g.fill();
      }
    });
    return { img, x, y, size: S };
  }

  private cloudSprite(k: number): HTMLCanvasElement {
    const L = this.light;
    const col = mix(lit(this.biome.cloud, L), L.bottom, 0.12);
    const shade = mix(col, L.top, 0.28);
    const shapes = [
      [
        [18, 22, 12],
        [34, 15, 15],
        [52, 20, 12],
        [64, 25, 8],
      ],
      [
        [14, 22, 9],
        [28, 16, 12],
        [44, 18, 10],
      ],
      [
        [16, 23, 10],
        [32, 14, 14],
        [50, 12, 12],
        [66, 20, 11],
        [80, 25, 7],
      ],
    ][k];
    return layer(92, 34, this.dpr, (g) => {
      g.globalAlpha = 0.92 - this.light.night * 0.45;
      const gr = g.createLinearGradient(0, 4, 0, 32);
      gr.addColorStop(0, col);
      gr.addColorStop(1, shade);
      g.fillStyle = gr;
      g.beginPath();
      for (const [x, y, r] of shapes) {
        g.moveTo(x + r, y);
        g.arc(x, y, r, 0, TAU);
      }
      g.rect(shapes[0][0], 22, shapes[shapes.length - 1][0] - shapes[0][0], 9);
      g.fill();
    });
  }

  private ridge(g: Ctx, w: number, base: number, amp: number, f: number, r: () => number) {
    const p1 = r() * TAU;
    const p2 = r() * TAU;
    const p3 = r() * TAU;
    g.beginPath();
    g.moveTo(0, this.h);
    for (let x = 0; x <= w + 4; x += 4) {
      const y = base - amp * (0.6 * Math.sin(x * f + p1) + 0.28 * Math.sin(x * f * 2.3 + p2) + 0.12 * Math.sin(x * f * 5.1 + p3));
      g.lineTo(x, y);
    }
    g.lineTo(w, this.h);
    g.closePath();
  }

  private paintFar(g: Ctx, w: number, r: () => number) {
    const { biome: b, light: L, horizon } = this;
    this.farTop = b.prop === 'sea' ? horizon - 5 : horizon - 34;
    if (b.prop === 'sea') {
      const top = horizon - 4;
      const gr = g.createLinearGradient(0, top, 0, this.groundTop + 6);
      gr.addColorStop(0, lit(lighten(b.far, 0.25), L, 0.25));
      gr.addColorStop(1, lit(darken(b.far, 0.12), L));
      g.fillStyle = gr;
      g.fillRect(0, top, w, this.h - top);
      g.fillStyle = lit(lighten(b.far, 0.55), L, 0.2);
      g.fillRect(0, top, w, 1.5);
      return;
    }
    // Distant hills, hazy with the sky colour.
    this.ridge(g, w, horizon - 18, 13, 0.011, r);
    const gr = g.createLinearGradient(0, horizon - 40, 0, this.groundTop);
    gr.addColorStop(0, lit(b.far, L, 0.38));
    gr.addColorStop(1, lit(b.far, L, 0.18));
    g.fillStyle = gr;
    g.fill();
    if (b.prop === 'volcano') {
      const cx = w * 0.68;
      const peak = Math.max(22, horizon - 70);
      this.farTop = Math.max(0, peak - 32);
      const foot = horizon + 8;
      const col = lit(mix(b.far, b.mid, 0.4), L, 0.2);
      g.fillStyle = col;
      g.beginPath();
      g.moveTo(cx - 110, foot);
      g.bezierCurveTo(cx - 60, foot - 10, cx - 34, peak + 16, cx - 16, peak);
      g.lineTo(cx - 6, peak + 4);
      g.lineTo(cx + 6, peak + 3);
      g.lineTo(cx + 16, peak);
      g.bezierCurveTo(cx + 36, peak + 18, cx + 64, foot - 12, cx + 120, foot);
      g.closePath();
      g.fill();
      // Lava: a glowing crater and two streaks, brighter at night.
      const glow = 0.55 + 0.45 * L.night;
      const lg = g.createRadialGradient(cx, peak + 2, 1, cx, peak + 2, 30);
      lg.addColorStop(0, `rgba(255,170,80,${0.85 * glow})`);
      lg.addColorStop(1, 'rgba(255,90,40,0)');
      g.fillStyle = lg;
      g.fillRect(cx - 32, peak - 28, 64, 60);
      g.strokeStyle = `rgba(255,${Math.round(120 + 40 * glow)},60,${0.75 * glow})`;
      g.lineWidth = 2.2;
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(cx - 8, peak + 5);
      g.quadraticCurveTo(cx - 14, peak + 22, cx - 24, peak + 38);
      g.moveTo(cx + 9, peak + 5);
      g.quadraticCurveTo(cx + 12, peak + 18, cx + 22, peak + 30);
      g.stroke();
      this.volcano = { x: cx - PAR_FAR, y: peak };
    } else this.volcano = null;
  }

  private paintMid(g: Ctx, w: number, r: () => number) {
    const { biome: b, light: L, horizon } = this;
    this.midTop = horizon + (b.prop === 'sea' ? 12 - 6 : 4 - 10) - 4;
    this.ridge(g, w, horizon + (b.prop === 'sea' ? 12 : 4), b.prop === 'sea' ? 6 : 10, 0.017, r);
    const gr = g.createLinearGradient(0, horizon - 20, 0, this.groundTop + 10);
    gr.addColorStop(0, lit(lighten(b.mid, 0.06), L, 0.12));
    gr.addColorStop(1, lit(darken(b.mid, 0.06), L));
    g.fillStyle = gr;
    g.fill();
    // Little distant shrubs along the ridge.
    if (b.prop !== 'sea') {
      g.fillStyle = lit(darken(b.mid, 0.16), L, 0.08);
      for (let i = 0; i < 9; i++) {
        const x = r() * w;
        const y = horizon + 10 + r() * 10;
        const s = 3 + r() * 5;
        g.beginPath();
        g.arc(x, y, s, Math.PI, 0);
        g.arc(x + s * 0.9, y + 1, s * 0.7, Math.PI, 0);
        g.closePath();
        g.fill();
      }
    }
  }

  private paintGround(g: Ctx, r: () => number) {
    const { w, h, biome: b, light: L } = this;
    g.beginPath();
    g.moveTo(0, h);
    for (let x = 0; x <= w + 4; x += 4) g.lineTo(x, this.groundAt(x));
    g.lineTo(w, h);
    g.closePath();
    const gr = g.createLinearGradient(0, this.groundTop, 0, h);
    gr.addColorStop(0, lit(b.ground, L));
    gr.addColorStop(1, lit(b.ground2, L));
    g.fillStyle = gr;
    g.fill();
    // A light lip along the top edge.
    g.strokeStyle = lit(lighten(b.ground, 0.22), L);
    g.lineWidth = 2;
    g.beginPath();
    for (let x = 0; x <= w + 4; x += 4) (x ? g.lineTo : g.moveTo).call(g, x, this.groundAt(x) + 1);
    g.stroke();
    // Texture: grass tufts, pebbles or sand specks.
    const sand = b.prop === 'sea';
    for (let i = 0; i < 46; i++) {
      const x = r() * w;
      const y = this.groundAt(x) + 5 + r() * (h - this.groundTop - 8);
      if (sand) {
        g.fillStyle = lit(darken(b.ground, 0.12 + r() * 0.1), L);
        g.beginPath();
        g.arc(x, y, 0.8 + r() * 0.8, 0, TAU);
        g.fill();
      } else {
        g.strokeStyle = lit(i % 3 ? darken(b.grass, 0.08) : lighten(b.grass, 0.12), L);
        g.lineWidth = 1.3;
        g.lineCap = 'round';
        const s = 2.5 + r() * 3.5;
        g.beginPath();
        g.moveTo(x - s * 0.6, y - s);
        g.lineTo(x, y);
        g.lineTo(x + s * 0.5, y - s * 1.1);
        g.moveTo(x, y);
        g.lineTo(x + 0.3, y - s * 1.3);
        g.stroke();
      }
    }
    if (b.prop === 'volcano') {
      const glow = 0.4 + 0.6 * L.night;
      g.strokeStyle = `rgba(255,120,50,${0.5 * glow})`;
      g.lineWidth = 1.6;
      for (let i = 0; i < 4; i++) {
        let x = 30 + r() * (w - 60);
        let y = this.groundTop + 10 + r() * (h - this.groundTop - 16);
        g.beginPath();
        g.moveTo(x, y);
        for (let k = 0; k < 4; k++) {
          x += 6 + r() * 8;
          y += (r() - 0.5) * 5;
          g.lineTo(x, y);
        }
        g.stroke();
      }
    }
  }

  // ---------------- plants ----------------

  private plant(p: PlantSpec, i: number, front: boolean): Sprite {
    const L = this.light;
    const b = this.biome;
    const s = p.s * (front ? 1 : 0.8) * Math.min(1.15, Math.max(0.8, this.h / 190));
    const box = PLANT_BOX[p.kind];
    const w = box[0] * s;
    const h = box[1] * s;
    const ax = w / 2;
    const ay = h - 4 * s;
    const haze = front ? 0 : 0.08;
    const colors: PlantColors = {
      leaf: lit(b.leaf, L, haze),
      leaf2: lit(b.leaf2, L, haze),
      trunk: lit(b.trunk, L, haze),
      rock: lit(b.rock, L, haze),
      grass: lit(b.grass, L, haze),
      flowers: b.flowers.map((f) => lit(f, L, haze)),
      glow: L.night,
      biome: b.id,
    };
    const r = rng(this.seed + i * 7919);
    const img = layer(w, h, this.dpr, (g) => {
      g.translate(ax, ay);
      if (p.flip) g.scale(-1, 1);
      g.lineCap = 'round';
      g.lineJoin = 'round';
      DRAW[p.kind](g, s, colors, r);
    });
    const x = p.x * this.w;
    const y = front ? this.h + 3 * s : this.groundAt(x) + 3;
    return { img, x, y, ax, ay, w, h, sway: SWAY[p.kind], phase: r() * TAU };
  }

  // ---------------- per frame ----------------

  /** Sky, stars, sun or moon, clouds, hills, ground and the plants behind the pet. */
  drawBack(g: Ctx, t: number, dt: number, parallax: number, calm: boolean) {
    const { w, light: L, biome: b, dpr } = this;
    // Blit only the band of each layer that has something in it.
    const band = (img: HTMLCanvasElement, x: number, lw: number, y0: number, y1: number) => {
      const a = Math.max(0, Math.floor(y0));
      const z = Math.min(this.h, Math.ceil(y1));
      if (z > a) g.drawImage(img, 0, a * dpr, img.width, (z - a) * dpr, x, a, lw, z - a);
    };
    band(this.sky, 0, w, 0, this.groundTop + 4);
    const starVis = Math.max(b.stars * (0.4 + 0.6 * L.night), clamp01((L.night - 0.3) / 0.5));
    if (starVis > 0.02) {
      for (const s of this.stars) {
        const a = starVis * (calm ? 0.8 : 0.5 + 0.5 * Math.sin(t * s.sp + s.ph));
        if (a < 0.03) continue;
        g.globalAlpha = a;
        g.fillStyle = '#fffbe8';
        if (s.big) {
          const k = s.r * 2.6;
          g.beginPath();
          g.moveTo(s.x, s.y - k);
          g.quadraticCurveTo(s.x, s.y, s.x + k, s.y);
          g.quadraticCurveTo(s.x, s.y, s.x, s.y + k);
          g.quadraticCurveTo(s.x, s.y, s.x - k, s.y);
          g.quadraticCurveTo(s.x, s.y, s.x, s.y - k);
          g.fill();
        } else {
          g.beginPath();
          g.arc(s.x, s.y, s.r, 0, TAU);
          g.fill();
        }
      }
      g.globalAlpha = 1;
    }
    if (this.body) g.drawImage(this.body.img, this.body.x - this.body.size / 2, this.body.y - this.body.size / 2, this.body.size, this.body.size);
    for (const c of this.clouds) {
      const cw = 92 * c.s;
      if (!calm) {
        c.x += c.speed * dt * 0.5;
        if (c.x > w + 20) c.x = -cw - 20;
      }
      g.drawImage(this.cloudImgs[c.shape], c.x, c.y, cw, 34 * c.s);
    }
    const fx = -PAR_FAR + parallax * PAR_FAR;
    band(this.far, fx, w + PAR_FAR * 2, this.farTop, this.groundTop + 6);
    if (b.prop === 'volcano' && this.volcano && !calm) this.smoke(g, t, fx);
    if (b.prop === 'sea' && !calm) this.glints(g, t);
    band(this.mid, -PAR_MID + parallax * PAR_MID, w + PAR_MID * 2, this.midTop, this.groundTop + 6);
    band(this.ground, 0, w, this.groundTop - 5, this.h);
    for (const s of this.back) this.sprite(g, s, t, calm);
  }

  /** Plants in front of the pet, and fireflies at night. */
  drawFront(g: Ctx, t: number, calm: boolean) {
    for (const s of this.front) this.sprite(g, s, t, calm);
    const vis = clamp01((this.light.night - 0.25) / 0.45) * (this.biome.id === 'volcano' ? 1 : 0.95);
    if (vis > 0.02) {
      const embers = this.biome.prop === 'volcano';
      for (const f of this.glows) {
        let x: number;
        let y: number;
        if (embers) {
          const k = (t * 0.08 * (0.6 + f.fy) + f.ph / TAU) % 1;
          x = f.x + Math.sin(t * f.fx * 3 + f.ph) * 8;
          y = this.groundTop + 10 - k * (this.groundTop - 10);
          g.globalAlpha = vis * (1 - k) * 0.9;
        } else {
          x = f.x + (calm ? 0 : Math.sin(t * f.fx + f.ph) * f.ax);
          y = f.y + (calm ? 0 : Math.sin(t * f.fy + f.ph * 1.7) * f.ay);
          g.globalAlpha = vis * (calm ? 0.7 : 0.35 + 0.65 * Math.max(0, Math.sin(t * 1.6 + f.ph)));
        }
        g.drawImage(this.glowImg, x - 9, y - 9, 18, 18);
      }
      g.globalAlpha = 1;
    }
  }

  private sprite(g: Ctx, s: Sprite, t: number, calm: boolean) {
    const k = calm || !s.sway ? 0 : Math.sin(t * 1.25 + s.phase) * s.sway + Math.sin(t * 2.9 + s.phase * 2) * s.sway * 0.3;
    g.save();
    g.translate(s.x, s.y);
    if (k) g.transform(1, 0, k, 1, 0, 0);
    g.drawImage(s.img, -s.ax, -s.ay, s.w, s.h);
    g.restore();
  }

  private smoke(g: Ctx, t: number, fx: number) {
    const v = this.volcano!;
    const col = lit('#8a7474', this.light, 0.1);
    for (let i = 0; i < 5; i++) {
      const k = (t * 0.07 + i / 5) % 1;
      const x = v.x + fx + PAR_FAR + k * 26 + Math.sin(t * 0.6 + i) * 3;
      const y = v.y - 2 - k * 46;
      g.globalAlpha = (1 - k) * 0.42 * Math.min(1, k * 6);
      g.fillStyle = col;
      g.beginPath();
      g.arc(x, y, 4 + k * 12, 0, TAU);
      g.fill();
    }
    g.globalAlpha = 1;
  }

  private glints(g: Ctx, t: number) {
    const top = this.horizon - 2;
    g.strokeStyle = '#ffffff';
    g.lineWidth = 1.2;
    for (let i = 0; i < 9; i++) {
      const x = ((i * 53.7 + this.seed) % this.w) + Math.sin(t * 0.3 + i) * 6;
      const y = top + 5 + ((i * 7.3) % Math.max(4, this.groundTop - top - 6));
      const a = Math.max(0, Math.sin(t * 1.3 + i * 1.9)) * (0.25 + 0.5 * this.light.day);
      if (a < 0.05) continue;
      g.globalAlpha = a;
      g.beginPath();
      g.moveTo(x - 4, y);
      g.lineTo(x + 4, y);
      g.stroke();
    }
    g.globalAlpha = 1;
  }
}

// ---------------- plant drawings (root at 0,0, growing up = negative y) ----------------

interface PlantColors {
  leaf: string;
  leaf2: string;
  trunk: string;
  rock: string;
  grass: string;
  flowers: string[];
  /** 0..1 how dark it is (glowing things glow more). */
  glow: number;
  biome: string;
}

const PLANT_BOX: Record<PlantKind, [number, number]> = {
  fern: [96, 64],
  palm: [110, 118],
  cycad: [84, 66],
  bush: [70, 42],
  flowers: [46, 34],
  rock: [52, 30],
  acacia: [120, 92],
  tuft: [44, 34],
  crystal: [46, 56],
  mushroom: [40, 40],
  lolly: [64, 96],
  starfish: [30, 16],
  shell: [26, 16],
};

const SWAY: Record<PlantKind, number> = {
  fern: 0.06,
  palm: 0.035,
  cycad: 0.03,
  bush: 0.02,
  flowers: 0.09,
  rock: 0,
  acacia: 0.015,
  tuft: 0.1,
  crystal: 0,
  mushroom: 0.012,
  lolly: 0.02,
  starfish: 0,
  shell: 0,
};

function frond(g: Ctx, x: number, y: number, ang: number, len: number, droop: number, c1: string, c2: string, leaflet: number) {
  const pts: [number, number, number][] = [];
  let px = x;
  let py = y;
  const n = 9;
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    const a = ang + droop * u * u;
    pts.push([px, py, a]);
    px += Math.cos(a) * (len / n);
    py += Math.sin(a) * (len / n);
  }
  g.strokeStyle = c2;
  g.lineWidth = Math.max(1, leaflet * 0.35);
  g.beginPath();
  g.moveTo(x, y);
  for (const [qx, qy] of pts) g.lineTo(qx, qy);
  g.stroke();
  for (let i = 1; i < pts.length; i++) {
    const [qx, qy, a] = pts[i];
    const u = i / n;
    const s = leaflet * (1 - u * 0.75);
    for (const side of [-1, 1]) {
      g.fillStyle = side < 0 ? c1 : c2;
      g.beginPath();
      g.ellipse(qx + Math.cos(a + side * 1.2) * s * 0.9, qy + Math.sin(a + side * 1.2) * s * 0.9, s * 1.05, s * 0.42, a + side * 0.9, 0, TAU);
      g.fill();
    }
  }
}

const DRAW: Record<PlantKind, (g: Ctx, s: number, c: PlantColors, r: () => number) => void> = {
  fern(g, s, c) {
    const n = 7;
    for (let i = 0; i < n; i++) {
      const u = i / (n - 1);
      const a = -Math.PI + 0.35 + u * (Math.PI - 0.7);
      const len = (30 + 12 * Math.sin(u * Math.PI)) * s;
      frond(g, 0, 0, a, len, (a < -Math.PI / 2 ? -1 : 1) * 0.7, i % 2 ? c.leaf : c.leaf2, i % 2 ? c.leaf2 : c.leaf, 3.4 * s);
    }
  },
  palm(g, s, c) {
    const H = 78 * s;
    g.strokeStyle = c.trunk;
    g.lineWidth = 7 * s;
    g.beginPath();
    g.moveTo(0, 0);
    g.quadraticCurveTo(6 * s, -H * 0.5, 2 * s, -H);
    g.stroke();
    g.strokeStyle = darken(c.trunk, 0.2);
    g.lineWidth = 1.3 * s;
    for (let i = 1; i < 8; i++) {
      const y = -H * (i / 8);
      const x = Math.sin((i / 8) * Math.PI) * 3 * s + 2 * s * (i / 8);
      g.beginPath();
      g.moveTo(x - 3.2 * s, y + 1.5 * s);
      g.lineTo(x + 3.2 * s, y - 0.5 * s);
      g.stroke();
    }
    for (let i = 0; i < 7; i++) {
      const u = i / 6;
      const a = -Math.PI + 0.1 + u * (Math.PI - 0.2);
      frond(g, 2 * s, -H, a, (34 + 8 * Math.sin(u * Math.PI)) * s, (a < -Math.PI / 2 ? -1 : 1) * 1.1, i % 2 ? c.leaf : c.leaf2, i % 2 ? c.leaf2 : c.leaf, 3 * s);
    }
    if (c.biome === 'ocean') {
      g.fillStyle = darken(c.trunk, 0.35);
      for (const dx of [-3, 3, 0]) g.beginPath(), g.arc(2 * s + dx * s, -H + 4 * s + (dx ? 0 : 2 * s), 2.6 * s, 0, TAU), g.fill();
    }
  },
  cycad(g, s, c) {
    const H = 22 * s;
    g.fillStyle = c.trunk;
    g.beginPath();
    g.moveTo(-7 * s, 0);
    g.quadraticCurveTo(-8 * s, -H * 0.6, -4.5 * s, -H);
    g.lineTo(4.5 * s, -H);
    g.quadraticCurveTo(8 * s, -H * 0.6, 7 * s, 0);
    g.closePath();
    g.fill();
    g.strokeStyle = darken(c.trunk, 0.25);
    g.lineWidth = 1 * s;
    for (let i = 1; i < 5; i++) {
      const y = -H * (i / 5);
      g.beginPath();
      g.moveTo(-6 * s, y + 2 * s);
      g.lineTo(0, y - 1.5 * s);
      g.lineTo(6 * s, y + 2 * s);
      g.stroke();
    }
    for (let i = 0; i < 8; i++) {
      const u = i / 7;
      const a = -Math.PI + 0.25 + u * (Math.PI - 0.5);
      frond(g, 0, -H, a, (26 + 6 * Math.sin(u * Math.PI)) * s, (a < -Math.PI / 2 ? -1 : 1) * 0.35, i % 2 ? c.leaf : c.leaf2, i % 2 ? c.leaf2 : c.leaf, 2.6 * s);
    }
  },
  bush(g, s, c) {
    const blobs: [number, number, number][] = [
      [-18, -10, 11],
      [-4, -16, 14],
      [12, -11, 12],
      [22, -6, 8],
      [-26, -5, 7],
    ];
    g.fillStyle = c.leaf2;
    for (const [x, y, r] of blobs) g.beginPath(), g.arc(x * s, y * s, r * s, 0, TAU), g.fill();
    g.fillStyle = c.leaf;
    for (const [x, y, r] of blobs) g.beginPath(), g.arc(x * s - r * s * 0.18, y * s - r * s * 0.2, r * s * 0.78, 0, TAU), g.fill();
    g.fillStyle = lighten(c.leaf, 0.14);
    for (const [x, y, r] of blobs.slice(0, 3)) g.beginPath(), g.arc(x * s - r * s * 0.35, y * s - r * s * 0.4, r * s * 0.3, 0, TAU), g.fill();
    if (c.biome === 'meadow') {
      for (let i = 0; i < 5; i++) {
        g.fillStyle = c.flowers[i % c.flowers.length];
        g.beginPath();
        g.arc((-20 + i * 10) * s, (-12 - (i % 2) * 8) * s, 1.8 * s, 0, TAU);
        g.fill();
      }
    }
  },
  flowers(g, s, c, r) {
    for (let i = 0; i < 6; i++) {
      const x = (-14 + i * 5.6 + (r() - 0.5) * 3) * s;
      const h = (12 + r() * 14) * s;
      g.strokeStyle = c.leaf2;
      g.lineWidth = 1.4 * s;
      g.beginPath();
      g.moveTo(x, 0);
      g.quadraticCurveTo(x + 2 * s, -h * 0.5, x + (r() - 0.5) * 4 * s, -h);
      g.stroke();
      const fx = x + (r() - 0.5) * 4 * s;
      g.fillStyle = c.leaf;
      g.beginPath();
      g.ellipse(x + 2.5 * s, -h * 0.45, 3 * s, 1.3 * s, -0.5, 0, TAU);
      g.fill();
      const col = c.flowers[i % c.flowers.length];
      g.fillStyle = col;
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * TAU;
        g.beginPath();
        g.arc(fx + Math.cos(a) * 2.2 * s, -h + Math.sin(a) * 2.2 * s, 1.9 * s, 0, TAU);
        g.fill();
      }
      g.fillStyle = '#ffe27a';
      g.beginPath();
      g.arc(fx, -h, 1.4 * s, 0, TAU);
      g.fill();
    }
  },
  rock(g, s, c) {
    g.fillStyle = darken(c.rock, 0.18);
    g.beginPath();
    g.moveTo(-22 * s, 0);
    g.bezierCurveTo(-24 * s, -12 * s, -12 * s, -22 * s, 2 * s, -21 * s);
    g.bezierCurveTo(16 * s, -20 * s, 24 * s, -10 * s, 22 * s, 0);
    g.closePath();
    g.fill();
    g.fillStyle = c.rock;
    g.beginPath();
    g.moveTo(-19 * s, -3 * s);
    g.bezierCurveTo(-20 * s, -13 * s, -10 * s, -20 * s, 1 * s, -19 * s);
    g.bezierCurveTo(12 * s, -18 * s, 18 * s, -11 * s, 17 * s, -4 * s);
    g.quadraticCurveTo(0, -8 * s, -19 * s, -3 * s);
    g.fill();
    g.fillStyle = lighten(c.rock, 0.25);
    g.beginPath();
    g.ellipse(-6 * s, -15 * s, 6 * s, 2.4 * s, -0.25, 0, TAU);
    g.fill();
    if (c.biome === 'meadow' || c.biome === 'jungle') {
      g.fillStyle = c.leaf;
      g.beginPath();
      g.ellipse(6 * s, -19.5 * s, 7 * s, 2.4 * s, 0.1, Math.PI, 0);
      g.fill();
    }
  },
  acacia(g, s, c) {
    g.strokeStyle = c.trunk;
    g.lineWidth = 5 * s;
    g.beginPath();
    g.moveTo(0, 0);
    g.quadraticCurveTo(2 * s, -30 * s, -8 * s, -58 * s);
    g.moveTo(1 * s, -26 * s);
    g.quadraticCurveTo(10 * s, -40 * s, 18 * s, -56 * s);
    g.stroke();
    const crown: [number, number, number, number][] = [
      [-22, -62, 26, 8],
      [10, -64, 30, 9],
      [-4, -70, 26, 8],
    ];
    g.fillStyle = c.leaf2;
    for (const [x, y, rx, ry] of crown) g.beginPath(), g.ellipse(x * s, y * s + 3 * s, rx * s, ry * s, 0, 0, TAU), g.fill();
    g.fillStyle = c.leaf;
    for (const [x, y, rx, ry] of crown) g.beginPath(), g.ellipse(x * s, y * s, rx * s * 0.92, ry * s * 0.8, 0, 0, TAU), g.fill();
  },
  tuft(g, s, c, r) {
    for (let i = 0; i < 9; i++) {
      const x = (i - 4) * 2.4 * s;
      const h = (16 + r() * 14) * s;
      const lean = (i - 4) * 1.8 * s + (r() - 0.5) * 4 * s;
      g.strokeStyle = i % 2 ? c.grass : lighten(c.grass, 0.12);
      g.lineWidth = 2 * s;
      g.beginPath();
      g.moveTo(x, 0);
      g.quadraticCurveTo(x + lean * 0.3, -h * 0.6, x + lean, -h);
      g.stroke();
    }
  },
  crystal(g, s, c) {
    const glow = 0.35 + 0.65 * c.glow;
    const gr = g.createRadialGradient(0, -18 * s, 2, 0, -18 * s, 26 * s);
    gr.addColorStop(0, `rgba(170,230,255,${0.45 * glow})`);
    gr.addColorStop(1, 'rgba(170,230,255,0)');
    g.fillStyle = gr;
    g.fillRect(-24 * s, -46 * s, 48 * s, 50 * s);
    const shards: [number, number, number, number][] = [
      [-8, 34, 6, -0.25],
      [3, 46, 7.5, 0.05],
      [12, 26, 5, 0.35],
    ];
    for (const [x, h, w, a] of shards) {
      g.save();
      g.translate(x * s, 0);
      g.rotate(a);
      g.fillStyle = mix('#8fe3ff', c.leaf, 0.35);
      g.beginPath();
      g.moveTo(-w * s, 0);
      g.lineTo(-w * s, -h * s * 0.75);
      g.lineTo(0, -h * s);
      g.lineTo(w * s, -h * s * 0.75);
      g.lineTo(w * s, 0);
      g.closePath();
      g.fill();
      g.fillStyle = 'rgba(255,255,255,0.45)';
      g.beginPath();
      g.moveTo(-w * s * 0.9, -2 * s);
      g.lineTo(-w * s * 0.9, -h * s * 0.72);
      g.lineTo(0, -h * s * 0.95);
      g.lineTo(-w * s * 0.1, -2 * s);
      g.closePath();
      g.fill();
      g.restore();
    }
  },
  mushroom(g, s, c) {
    const candy = c.biome === 'candy';
    const cap = candy ? '#ff6fa8' : mix('#7de3ff', c.leaf, 0.3);
    if (!candy) {
      const glow = 0.3 + 0.7 * c.glow;
      const gr = g.createRadialGradient(0, -20 * s, 1, 0, -20 * s, 20 * s);
      gr.addColorStop(0, `rgba(140,235,255,${0.5 * glow})`);
      gr.addColorStop(1, 'rgba(140,235,255,0)');
      g.fillStyle = gr;
      g.fillRect(-20 * s, -40 * s, 40 * s, 40 * s);
    }
    g.fillStyle = '#f6ecdc';
    g.beginPath();
    g.moveTo(-4 * s, 0);
    g.quadraticCurveTo(-5 * s, -10 * s, -3 * s, -17 * s);
    g.lineTo(3 * s, -17 * s);
    g.quadraticCurveTo(5 * s, -10 * s, 4 * s, 0);
    g.closePath();
    g.fill();
    g.fillStyle = cap;
    g.beginPath();
    g.moveTo(-15 * s, -15 * s);
    g.bezierCurveTo(-15 * s, -32 * s, 15 * s, -32 * s, 15 * s, -15 * s);
    g.quadraticCurveTo(0, -12 * s, -15 * s, -15 * s);
    g.fill();
    g.fillStyle = 'rgba(255,255,255,0.85)';
    for (const [x, y, r] of [
      [-7, -22, 2.4],
      [4, -26, 2],
      [9, -19, 1.6],
      [-1, -19, 1.3],
    ])
      g.beginPath(), g.arc(x * s, y * s, r * s, 0, TAU), g.fill();
  },
  lolly(g, s, c) {
    g.strokeStyle = c.trunk;
    g.lineWidth = 4 * s;
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(0, -58 * s);
    g.stroke();
    const R = 22 * s;
    const cy = -64 * s;
    g.fillStyle = c.leaf;
    g.beginPath();
    g.arc(0, cy, R, 0, TAU);
    g.fill();
    g.strokeStyle = '#ffffff';
    g.lineWidth = 4 * s;
    g.beginPath();
    for (let a = 0; a < TAU * 2.2; a += 0.2) {
      const rr = (a / (TAU * 2.2)) * R * 0.85;
      const x = Math.cos(a) * rr;
      const y = cy + Math.sin(a) * rr;
      if (a === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.35)';
    g.beginPath();
    g.ellipse(-R * 0.4, cy - R * 0.45, R * 0.28, R * 0.14, -0.6, 0, TAU);
    g.fill();
  },
  starfish(g, s) {
    g.fillStyle = '#ff8f6b';
    g.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i / 10) * TAU;
      const rr = (i % 2 ? 3.2 : 8.5) * s;
      const x = Math.cos(a) * rr;
      const y = -6 * s + Math.sin(a) * rr * 0.62;
      if (i) g.lineTo(x, y);
      else g.moveTo(x, y);
    }
    g.closePath();
    g.fill();
    g.fillStyle = '#ffd2b8';
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI / 2 + (i / 5) * TAU;
      g.beginPath();
      g.arc(Math.cos(a) * 4 * s, -6 * s + Math.sin(a) * 2.5 * s, 0.9 * s, 0, TAU);
      g.fill();
    }
  },
  shell(g, s) {
    g.fillStyle = '#ffd7c9';
    g.beginPath();
    g.moveTo(0, -1 * s);
    g.arc(0, -1 * s, 9 * s, Math.PI, 0);
    g.closePath();
    g.fill();
    g.strokeStyle = '#e9a58f';
    g.lineWidth = 1 * s;
    for (let i = 1; i < 6; i++) {
      const a = Math.PI + (i / 6) * Math.PI;
      g.beginPath();
      g.moveTo(0, -1 * s);
      g.lineTo(Math.cos(a) * 8.5 * s, -1 * s + Math.sin(a) * 8.5 * s);
      g.stroke();
    }
  },
};
