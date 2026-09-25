import type { KnobValue, Site, SitePath } from '../core/types';

export interface Registry {
  K: KnobValue[];
  /** Register an object literal (site) so its knob-backed properties update live. */
  KO: <T>(obj: T, site: number) => T;
  /** Register `obj[prop]` (constructor / class field) and return the knob's current value. */
  KP: (obj: unknown, prop: string, id: number) => KnobValue;
  set: (id: number, v: KnobValue) => void;
}

const MAX_REFS = 256;
type Obj = Record<string | number, unknown>;

const isObj = (o: unknown): o is object => (typeof o === 'object' && o !== null) || typeof o === 'function';

function setPath(o: unknown, path: SitePath, v: KnobValue) {
  try {
    let cur = o as Obj;
    for (let i = 0; i < path.length - 1; i++) {
      cur = cur[path[i]] as Obj;
      if (!isObj(cur)) return;
    }
    cur[path[path.length - 1]] = v;
  } catch {
    /* frozen or setter threw: ignore */
  }
}

export function createRegistry(values: KnobValue[], sites: Site[]): Registry {
  const K = values.slice();
  const regs = new Map<number, [WeakRef<object>, SitePath][]>();
  const add = (id: number, obj: object, path: SitePath) => {
    let list = regs.get(id);
    if (!list) regs.set(id, (list = []));
    if (list.length >= MAX_REFS) list.splice(0, MAX_REFS / 4);
    list.push([new WeakRef(obj), path]);
  };
  return {
    K,
    KO(obj, site) {
      if (isObj(obj)) for (const [id, path] of sites[site] ?? []) add(id, obj, path);
      return obj;
    },
    KP(obj, prop, id) {
      if (isObj(obj)) add(id, obj, [prop]);
      return K[id];
    },
    set(id, v) {
      K[id] = v;
      const list = regs.get(id);
      if (!list) return;
      for (let i = list.length - 1; i >= 0; i--) {
        const o = list[i][0].deref();
        if (!o) list.splice(i, 1);
        else setPath(o, list[i][1], v);
      }
    },
  };
}
