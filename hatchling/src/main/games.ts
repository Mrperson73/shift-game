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
