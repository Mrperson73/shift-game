// Recognises games you're playing from process names (and window titles for Java Minecraft).
// Nothing is read from inside the games; only the list of running programs.

export interface GameRule {
  name: string;
  exe: RegExp;
  /** For shared runtimes like java: a window title must match too. */
  title?: RegExp;
}

export const GAMES: GameRule[] = [
  { name: 'The Isle', exe: /^theisle(client)?-win64-shipping\.exe$/i },
  { name: 'Brawlhalla', exe: /^brawlhalla\.exe$/i },
  { name: 'Minecraft', exe: /^minecraft\.windows\.exe$/i },
  { name: 'Minecraft', exe: /^javaw?\.exe$/i, title: /^minecraft\*?\s*\d/i },
];

/** Process ids of running games, so the pet can keep off their windows. */
export function gamePids(procs: Map<number, string>, titles: { pid: number; title: string }[]): Set<number> {
  const out = new Set<number>();
  for (const [pid, exe] of procs) {
    for (const g of GAMES) {
      if (!g.exe.test(exe)) continue;
      if (!g.title || titles.some((t) => t.pid === pid && g.title!.test(t.title))) out.add(pid);
    }
  }
  return out;
}

/**
 * @param exes lower-case exe names of running processes
 * @param titles window titles with the exe name of their process
 */
export function detectGame(exes: Set<string>, titles: { exe: string; title: string }[]): string | null {
  for (const g of GAMES) {
    if (g.title) {
      if (titles.some((t) => g.exe.test(t.exe) && g.title!.test(t.title))) return g.name;
    } else if ([...exes].some((e) => g.exe.test(e))) return g.name;
  }
  return null;
}
