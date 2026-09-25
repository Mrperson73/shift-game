// Recognises videos you're watching from window titles: a video site in a browser tab (YouTube,
// Twitch, Netflix...) or a video player app (VLC, mpv, Media Player...). MediaWatcher polls the window
// in front and the running programs, cheaply and with caches, to tell the pet which game you're
// playing and which video you're watching. Titles stay in memory: they're never logged or saved.

import type { Desktop, DesktopWindow, FrontWindow } from './desktop';
import { classifyGame, fileName, gameName, isJava, knownGame, minecraftTitle, neverGame } from './games';

/** Something you're watching: the site or app, and what's playing ('' when it doesn't say). */
export interface Video {
  site: string;
  title: string;
}

/** Longest title passed on, in characters. */
const MAX_TITLE = 80;

// ---------------- browsers ----------------

/** Browsers, and what they add to the end of the tab's title in their window title. */
const BROWSERS = new Map<string, RegExp>([
  ['chrome.exe', / - Google Chrome$/],
  ['msedge.exe', / - Microsoft​? Edge(?: Beta| Dev| Canary)?$/],
  ['firefox.exe', / [—–-] (?:Mozilla Firefox|Firefox Developer Edition|Firefox Nightly)(?: Private Browsing)?$/],
  ['opera.exe', / - Opera(?: GX)?$/],
  ['brave.exe', / - Brave$/],
  ['vivaldi.exe', / - Vivaldi$/],
  ['arc.exe', / - Arc$/],
  ['chromium.exe', / - Chromium$/],
  ['thorium.exe', / - Thorium$/],
  ['librewolf.exe', / [—–-] LibreWolf$/],
  ['waterfox.exe', / [—–-] Waterfox$/],
  ['floorp.exe', / [—–-] (?:Ablaze )?Floorp$/],
  ['zen.exe', / [—–-] Zen(?: Browser)?$/],
  ['iexplore.exe', / - Internet Explorer$/],
]);
/** Edge adds how many other tabs are open: "Video - YouTube and 3 more pages - Personal". */
const MORE_PAGES = / and \d+ more pages?$/;

/** Pages of streaming sites that are for finding something, not watching it. */
const HOME = /^(home|browse|search|my list|watchlist|account|profiles?|settings|movies|series|tv shows|shows|originals|categories|library|store|live tv|new & popular|kids|help|log ?in|sign ?in|sign ?up|welcome)$/i;
/** YouTube's own pages ("Subscriptions - YouTube"). Its home page is just "YouTube". */
const YT_PAGES = /^(youtube|home|subscriptions|history|watch later|liked videos|library|you|your videos|your clips|playlists|trending|explore|shorts|downloads|settings|search|channels|notifications|premium|music|gaming|news|sports|live|courses|podcasts|playables|help)$/i;
const TWITCH_PAGES = /^(twitch|browse|following|directory|search|settings|drops|inventory|subscriptions|wallet|messages|home|discover|esports|categories|videos|dashboard|creator dashboard|prime gaming|turbo)$/i;

interface Site {
  site: string;
  /** Matches a tab title; group 1 is what's playing. */
  re: RegExp;
  /** Pages that aren't a video. */
  skip?: RegExp;
  /** Pages that are videos but don't say which (a feed). */
  feed?: RegExp;
}

/** Video sites by their tab titles. YouTube Music isn't here: that's music. */
const SITES: Site[] = [
  { site: 'YouTube', re: /^(.+) - YouTube$/, skip: YT_PAGES },
  { site: 'YouTube Kids', re: /^(.+) - YouTube Kids$/, skip: HOME },
  { site: 'YouTube TV', re: /^(.+) - YouTube TV$/, skip: HOME },
  { site: 'Twitch', re: /^(.+?)(?: - Twitch| \| Twitch| on Twitch)$/, skip: TWITCH_PAGES },
  { site: 'Kick', re: /^(.+?)(?: Stream)?(?: - Watch Live on Kick| \| Kick| - Kick)$/i, skip: HOME },
  { site: 'Netflix', re: /^(?:Watch )?(.+?) [|-] Netflix$/, skip: HOME },
  { site: 'Disney+', re: /^(?:Watch )?(.+?) [|-] Disney\+$/, skip: HOME },
  { site: 'Prime Video', re: /^Prime Video: (.+)$/, skip: HOME },
  { site: 'Prime Video', re: /^(?:Amazon\.com: )?(?:Watch )?(.+?) [|-] Prime Video$/, skip: HOME },
  { site: 'Hulu', re: /^(?:Watch )?(.+?)(?: Streaming Online)? [|-] Hulu$/, skip: HOME },
  { site: 'Max', re: /^(?:Watch )?(.+?) [|•] (?:HBO )?Max$/, skip: HOME },
  { site: 'Crunchyroll', re: /^(?:Watch )?(.+?) - (?:Watch on )?Crunchyroll$/, skip: HOME },
  { site: 'Paramount+', re: /^(?:Watch )?(.+?) [|-] Paramount(?:\+| Plus)$/, skip: HOME },
  { site: 'Peacock', re: /^(?:Watch )?(.+?)(?: Streaming Online)? [|-] Peacock$/, skip: HOME },
  { site: 'Apple TV', re: /^(.+?) [|-] Apple TV\+?$/, skip: HOME },
  { site: 'Vimeo', re: /^(.+) on Vimeo$/ },
  { site: 'TikTok', re: /^(.+) \| TikTok$/, skip: HOME, feed: /^(for you|following|explore|friends|live)$/i },
  { site: 'Dailymotion', re: /^(.+?) - (?:video )?Dailymotion$/i },
  { site: 'Bilibili', re: /^(.+?)_哔哩哔哩_bilibili$/ },
  { site: 'Plex', re: /^(.+?) [|-] Plex$/, skip: HOME },
  { site: 'Jellyfin', re: /^(.+?) [|-] Jellyfin$/, skip: HOME },
  { site: 'Tubi', re: /^(?:Watch )?(.+?)(?: - Free .+)? [|-] Tubi$/, skip: HOME },
  { site: 'Pluto TV', re: /^(?:Watch )?(.+?) [|-] Pluto TV$/, skip: HOME },
  { site: 'BBC iPlayer', re: /^BBC iPlayer - (.+)$/, skip: HOME },
  { site: 'Nebula', re: /^(.+?) \| Nebula$/, skip: HOME },
];
/** Tabs that only name the site while you watch (Netflix never says what's on), and picture-in-picture windows. */
const BARE = new Map([
  ['Netflix', 'Netflix'],
  ['Disney+', 'Disney+'],
  ['Prime Video', 'Prime Video'],
  ['Hulu', 'Hulu'],
  ['Max', 'Max'],
  ['HBO Max', 'Max'],
  ['Crunchyroll', 'Crunchyroll'],
  ['Paramount+', 'Paramount+'],
  ['Peacock', 'Peacock'],
  ['Apple TV', 'Apple TV'],
  ['Apple TV+', 'Apple TV'],
  ['Plex', 'Plex'],
  ['Jellyfin', 'Jellyfin'],
  ['Emby', 'Emby'],
  ['YouTube TV', 'YouTube TV'],
  ['Pluto TV', 'Pluto TV'],
  ['Tubi', 'Tubi'],
  ['TikTok - Make Your Day', 'TikTok'],
  ['Picture in picture', 'Video'],
  ['Picture-in-Picture', 'Video'],
]);

function videoOnPage(raw: string): Video | null {
  const page = raw.replace(MORE_PAGES, '').replace(/^\s*\(\d+\+?\)\s*/, '').trim();
  const bare = BARE.get(page);
  if (bare) return { site: bare, title: '' };
  for (const s of SITES) {
    const m = s.re.exec(page);
    if (!m) continue;
    const title = cleanTitle(m[1]);
    if (!title || s.skip?.test(title)) return null;
    return { site: s.site, title: s.feed?.test(title) ? '' : title };
  }
  return null;
}

/** The video in a browser tab, from the tab's title (the window title minus the browser's name). */
function videoInTab(page: string, edge: boolean): Video | null {
  const v = videoOnPage(page);
  if (v || !edge) return v;
  // Edge can add the profile's name: "Video - YouTube - Personal".
  const i = page.lastIndexOf(' - ');
  return i > 0 ? videoOnPage(page.slice(0, i)) : null;
}

// ---------------- players and apps ----------------

interface Player {
  name: string;
  /** What it adds after the file or show that's playing. */
  suffix?: RegExp;
  /** Its title with nothing open. */
  idle?: RegExp;
  /** Its title doesn't always say what's playing (a title without the suffix still counts). */
  bare?: boolean;
}

const PLAYER_LIST: [Player, ...string[]][] = [
  [{ name: 'VLC', suffix: / - VLC media player$/, idle: /^VLC media player$/ }, 'vlc.exe'],
  [{ name: 'mpv', suffix: / - mpv$/, idle: /^(No file - )?mpv$/ }, 'mpv.exe'],
  [{ name: 'mpv.net', suffix: / - mpv\.net\b.*$/, idle: /^mpv\.net\b/ }, 'mpvnet.exe'],
  [{ name: 'MPC-HC', suffix: / - MPC-HC\b.*$/, idle: /^(Media Player Classic Home Cinema|MPC-HC)\b/ }, 'mpc-hc64.exe', 'mpc-hc.exe'],
  [{ name: 'MPC-BE', suffix: / - MPC-BE\b.*$/, idle: /^MPC-BE\b/ }, 'mpc-be64.exe', 'mpc-be.exe'],
  [{ name: 'MPC-QT', suffix: / - Media Player Classic Qute Theater$/, idle: /^Media Player Classic Qute Theater$/ }, 'mpc-qt.exe'],
  [{ name: 'PotPlayer', suffix: / - PotPlayer$/, idle: /^PotPlayer$/ }, 'potplayermini64.exe', 'potplayermini.exe', 'potplayer64.exe', 'potplayer.exe'],
  [{ name: 'KMPlayer', suffix: / - (The )?KMPlayer\b.*$/, idle: /^(The )?KMPlayer\b/ }, 'kmplayer.exe', 'kmplayer64x.exe'],
  [{ name: 'GOM Player', suffix: / - GOM Player\b.*$/, idle: /^GOM Player\b/ }, 'gom.exe'],
  [{ name: 'SMPlayer', suffix: / - SMPlayer$/, idle: /^SMPlayer$/ }, 'smplayer.exe'],
  [{ name: 'Windows Media Player', bare: true }, 'wmplayer.exe'],
  [{ name: 'Media Player', suffix: / - Media Player$/, bare: true }, 'microsoft.media.player.exe'],
  [{ name: 'Movies & TV', suffix: / - (Movies|Films) & TV$/, bare: true }, 'video.ui.exe'],
  [{ name: 'Plex', bare: true }, 'plex.exe', 'plex htpc.exe'],
  [{ name: 'Stremio', bare: true }, 'stremio.exe', 'stremio-shell-ng.exe'],
  [{ name: 'Kodi', bare: true }, 'kodi.exe'],
  [{ name: 'Jellyfin', bare: true }, 'jellyfinmediaplayer.exe', 'jellyfin media player.exe'],
  [{ name: 'Apple TV', bare: true }, 'appletv.exe'],
];
const PLAYERS = new Map(PLAYER_LIST.flatMap(([p, ...exes]) => exes.map((e) => [e, p] as const)));
/** Music players: never a video (and never a game). */
const MUSIC = new Set(['spotify.exe', 'itunes.exe', 'applemusic.exe', 'foobar2000.exe', 'musicbee.exe', 'aimp.exe', 'winamp.exe', 'music.ui.exe', 'tidal.exe', 'deezer.exe', 'amazon music.exe', 'plexamp.exe', 'ytmdesktop.exe', 'youtube music.exe']);
/** Hosts of older Store apps: when the app itself can't be seen, its window title names it. */
const STORE_HOSTS = new Set(['applicationframehost.exe', 'wwahost.exe']);
const STORE_APPS = new Map([
  ['Netflix', 'Netflix'],
  ['Disney+', 'Disney+'],
  ['Prime Video', 'Prime Video'],
  ['Amazon Prime Video', 'Prime Video'],
  ['Hulu', 'Hulu'],
  ['Apple TV', 'Apple TV'],
  ['Crunchyroll', 'Crunchyroll'],
  ['Movies & TV', 'Movies & TV'],
  ['Films & TV', 'Movies & TV'],
  ['Media Player', 'Media Player'],
  ['Plex', 'Plex'],
]);
/** Streaming apps from the Microsoft Store, by their install folder. */
const STORE_PACKAGES: [RegExp, string][] = [
  [/\\4df9e0f8\.netflix_/i, 'Netflix'],
  [/\\disney\.37853fc22b2ce_/i, 'Disney+'],
  [/\\amazonvideo\.primevideo_/i, 'Prime Video'],
  [/\\appleinc\.appletv_/i, 'Apple TV'],
  [/\\hulullc\.hulupl/i, 'Hulu'],
  [/\\microsoft\.zunevideo_/i, 'Movies & TV'],
];

const VIDEO_FILE = /\.(mkv|mp4|m4v|avi|mov|wmv|webm|flv|mpe?g|ts|m2ts|vob|ogv|3gp|rmvb|divx)$/i;
const AUDIO_FILE = /\.(mp3|flac|wav|m4a|aac|ogg|oga|opus|wma|alac|aiff?|ape|mka)$/i;
/** Release tags in video file names: "Movie.2019.1080p.BluRay.x264" -> "Movie 2019". */
const RELEASE_TAGS = /[\s([.-]+(2160p|1080p|720p|576p|480p|4k|uhd|hdr(10)?|bluray|blu-ray|bdrip|brrip|web-?dl|webrip|hdtv|dvdrip|remux|x26[45]|h\.?26[45]|hevc|10bit)\b.*$/i;

/** A video file's name as a title: no extension, group tags or release tags. */
function fileTitle(name: string): string {
  let s = name.trim().replace(VIDEO_FILE, '');
  if (!/\s/.test(s)) s = s.replace(/[._]+/g, ' ');
  return cleanTitle(s.replace(/^(\[[^\]]*\]\s*)+/, '').replace(RELEASE_TAGS, ''));
}

function videoInPlayer(p: Player, t: string): Video | null {
  if (p.idle?.test(t)) return null;
  const m = p.suffix?.exec(t);
  const media = m ? t.slice(0, m.index) : p.bare ? '' : t;
  if (AUDIO_FILE.test(media.trim()) || (!media && !p.bare)) return null;
  return { site: p.name, title: fileTitle(media) };
}

/** An app window titled "Show - App" or just "App". */
function videoInApp(t: string, site: string): Video {
  return { site, title: t.endsWith(` - ${site}`) ? cleanTitle(t.slice(0, -site.length - 3)) : '' };
}

// ---------------- classifying ----------------

/** Browsers, video and music players and Store app hosts: never games, even full screen. */
export function isMediaApp(exe: string): boolean {
  const e = exe.toLowerCase();
  return BROWSERS.has(e) || PLAYERS.has(e) || MUSIC.has(e) || STORE_HOSTS.has(e);
}

/**
 * The video a window shows, from its program's exe name, its title and the program's full path
 * (which only matters for Store apps). Null when it isn't a video: another page, a site's home page,
 * YouTube Music, a player with nothing open, a song, or any other program.
 */
export function classifyVideo(exe: string, title: string, path = ''): Video | null {
  const e = exe.toLowerCase();
  const t = title.replace(/ \(Not Responding\)$/i, '').trim();
  if (!t) return null;
  const browser = BROWSERS.get(e);
  if (browser) return videoInTab(t.replace(browser, ''), e === 'msedge.exe');
  const player = PLAYERS.get(e);
  if (player) return videoInPlayer(player, t);
  if (STORE_HOSTS.has(e)) {
    const i = t.lastIndexOf(' - ');
    const app = STORE_APPS.get(t) ?? (i > 0 ? STORE_APPS.get(t.slice(i + 3)) : undefined);
    return app ? videoInApp(t, app) : null;
  }
  const pkg = path ? STORE_PACKAGES.find(([re]) => re.test(path)) : undefined;
  return pkg ? videoInApp(t, pkg[1]) : null;
}

/** A title fit to pass on: no notification counts ("(3) "), control or direction marks, or play
 * symbols, and at most `max` characters. */
export function cleanTitle(raw: string, max = MAX_TITLE): string {
  let s = raw
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f​-‏‪-‮⁦-⁩﻿]/g, '')
    .replace(/^\s*\(\d+\+?\)\s*/, '')
    .replace(/^[\s▶►⏵⏸❚]+/u, '')
    .replace(/\s+/g, ' ')
    .trim();
  const chars = Array.from(s);
  if (chars.length > max) s = chars.slice(0, max - 1).join('').trimEnd() + '…';
  return s;
}

type Rect = Pick<DesktopWindow, 'left' | 'top' | 'right' | 'bottom'>;

/** How much of window `i` the windows above it (earlier in `wins`, top first) leave uncovered, 0..1. */
export function visibleShare(wins: Rect[], i: number): number {
  const r = wins[i];
  let seen = 0;
  for (let a = 0; a < 8; a++) {
    for (let b = 0; b < 6; b++) {
      const x = r.left + ((a + 0.5) / 8) * (r.right - r.left);
      const y = r.top + ((b + 0.5) / 6) * (r.bottom - r.top);
      let j = 0;
      while (j < i && !(x >= wins[j].left && x < wins[j].right && y >= wins[j].top && y < wins[j].bottom)) j++;
      if (j === i) seen++;
    }
  }
  return seen / 48;
}

/** The top-most video among windows (z-order, top first) that's at least half visible: a video on
 * another screen, or next to the window you're using. `exeOf` gives a window's exe name by pid. */
export function visibleVideo(wins: DesktopWindow[], exeOf: (pid: number) => string | undefined): Video | null {
  for (let i = 0; i < wins.length; i++) {
    const exe = exeOf(wins[i].pid);
    const v = exe ? classifyVideo(exe, wins[i].title) : null;
    if (v && visibleShare(wins, i) >= 0.5) return v;
  }
  return null;
}

// ---------------- watching ----------------

/** What the pet is told about what you're doing. */
export interface MediaState {
  /** The game you're playing, or null. */
  game: string | null;
  /** Processes of running games: their windows are left out of the pet's world. */
  gamePids: Set<number>;
  /** The video you're watching, or null. */
  video: Video | null;
}

export interface WatchOptions {
  /** Game reactions are on: look for any game. With them off only known games are tracked, by exe
   * name (as before), so the pet still keeps off their windows; `game` is then always null. */
  games: boolean;
  /** Video reactions are on: look at window titles for videos. */
  videos: boolean;
  /** Hatchling's own windows. */
  exclude?: Set<string>;
  /** Milliseconds since the epoch (for tests). */
  now?: number;
}

/** A running program, as far as games go. */
interface Proc {
  /** Lower-case exe name: with the pid, what tells a process apart (pids get reused). */
  exe: string;
  /** Full exe path: null until needed, '' when Windows won't say. */
  path: string | null;
  /** The exe name of the program that started it (null: first seen in front, before a scan). */
  parent: string | null;
  /** game: counts while it runs. maybe: a game once its window is in front. java: Minecraft once a
   * window says so. unknown: a game if it stays full screen. never: not a game. */
  kind: 'game' | 'maybe' | 'java' | 'unknown' | 'never';
  name: string;
}

/** Programs are listed at most this often (the window in front is looked at on every ~2 s poll). */
const SCAN_MS = 9500;
/** How much of its screen a game's window must cover, in front, to count as being played (a 720p
 * window on a 4K screen does; desktop toys that sit in a corner don't). */
const PLAY_COVER = 0.1;
/** Polls in a row an unknown program must be in front and full screen to count as a game. */
const FULLSCREEN_POLLS = 2;
const NO_WINDOWS = new Set<string>();
const NO_PIDS = new Set<number>();

/** Keeps track of the game you're playing and the video you're watching. */
export class MediaWatcher {
  private procs = new Map<number, Proc>();
  private parents = new Map<number, number>();
  /** Running games: pid -> name. */
  private running = new Map<number, string>();
  private pids = new Set<number>();
  private changed = false;
  private game: string | null = null;
  /** A video in a window that isn't in front, from the last scan. */
  private background: Video | null = null;
  private scannedAt = -Infinity;
  private games: boolean | null = null;
  private videos: boolean | null = null;
  private fullPid = 0;
  private fullPolls = 0;
  private lastKey = '';
  private lastVideo: Video | null = null;

  /**
   * Call every couple of seconds. With game and video reactions off it only lists programs every
   * ~10 s (known games by name); otherwise it also looks at the window in front (its program, size
   * and, when needed, title) and, every ~10 s, at new programs' exe paths and at visible windows.
   */
  poll(d: Desktop, o: WatchOptions): MediaState {
    if (!d.available) return { game: null, gamePids: NO_PIDS, video: null };
    if (o.games !== this.games) this.resetGames(o.games);
    if (o.videos !== this.videos) this.resetVideos(o.videos);
    const now = o.now ?? Date.now();
    if (now - this.scannedAt >= SCAN_MS) {
      this.scannedAt = now;
      this.scan(d, o);
    }
    let video: Video | null = null;
    let front = 0;
    const f = o.games || o.videos ? d.front(o.exclude ?? NO_WINDOWS) : null;
    const p = f && !f.shell ? this.proc(d, f.pid, o.games) : null;
    if (f && p) {
      const needTitle = o.videos || (o.games && (p.kind === 'maybe' || p.kind === 'java' || (p.kind === 'unknown' && f.fullscreen)));
      const title = needTitle ? d.title(f.hwnd) : '';
      if (o.videos) video = this.videoIn(d, f.pid, p, title);
      if (o.games) front = this.inFront(f, p, title);
    } else this.fullPolls = 0;
    if (front) this.game = this.running.get(front) ?? null;
    else if (this.game === null || !this.isRunning(this.game)) this.game = this.running.values().next().value ?? null;
    if (this.changed) {
      this.pids = new Set(this.running.keys());
      this.changed = false;
    }
    return { game: o.games ? this.game : null, gamePids: this.pids, video: o.videos ? (video ?? this.background) : null };
  }

  /** Game reactions switched on or off: programs are looked at again (it's what they're checked for). */
  private resetGames(games: boolean) {
    this.games = games;
    this.procs.clear();
    this.parents.clear();
    this.running.clear();
    this.pids = new Set();
    this.changed = false;
    this.game = null;
    this.fullPid = this.fullPolls = 0;
    this.lastKey = '';
    this.scannedAt = -Infinity;
  }

  private resetVideos(videos: boolean) {
    this.videos = videos;
    this.background = null;
    this.lastKey = '';
    this.lastVideo = null;
    this.scannedAt = -Infinity;
  }

  /** Lists running programs: new ones are looked at once, ended ones forgotten. Also looks at visible
   * windows when that's needed (videos in the background, a Java program that may be Minecraft). */
  private scan(d: Desktop, o: WatchOptions) {
    const exes = d.processes(o.games ? this.parents : undefined);
    for (const [pid, p] of this.procs) if (exes.get(pid) !== p.exe) this.forget(pid);
    const parentOf = (pid: number) => (o.games ? (exes.get(this.parents.get(pid) ?? -1) ?? '') : '');
    let java = false;
    for (const [pid, exe] of exes) {
      let p = this.procs.get(pid);
      if (!p) p = this.add(d, pid, exe, parentOf(pid), null, o.games);
      else if (p.parent === null) {
        // First seen in front before a scan knew what started it: a launcher can make it a game.
        p.parent = parentOf(pid);
        if (p.kind === 'unknown') this.classify(d, pid, p, o.games);
      }
      if (p.kind === 'java') java = true;
    }
    if (!o.videos && !java) {
      this.background = null;
      return;
    }
    const wins = d.windows(o.exclude ?? NO_WINDOWS);
    if (java) {
      for (const w of wins) {
        const p = this.procs.get(w.pid);
        if (p?.kind === 'java' && minecraftTitle(w.title)) this.confirm(w.pid, p, 'Minecraft');
      }
    }
    this.background = o.videos ? visibleVideo(wins, (pid) => this.procs.get(pid)?.exe) : null;
  }

  private add(d: Desktop, pid: number, exe: string, parent: string | null, path: string | null, games: boolean): Proc {
    const p: Proc = { exe, path, parent, kind: 'never', name: '' };
    this.procs.set(pid, p);
    this.classify(d, pid, p, games);
    return p;
  }

  /** Looks at a program once: known games by exe name; others (with game reactions on) by where
   * they're installed and what started them. Only these need their path. */
  private classify(d: Desktop, pid: number, p: Proc, games: boolean) {
    const known = knownGame(p.exe);
    if (known) return this.confirm(pid, p, known);
    if (!games || !p.exe || neverGame(p.exe) || isMediaApp(p.exe)) return;
    p.path ??= d.processPath(pid);
    const g = classifyGame(p.exe, '', p.path, p.parent ?? '');
    if (g === 'unknown') p.kind = isJava(p.exe) ? 'java' : 'unknown';
    else if (g?.sure) this.confirm(pid, p, g.name);
    else if (g) {
      p.kind = 'maybe';
      p.name = g.name;
    }
  }

  /** The program in front: known from the last scan, or looked up now (it may have just started;
   * if Windows won't say what it is, the next scan fills it in). */
  private proc(d: Desktop, pid: number, games: boolean): Proc | null {
    if (!pid) return null;
    const p = this.procs.get(pid);
    if (p) return p;
    const path = d.processPath(pid);
    return this.add(d, pid, fileName(path).toLowerCase(), null, path, games);
  }

  /** The video in the window in front (worked out again only when its program or title changes). */
  private videoIn(d: Desktop, pid: number, p: Proc, title: string): Video | null {
    const key = `${pid}\n${title}`;
    if (key !== this.lastKey) {
      this.lastKey = key;
      p.path ??= d.processPath(pid);
      this.lastVideo = p.exe ? classifyVideo(p.exe, title, p.path) : null;
    }
    return this.lastVideo;
  }

  /** Games seen in front: one found by its folder or launcher once you're using its window, Minecraft
   * once its window says so, and an unknown program that stays full screen. Returns the pid when the
   * window in front is a running game's. */
  private inFront(f: FrontWindow, p: Proc, title: string): number {
    if (p.kind === 'maybe' && f.cover >= PLAY_COVER) {
      const g = classifyGame(p.exe, title, p.path ?? '', p.parent ?? '');
      this.confirm(f.pid, p, g && g !== 'unknown' ? g.name : p.name);
    } else if (p.kind === 'java' && minecraftTitle(title)) this.confirm(f.pid, p, 'Minecraft');
    const full = p.kind === 'unknown' && f.fullscreen;
    this.fullPolls = full ? (this.fullPid === f.pid ? this.fullPolls + 1 : 1) : 0;
    this.fullPid = full ? f.pid : 0;
    if (full && this.fullPolls >= FULLSCREEN_POLLS) this.confirm(f.pid, p, gameName(title, fileName(p.path ?? '') || p.exe));
    return p.kind === 'game' ? f.pid : 0;
  }

  private confirm(pid: number, p: Proc, name: string) {
    p.kind = 'game';
    p.name = name;
    if (this.running.get(pid) === name) return;
    this.running.set(pid, name);
    this.changed = true;
  }

  private forget(pid: number) {
    this.procs.delete(pid);
    if (this.running.delete(pid)) this.changed = true;
  }

  private isRunning(name: string) {
    for (const n of this.running.values()) if (n === name) return true;
    return false;
  }
}
