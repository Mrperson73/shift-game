const RATIO = /(alpha|opacity|friction|damp|drag|chance|prob|ratio|bounce|restitution|lerp|smooth|decay|volume|percent|easing|ease)/i;
const COUNTISH = /(count|num|max|min|lives|level|size|cols|rows|len|length|index|idx|amount|limit|total|width|height|^w$|^h$)/i;

const pow10 = (x: number) => 10 ** Math.floor(Math.log10(x));

export function niceCeil(x: number): number {
  if (x <= 0) return 1;
  const p = pow10(x);
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= x - 1e-12) return m * p;
  return 10 * p;
}

export function decimalsOf(step: number): number {
  if (step >= 1) return 0;
  return Math.min(6, Math.ceil(-Math.log10(step) - 1e-9));
}

/** Pick a sensible slider range for a literal the user has never tuned before. */
export function inferRange(v: number, name = '', unit = ''): { min: number; max: number; step: number } {
  const int = Number.isInteger(v);
  if (unit === '%' && v >= 0 && v <= 100) return { min: 0, max: 100, step: int ? 1 : 0.1 };
  if (v >= 0 && v <= 1 && !int && RATIO.test(name)) return { min: 0, max: 1, step: 0.01 };
  if (v === 0) return RATIO.test(name) ? { min: 0, max: 1, step: 0.01 } : { min: -10, max: 10, step: 0.1 };
  const a = Math.abs(v);
  const hi = niceCeil(a * (a >= 100 ? 3 : 4));
  const min = v > 0 ? 0 : -hi;
  const max = v > 0 ? hi : 0;
  let step = pow10((max - min) / 200);
  if (int) step = Math.max(step, COUNTISH.test(name) || unit === 'px' || unit === 'ms' ? 1 : 0.1);
  return { min, max, step };
}

/** Round a slider value to its step without float noise. */
export function snap(v: number, step: number): number {
  const d = decimalsOf(step);
  return Number((Math.round(v / step) * step).toFixed(d));
}

export function fmtNum(v: number): string {
  if (Object.is(v, -0)) v = 0;
  if (Number.isInteger(v)) return String(v);
  return String(parseFloat(v.toPrecision(10)));
}
