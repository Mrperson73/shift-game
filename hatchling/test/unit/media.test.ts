import { describe, expect, it } from 'vitest';
import { type Desktop, type DesktopWindow, type FrontWindow, NO_DESKTOP, openDesktop } from '../../src/main/desktop';
import { classifyVideo, cleanTitle, isMediaApp, MediaWatcher, visibleShare, visibleVideo } from '../../src/main/media';

const EDGE = ' - Microsoft\u200b Edge';

describe('classifyVideo in browsers', () => {
  it('finds videos on video sites from the tab title', () => {
    const cases: [string, string, string, string][] = [
      ['chrome.exe', '(3) Rick Astley - Never Gonna Give You Up (Official Music Video) - YouTube - Google Chrome', 'YouTube', 'Rick Astley - Never Gonna Give You Up (Official Music Video)'],
      ['msedge.exe', `Lofi Girl - beats to relax/study to - YouTube and 4 more pages - Personal${EDGE}`, 'YouTube', 'Lofi Girl - beats to relax/study to'],
      ['msedge.exe', `Cute cat video - YouTube${EDGE}`, 'YouTube', 'Cute cat video'],
      ['msedge.exe', `Cute cat video - YouTube - [InPrivate]${EDGE}`, 'YouTube', 'Cute cat video'],
      ['msedge.exe', 'Cute cat video - YouTube - Microsoft Edge', 'YouTube', 'Cute cat video'],
      ['firefox.exe', 'Minecraft Speedrun World Record - YouTube — Mozilla Firefox', 'YouTube', 'Minecraft Speedrun World Record'],
      ['firefox.exe', 'T-Rex facts for kids - YouTube — Mozilla Firefox Private Browsing', 'YouTube', 'T-Rex facts for kids'],
      ['opera.exe', 'xQc - Twitch - Opera', 'Twitch', 'xQc'],
      ['brave.exe', 'Speedrun marathon day 3 - GamesDoneQuick on Twitch - Brave', 'Twitch', 'Speedrun marathon day 3 - GamesDoneQuick'],
      ['chrome.exe', 'Kai Cenat Stream - Watch Live on Kick - Google Chrome', 'Kick', 'Kai Cenat'],
      ['brave.exe', 'Netflix - Brave', 'Netflix', ''],
      ['chrome.exe', 'Disney+ - Google Chrome', 'Disney+', ''],
      ['chrome.exe', 'The Mandalorian | Disney+ - Google Chrome', 'Disney+', 'The Mandalorian'],
      ['vivaldi.exe', 'Prime Video: The Boys - Season 4 - Vivaldi', 'Prime Video', 'The Boys - Season 4'],
      ['chrome.exe', 'Amazon.com: Watch The Boys - Season 4 | Prime Video - Google Chrome', 'Prime Video', 'The Boys - Season 4'],
      ['chrome.exe', 'Watch Abbott Elementary Streaming Online | Hulu - Google Chrome', 'Hulu', 'Abbott Elementary'],
      ['chrome.exe', 'The Last of Us | Max - Google Chrome', 'Max', 'The Last of Us'],
      ['chrome.exe', "Frieren E1 - The Journey's End - Watch on Crunchyroll - Google Chrome", 'Crunchyroll', "Frieren E1 - The Journey's End"],
      ['chrome.exe', 'Tulsa King - Paramount+ - Google Chrome', 'Paramount+', 'Tulsa King'],
      ['chrome.exe', 'Watch The Office Streaming Online | Peacock - Google Chrome', 'Peacock', 'The Office'],
      ['chrome.exe', 'Ted Lasso - Apple TV+ - Google Chrome', 'Apple TV', 'Ted Lasso'],
      ['chrome.exe', 'Big Buck Bunny on Vimeo - Google Chrome', 'Vimeo', 'Big Buck Bunny'],
      ['chrome.exe', 'TikTok - Make Your Day - Google Chrome', 'TikTok', ''],
      ['chrome.exe', 'funny dog compilation | TikTok - Google Chrome', 'TikTok', 'funny dog compilation'],
      ['chrome.exe', 'For You | TikTok - Google Chrome', 'TikTok', ''],
      ['chrome.exe', 'Dinosaur documentary - video Dailymotion - Google Chrome', 'Dailymotion', 'Dinosaur documentary'],
      ['chrome.exe', 'Plex - Google Chrome', 'Plex', ''],
      ['chrome.exe', 'Picture in picture', 'Video', ''],
      ['chrome.exe', 'Cat video - YouTube - Google Chrome (Not Responding)', 'YouTube', 'Cat video'],
    ];
    for (const [exe, title, site, t] of cases) expect(classifyVideo(exe, title), title).toEqual({ site, title: t });
  });

  it("isn't fooled by other pages, YouTube's own pages, music or search results", () => {
    const titles = [
      'YouTube - Google Chrome',
      '(12) YouTube - Google Chrome',
      'Subscriptions - YouTube - Google Chrome',
      `Watch later - YouTube${EDGE}`,
      'Bohemian Rhapsody - YouTube Music - Google Chrome',
      'Channel content - YouTube Studio - Google Chrome',
      'youtube - Google Search - Google Chrome',
      'Inbox (3) - me@example.com - Gmail - Google Chrome',
      'Twitch - Google Chrome',
      'Browse - Twitch - Google Chrome',
      'Home - Netflix - Google Chrome',
      'Watch Stranger Things | Netflix Official Site - Google Chrome',
      'Hulu | Home - Google Chrome',
      'New Tab - Google Chrome',
      '',
    ];
    for (const t of titles) expect(classifyVideo('chrome.exe', t), t).toBeNull();
  });

  it('only looks at the tab in front: a closed or background video tab is gone from the title', () => {
    expect(classifyVideo('chrome.exe', 'Never Gonna Give You Up - YouTube - Google Chrome')).not.toBeNull();
    expect(classifyVideo('chrome.exe', 'Homework - Google Docs - Google Chrome')).toBeNull();
  });
});

describe('classifyVideo in players and apps', () => {
  it('finds what a video player is playing', () => {
    const cases: [string, string, string, string][] = [
      ['vlc.exe', 'The.Movie.2019.1080p.BluRay.x264.mkv - VLC media player', 'VLC', 'The Movie 2019'],
      ['mpv.exe', '[SubsPlease] Frieren - 01 (1080p) [A1B2C3D4].mkv - mpv', 'mpv', 'Frieren - 01'],
      ['mpc-hc64.exe', 'holiday_2023.mp4', 'MPC-HC', 'holiday 2023'],
      ['mpc-be64.exe', 'Interstellar.2014.2160p.UHD.mkv', 'MPC-BE', 'Interstellar 2014'],
      ['PotPlayerMini64.exe', 'Cartoon Episode 5.mp4 - PotPlayer', 'PotPlayer', 'Cartoon Episode 5'],
      ['KMPlayer64X.exe', 'Dino Park.avi - The KMPlayer', 'KMPlayer', 'Dino Park'],
      ['Microsoft.Media.Player.exe', 'Media Player', 'Media Player', ''],
      ['Microsoft.Media.Player.exe', 'Jurassic Park - Media Player', 'Media Player', 'Jurassic Park'],
      ['Video.UI.exe', 'Films & TV', 'Movies & TV', ''],
      ['wmplayer.exe', 'Windows Media Player', 'Windows Media Player', ''],
      ['Plex.exe', 'Plex', 'Plex', ''],
      ['stremio.exe', 'Stremio - Freedom to Stream', 'Stremio', ''],
      ['ApplicationFrameHost.exe', 'Movies & TV', 'Movies & TV', ''],
      ['ApplicationFrameHost.exe', 'Netflix', 'Netflix', ''],
    ];
    for (const [exe, title, site, t] of cases) expect(classifyVideo(exe, title), `${exe}: ${title}`).toEqual({ site, title: t });
    const netflixApp = 'C:\\Program Files\\WindowsApps\\4DF9E0F8.Netflix_6.99.5.0_x64__mcm4njqhnhss8\\Netflix.exe';
    expect(classifyVideo('netflix.exe', 'Netflix', netflixApp)).toEqual({ site: 'Netflix', title: '' });
  });

  it("isn't fooled by idle players, music or other apps that mention video sites", () => {
    const cases: [string, string][] = [
      ['vlc.exe', 'VLC media player'],
      ['vlc.exe', 'Song.mp3 - VLC media player'],
      ['mpv.exe', 'No file - mpv'],
      ['mpc-hc64.exe', 'Media Player Classic Home Cinema'],
      ['PotPlayerMini64.exe', 'PotPlayer'],
      ['Microsoft.Media.Player.exe', 'Track 01.flac - Media Player'],
      ['ApplicationFrameHost.exe', 'Calculator'],
      ['Code.exe', 'youtube.ts - my-app - Visual Studio Code'],
      ['Discord.exe', '#youtube-links | My Server - Discord'],
      ['steam.exe', 'Steam'],
      ['EpicGamesLauncher.exe', 'Epic Games Launcher'],
      ['notepad.exe', 'Netflix.txt - Notepad'],
      ['WINWORD.EXE', 'YouTube script.docx - Word'],
      ['Spotify.exe', 'Artist - Song'],
    ];
    for (const [exe, title] of cases) expect(classifyVideo(exe, title), `${exe}: ${title}`).toBeNull();
  });

  it('knows which programs are media apps (never games, even full screen)', () => {
    for (const exe of ['chrome.exe', 'msedge.exe', 'firefox.exe', 'vlc.exe', 'Spotify.exe', 'ApplicationFrameHost.exe']) expect(isMediaApp(exe), exe).toBe(true);
    for (const exe of ['Brawlhalla.exe', 'Code.exe', 'javaw.exe']) expect(isMediaApp(exe), exe).toBe(false);
  });
});

describe('cleanTitle', () => {
  it('drops notification counts, play symbols and invisible characters', () => {
    expect(cleanTitle('(3) My video')).toBe('My video');
    expect(cleanTitle('(99+) My video')).toBe('My video');
    expect(cleanTitle('▶ Now playing')).toBe('Now playing');
    expect(cleanTitle('\u202eevil\u200b  title\u0007')).toBe('evil title');
  });

  it('caps the length without breaking emoji', () => {
    const long = cleanTitle('a'.repeat(200));
    expect(Array.from(long)).toHaveLength(80);
    expect(long.endsWith('…')).toBe(true);
    const emoji = cleanTitle('🦖'.repeat(100));
    expect(Array.from(emoji)).toHaveLength(80);
    expect(emoji.startsWith('🦖'.repeat(79))).toBe(true);
    expect(emoji).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])/);
  });
});

const win = (pid: number, title: string, left: number, top: number, right: number, bottom: number): DesktopWindow => ({ hwnd: String(pid), pid, title, left, top, right, bottom });

describe('videos in windows that are not in front', () => {
  it('measures how much of a window the windows above leave visible', () => {
    const back = win(2, 'b', 0, 0, 1920, 1080);
    expect(visibleShare([back], 0)).toBe(1);
    expect(visibleShare([win(1, 'a', 0, 0, 960, 1080), back], 1)).toBe(0.5);
    expect(visibleShare([win(1, 'a', 0, 0, 1920, 1080), back], 1)).toBe(0);
  });

  it('finds the top-most video that is mostly visible', () => {
    const exes: Record<number, string> = { 1: 'code.exe', 2: 'chrome.exe', 3: 'vlc.exe' };
    const exeOf = (pid: number) => exes[pid];
    const youtube = win(2, 'Dino documentary - YouTube - Google Chrome', 1920, 0, 3840, 1080);
    const vlc = win(3, 'Movie.mkv - VLC media player', 0, 0, 1920, 1080);
    // YouTube on the second screen, next to the code editor on the first.
    expect(visibleVideo([win(1, 'main.ts - Code', 0, 0, 1920, 1080), youtube], exeOf)).toEqual({ site: 'YouTube', title: 'Dino documentary' });
    // A player hidden behind the editor doesn't count.
    expect(visibleVideo([win(1, 'main.ts - Code', 0, 0, 1920, 1080), vlc], exeOf)).toBeNull();
    // Unknown programs are skipped.
    expect(visibleVideo([win(9, 'Dino documentary - YouTube - Google Chrome', 0, 0, 800, 600)], exeOf)).toBeNull();
  });
});

// ---------------- MediaWatcher ----------------

interface Fake {
  procs: Map<number, string>;
  paths: Record<number, string>;
  parents: Record<number, number>;
  front: FrontWindow | null;
  titles: Record<string, string>;
  windows: DesktopWindow[];
}

/** A desktop that counts the native calls made to it. */
function fake(init: Partial<Fake> = {}) {
  const s: Fake = { procs: new Map(), paths: {}, parents: {}, front: null, titles: {}, windows: [], ...init };
  const calls = { processes: 0, processPath: 0, front: 0, title: 0, windows: 0 };
  const d: Desktop = {
    ...NO_DESKTOP,
    available: true,
    processes(parents) {
      calls.processes++;
      parents?.clear();
      for (const [pid, parent] of Object.entries(s.parents)) parents?.set(Number(pid), parent);
      return new Map(s.procs);
    },
    processPath(pid) {
      calls.processPath++;
      return s.paths[pid] ?? '';
    },
    front() {
      calls.front++;
      return s.front;
    },
    title(hwnd) {
      calls.title++;
      return s.titles[hwnd] ?? '';
    },
    windows() {
      calls.windows++;
      return s.windows;
    },
  };
  return { d, s, calls };
}

const front = (pid: number, cover = 1, fullscreen = false): FrontWindow => ({ hwnd: `h${pid}`, pid, cover, fullscreen, shell: false });
const ON = { games: true, videos: true };
const STEAM_GAME = 'D:\\SteamLibrary\\steamapps\\common\\Rain World\\RainWorld.exe';

describe('MediaWatcher', () => {
  it('reports nothing, and calls nothing, without the Windows integration (Linux CI)', () => {
    const d = openDesktop();
    expect(d.available).toBe(false);
    expect(d.front(new Set())).toBeNull();
    expect(d.title('1')).toBe('');
    expect(d.processPath(process.pid)).toBe('');
    expect(d.processes(new Map()).size).toBe(0);
    const w = new MediaWatcher();
    for (const desk of [d, NO_DESKTOP]) expect(w.poll(desk, ON)).toEqual({ game: null, gamePids: new Set(), video: null });
  });

  it('knows a known game from the process list alone, without asking for any paths or titles', () => {
    const { d, calls } = fake({ procs: new Map([[4, 'explorer.exe'], [20, 'brawlhalla.exe'], [30, 'chrome.exe']]) });
    const seen = new MediaWatcher().poll(d, { games: true, videos: false, now: 0 });
    expect(seen.game).toBe('Brawlhalla');
    expect([...seen.gamePids]).toEqual([20]);
    expect(calls.processPath).toBe(0);
    expect(calls.title).toBe(0);
  });

  it('lists programs at most every ~10 s and looks at each new one once', () => {
    const { d, s, calls } = fake({ procs: new Map([[30, 'rainworld.exe']]), paths: { 30: STEAM_GAME } });
    const w = new MediaWatcher();
    for (let t = 0; t < 10_000; t += 2000) w.poll(d, { ...ON, now: t });
    expect(calls.processes).toBe(1);
    expect(calls.front).toBe(5);
    w.poll(d, { ...ON, now: 10_000 });
    expect(calls.processes).toBe(2);
    expect(calls.processPath).toBe(1);
    // A new program with a reused pid is looked at again.
    s.procs.set(30, 'other.exe');
    w.poll(d, { ...ON, now: 20_000 });
    expect(calls.processPath).toBe(2);
  });

  it('does nothing extra with game and video reactions off (known games still keep the pet off their windows)', () => {
    const { d, s, calls } = fake({ procs: new Map([[20, 'brawlhalla.exe'], [30, 'rainworld.exe']]), paths: { 30: STEAM_GAME } });
    s.front = front(30);
    s.titles.h30 = 'Rain World';
    const w = new MediaWatcher();
    for (let t = 0; t <= 20_000; t += 2000) {
      const seen = w.poll(d, { games: false, videos: false, now: t });
      expect(seen.game).toBeNull();
      expect(seen.video).toBeNull();
      expect([...seen.gamePids]).toEqual([20]);
    }
    expect(calls.processes).toBe(3);
    expect(calls).toMatchObject({ front: 0, title: 0, processPath: 0, windows: 0 });
  });

  it('counts a game found by its folder once its window is in front, until it quits', () => {
    const { d, s } = fake({ procs: new Map([[4, 'explorer.exe'], [30, 'rainworld.exe']]), paths: { 30: STEAM_GAME } });
    const w = new MediaWatcher();
    s.front = front(4);
    expect(w.poll(d, { ...ON, now: 0 }).game).toBeNull();
    // A small window in front (a tool, a settings dialog) isn't playing.
    s.front = front(30, 0.05);
    expect(w.poll(d, { ...ON, now: 2000 }).game).toBeNull();
    s.front = front(30, 0.6);
    s.titles.h30 = 'Rain World';
    let seen = w.poll(d, { ...ON, now: 4000 });
    expect(seen.game).toBe('Rain World');
    expect([...seen.gamePids]).toEqual([30]);
    // Still playing while you're in another window.
    s.front = front(4);
    expect(w.poll(d, { ...ON, now: 6000 }).game).toBe('Rain World');
    s.procs.delete(30);
    seen = w.poll(d, { ...ON, now: 12_000 });
    expect(seen.game).toBeNull();
    expect(seen.gamePids.size).toBe(0);
  });

  it('counts an unknown program as a game when it stays full screen, but never a browser', () => {
    const { d, s } = fake({ procs: new Map([[40, 'coolgame.exe'], [50, 'chrome.exe']]), paths: { 40: 'E:\\Games\\Cool Game\\CoolGame.exe' } });
    const w = new MediaWatcher();
    s.front = front(40, 1, true);
    s.titles.h40 = 'Cool Game';
    expect(w.poll(d, { ...ON, now: 0 }).game).toBeNull();
    expect(w.poll(d, { ...ON, now: 2000 }).game).toBe('Cool Game');
    const w2 = new MediaWatcher();
    s.front = front(50, 1, true);
    s.titles.h50 = 'Dino documentary - YouTube - Google Chrome';
    for (let t = 0; t <= 8000; t += 2000) expect(w2.poll(d, { ...ON, now: t })).toMatchObject({ game: null, video: { site: 'YouTube', title: 'Dino documentary' } });
  });

  it('finds Minecraft: Java Edition by its window title', () => {
    const java = 'C:\\Program Files\\Eclipse Adoptium\\jdk-21\\bin\\javaw.exe';
    const { d, s } = fake({ procs: new Map([[50, 'javaw.exe'], [51, 'javaw.exe']]), paths: { 50: java, 51: java } });
    s.windows = [win(50, 'Minecraft* 1.21.4 - Singleplayer', 0, 0, 1280, 720), win(51, 'Some Java tool', 0, 0, 800, 600)];
    const seen = new MediaWatcher().poll(d, { games: true, videos: false, now: 0 });
    expect(seen.game).toBe('Minecraft');
    expect([...seen.gamePids]).toEqual([50]);
  });

  it('finds games started by a launcher, even ones seen in front before the next scan', () => {
    const { d, s } = fake({ procs: new Map([[60, 'tinyglade.exe'], [61, 'epicgameslauncher.exe']]), paths: { 60: 'E:\\Games\\Tiny Glade\\TinyGlade.exe' }, parents: { 60: 61 } });
    s.front = front(60);
    s.titles.h60 = 'Tiny Glade';
    expect(new MediaWatcher().poll(d, { ...ON, now: 0 }).game).toBe('Tiny Glade');
    // Started after the last scan: in front first, and its launcher known a scan later.
    const late = fake({ procs: new Map([[61, 'epicgameslauncher.exe']]), paths: { 60: 'E:\\Games\\Tiny Glade\\TinyGlade.exe' } });
    const w = new MediaWatcher();
    w.poll(late.d, { ...ON, now: 0 });
    late.s.front = front(60);
    late.s.titles.h60 = 'Tiny Glade';
    expect(w.poll(late.d, { ...ON, now: 2000 }).game).toBeNull();
    late.s.procs.set(60, 'tinyglade.exe');
    late.s.parents[60] = 61;
    expect(w.poll(late.d, { ...ON, now: 10_000 }).game).toBe('Tiny Glade');
  });

  it('reports the video in front, or a visible one elsewhere, and reads titles only for video reactions', () => {
    const { d, s, calls } = fake({ procs: new Map([[1, 'code.exe'], [2, 'chrome.exe']]) });
    s.front = front(2, 0.5);
    s.titles.h2 = '(2) T-Rex facts - YouTube - Google Chrome';
    const w = new MediaWatcher();
    expect(w.poll(d, { ...ON, now: 0 }).video).toEqual({ site: 'YouTube', title: 'T-Rex facts' });
    // The editor in front, YouTube still showing on the other screen.
    s.front = front(1, 0.5);
    s.windows = [win(1, 'main.ts - Code', 0, 0, 1920, 1080), win(2, '(2) T-Rex facts - YouTube - Google Chrome', 1920, 0, 3840, 1080)];
    expect(w.poll(d, { ...ON, now: 10_000 }).video).toEqual({ site: 'YouTube', title: 'T-Rex facts' });
    // Closed: gone at the next scan.
    s.windows = [win(1, 'main.ts - Code', 0, 0, 1920, 1080)];
    expect(w.poll(d, { ...ON, now: 20_000 }).video).toBeNull();
    // Video reactions off: no titles read for a program that can't be a game.
    const before = calls.title;
    s.front = front(2, 0.5);
    for (let t = 30_000; t <= 40_000; t += 2000) expect(w.poll(d, { games: true, videos: false, now: t }).video).toBeNull();
    expect(calls.title).toBe(before);
  });

  it('keeps games it found when video reactions are switched', () => {
    const { d, s } = fake({ procs: new Map([[30, 'rainworld.exe']]), paths: { 30: STEAM_GAME } });
    s.front = front(30);
    s.titles.h30 = 'Rain World';
    const w = new MediaWatcher();
    expect(w.poll(d, { ...ON, now: 0 }).game).toBe('Rain World');
    s.front = null;
    expect(w.poll(d, { games: true, videos: false, now: 2000 }).game).toBe('Rain World');
    expect(w.poll(d, { games: false, videos: false, now: 4000 }).game).toBeNull();
  });
});
