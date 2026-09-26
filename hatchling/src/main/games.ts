// Recognises the games you play from the programs that are running: popular games by exe name, and
// any other game by where it's installed (Steam, Epic, Riot, GOG, Ubisoft, EA, Xbox, Rockstar,
// Battle.net and Roblox folders) or by the launcher that started it. Nothing is read from inside
// the games: only exe names and paths, and the title of a game's window while it's in front.
// Everything here is pure; media.ts does the polling.

/** A game a program belongs to. `sure`: it counts as soon as it runs; otherwise only once its window
 * has been in front (so tools and desktop toys that live in game folders don't count). */
export interface GameGuess {
  name: string;
  sure: boolean;
}

/** Popular PC games: display name, then exe names (lower-case). */
const KNOWN_GAMES: [string, ...string[]][] = [
  // Shooters and battle royales
  ['Valorant', 'valorant.exe', 'valorant-win64-shipping.exe'],
  ['Counter-Strike 2', 'cs2.exe'],
  ['Counter-Strike: Global Offensive', 'csgo.exe'],
  ['Apex Legends', 'r5apex.exe', 'r5apex_dx12.exe'],
  ['Overwatch 2', 'overwatch.exe'],
  ['PUBG: Battlegrounds', 'tslgame.exe'],
  ['Call of Duty', 'modernwarfare.exe', 'blackopscoldwar.exe', 'blackops3.exe', 'iw7_ship.exe', 's2_mp64_ship.exe'],
  ['Rainbow Six Siege', 'rainbowsix.exe', 'rainbowsix_vulkan.exe', 'rainbowsix_be.exe'],
  ['Destiny 2', 'destiny2.exe'],
  ['Escape from Tarkov', 'escapefromtarkov.exe'],
  ['Hunt: Showdown', 'huntgame.exe'],
  ['Battlefield 2042', 'bf2042.exe'],
  ['Battlefield 1', 'bf1.exe'],
  ['Battlefield V', 'bfv.exe'],
  ['Battlefield 4', 'bf4.exe'],
  ['Battlefield 6', 'bf6.exe'],
  ['Marvel Rivals', 'marvel-win64-shipping.exe'],
  ['Helldivers 2', 'helldivers2.exe'],
  ['Deadlock', 'deadlock.exe'],
  ['Team Fortress 2', 'tf_win64.exe'],
  ['Left 4 Dead 2', 'left4dead2.exe'],
  ['Portal 2', 'portal2.exe'],
  ['Half-Life: Alyx', 'hlvr.exe'],
  ["Garry's Mod", 'gmod.exe'],
  ['Squad', 'squadgame.exe'],
  ['War Thunder', 'aces.exe'],
  ['World of Tanks', 'worldoftanks.exe'],
  ['World of Warships', 'worldofwarships64.exe'],
  ['Warframe', 'warframe.x64.exe'],
  ['Delta Force', 'deltaforceclient-win64-shipping.exe'],
  ['Naraka: Bladepoint', 'narakabladepoint.exe'],
  ['Rust', 'rustclient.exe'],
  ['DayZ', 'dayz_x64.exe'],
  ['Arma 3', 'arma3_x64.exe'],
  ['Arma Reforger', 'armareforgersteam.exe'],
  ['Ready or Not', 'readyornot-win64-shipping.exe'],
  ['Payday 2', 'payday2_win32_release.exe'],
  ['Doom Eternal', 'doometernalx64vk.exe'],
  ['Doom: The Dark Ages', 'doomthedarkages.exe'],
  ['Borderlands 3', 'borderlands3.exe'],
  ['Halo Infinite', 'haloinfinite.exe'],
  ['Halo: The Master Chief Collection', 'mcc-win64-shipping.exe'],
  ['Star Citizen', 'starcitizen.exe'],
  // MOBAs, strategy and management
  ['League of Legends', 'league of legends.exe'],
  ['Dota 2', 'dota2.exe'],
  ['Legends of Runeterra', 'lor.exe'],
  ['Heroes of the Storm', 'heroesofthestorm_x64.exe'],
  ['StarCraft II', 'sc2_x64.exe', 'sc2.exe'],
  ['Age of Empires II', 'aoe2de_s.exe'],
  ['Age of Empires IV', 'reliccardinal.exe'],
  ['Civilization VI', 'civilizationvi.exe', 'civilizationvi_dx12.exe'],
  ['Europa Universalis IV', 'eu4.exe'],
  ['Hearts of Iron IV', 'hoi4.exe'],
  ['Stellaris', 'stellaris.exe'],
  ['Crusader Kings III', 'ck3.exe'],
  ['Total War: Warhammer III', 'warhammer3.exe'],
  ['Cities: Skylines', 'cities.exe'],
  ['Cities: Skylines II', 'cities2.exe'],
  ['Factorio', 'factorio.exe'],
  ['RimWorld', 'rimworldwin64.exe'],
  ['Anno 1800', 'anno1800.exe'],
  ['Planet Coaster', 'planetcoaster.exe'],
  ['Planet Zoo', 'planetzoo.exe'],
  ['Jurassic World Evolution', 'jwe.exe'],
  ['Jurassic World Evolution 2', 'jwe2.exe'],
  ['Hearthstone', 'hearthstone.exe'],
  ['Balatro', 'balatro.exe'],
  // Sandbox, survival and party games
  ['Minecraft', 'minecraft.windows.exe'],
  ['Minecraft Dungeons', 'dungeons-win64-shipping.exe'],
  ['Roblox', 'robloxplayerbeta.exe'],
  ['Fortnite', 'fortniteclient-win64-shipping.exe'],
  ['Terraria', 'terraria.exe'],
  ['Among Us', 'among us.exe'],
  ['Brawlhalla', 'brawlhalla.exe'],
  ['Rocket League', 'rocketleague.exe'],
  ['Fall Guys', 'fallguys_client_game.exe', 'fallguys_client.exe'],
  ['Stumble Guys', 'stumble guys.exe'],
  ['Gang Beasts', 'gang beasts.exe'],
  ['Palworld', 'palworld-win64-shipping.exe', 'palworld.exe'],
  ['Lethal Company', 'lethal company.exe'],
  ['Content Warning', 'content warning.exe'],
  ['R.E.P.O.', 'repo.exe'],
  ['PEAK', 'peak.exe'],
  ['Schedule I', 'schedule i.exe'],
  ['Phasmophobia', 'phasmophobia.exe'],
  ['Valheim', 'valheim.exe'],
  ['ARK: Survival Ascended', 'arkascended.exe'],
  ['Conan Exiles', 'conansandbox.exe'],
  ['The Isle', 'theisleclient-win64-shipping.exe', 'theisle-win64-shipping.exe'],
  ['Path of Titans', 'pathoftitans-win64-shipping.exe'],
  ['Sea of Thieves', 'sotgame.exe'],
  ['Dead by Daylight', 'deadbydaylight-win64-shipping.exe'],
  ['Deep Rock Galactic', 'fsd-win64-shipping.exe'],
  ['Raft', 'raft.exe'],
  ['Subnautica', 'subnautica.exe'],
  ['Subnautica: Below Zero', 'subnauticazero.exe'],
  ['Sons of the Forest', 'sonsoftheforest.exe'],
  ['The Forest', 'theforest.exe'],
  ['7 Days to Die', '7daystodie.exe', '7daystodie_eac.exe'],
  ['Project Zomboid', 'projectzomboid64.exe'],
  ['Unturned', 'unturned.exe'],
  ['Enshrouded', 'enshrouded.exe'],
  ['V Rising', 'vrising.exe'],
  ['Once Human', 'once_human.exe'],
  ["No Man's Sky", 'nms.exe'],
  ['Space Engineers', 'spaceengineers.exe'],
  ["Don't Starve Together", 'dontstarve_steam_x64.exe', 'dontstarve_steam.exe'],
  ['Slime Rancher', 'slimerancher.exe'],
  ['Slime Rancher 2', 'slimerancher2.exe'],
  ['VRChat', 'vrchat.exe'],
  ['Tabletop Simulator', 'tabletop simulator.exe'],
  ['Geometry Dash', 'geometrydash.exe'],
  ['osu!', 'osu!.exe'],
  ['Beat Saber', 'beat saber.exe'],
  ['Stardew Valley', 'stardew valley.exe', 'stardewvalley.exe', 'stardewmoddingapi.exe'],
  ['The Sims 4', 'ts4_x64.exe', 'ts4_dx9_x64.exe'],
  ['Euro Truck Simulator 2', 'eurotrucks2.exe'],
  ['American Truck Simulator', 'amtrucks.exe'],
  ['BeamNG.drive', 'beamng.drive.x64.exe'],
  ['Microsoft Flight Simulator', 'flightsimulator.exe', 'flightsimulator2024.exe'],
  ['Forza Horizon 5', 'forzahorizon5.exe'],
  ['Forza Horizon 4', 'forzahorizon4.exe'],
  ['It Takes Two', 'ittakestwo.exe'],
  ['Split Fiction', 'splitfiction.exe'],
  // Role-playing and action
  ['Elden Ring', 'eldenring.exe'],
  ['Elden Ring Nightreign', 'nightreign.exe'],
  ['Dark Souls III', 'darksoulsiii.exe'],
  ['Sekiro', 'sekiro.exe'],
  ['Armored Core VI', 'armoredcore6.exe'],
  ['Cyberpunk 2077', 'cyberpunk2077.exe'],
  ['The Witcher 3', 'witcher3.exe'],
  ["Baldur's Gate 3", 'bg3.exe', 'bg3_dx11.exe'],
  ['GTA IV', 'gtaiv.exe'],
  ['GTA: San Andreas', 'gta_sa.exe'],
  ['Red Dead Redemption 2', 'rdr2.exe'],
  ['Red Dead Redemption', 'rdr.exe'],
  ['Hogwarts Legacy', 'hogwartslegacy.exe'],
  ['Starfield', 'starfield.exe'],
  ['Skyrim', 'skyrimse.exe', 'skyrimvr.exe', 'tesv.exe'],
  ['Oblivion Remastered', 'oblivionremastered-win64-shipping.exe'],
  ['Fallout 4', 'fallout4.exe'],
  ['Fallout 76', 'fallout76.exe'],
  ['Fallout: New Vegas', 'falloutnv.exe'],
  ['Genshin Impact', 'genshinimpact.exe', 'yuanshen.exe'],
  ['Honkai: Star Rail', 'starrail.exe'],
  ['Zenless Zone Zero', 'zenlesszonezero.exe'],
  ['Diablo IV', 'diablo iv.exe'],
  ['Diablo III', 'diablo iii64.exe'],
  ['Diablo II: Resurrected', 'd2r.exe'],
  ['Diablo Immortal', 'diabloimmortal.exe'],
  ['World of Warcraft', 'wow.exe', 'wowclassic.exe'],
  ['Final Fantasy XIV', 'ffxiv_dx11.exe'],
  ['Final Fantasy XVI', 'ffxvi.exe'],
  ['Final Fantasy VII Remake', 'ff7remake_.exe'],
  ['Final Fantasy VII Rebirth', 'ff7rebirth_.exe'],
  ['Guild Wars 2', 'gw2-64.exe'],
  ['The Elder Scrolls Online', 'eso64.exe'],
  ['Black Desert', 'blackdesert64.exe'],
  ['Lost Ark', 'lostark.exe'],
  ['New World', 'newworld.exe'],
  ['EVE Online', 'exefile.exe'],
  ['RuneScape', 'rs2client.exe'],
  ['Old School RuneScape', 'osclient.exe', 'runelite.exe'],
  ['MapleStory', 'maplestory.exe'],
  ['Monster Hunter: World', 'monsterhunterworld.exe'],
  ['Monster Hunter Rise', 'monsterhunterrise.exe'],
  ['Monster Hunter Wilds', 'monsterhunterwilds.exe'],
  ['Resident Evil 4', 're4.exe'],
  ['Resident Evil 2', 're2.exe'],
  ['Resident Evil Village', 're8.exe'],
  ['Street Fighter 6', 'streetfighter6.exe'],
  ['Mortal Kombat 1', 'mk12.exe'],
  ['Hades', 'hades.exe'],
  ['Hades II', 'hades2.exe'],
  ['Hollow Knight', 'hollow_knight.exe'],
  ['Hollow Knight: Silksong', 'hollow knight silksong.exe'],
  ['Celeste', 'celeste.exe'],
  ['Cuphead', 'cuphead.exe'],
  ['Undertale', 'undertale.exe'],
  ['Deltarune', 'deltarune.exe'],
  ['Dead Cells', 'deadcells.exe'],
  ['The Binding of Isaac', 'isaac-ng.exe'],
  ['Kingdom Come: Deliverance', 'kingdomcome.exe'],
  ['Alan Wake 2', 'alanwake2.exe'],
  ['Control', 'control_dx12.exe', 'control_dx11.exe'],
  ['Dying Light 2', 'dyinglightgame_x64_rwdi.exe'],
  ['Dying Light', 'dyinglightgame.exe'],
  ['Horizon Zero Dawn', 'horizonzerodawn.exe'],
  ['Horizon Forbidden West', 'horizonforbiddenwest.exe'],
  ['God of War', 'gow.exe'],
  ['God of War Ragnarök', 'gowr.exe'],
  ["Marvel's Spider-Man", 'spider-man.exe', 'milesmorales.exe', 'spider-man2.exe'],
  ['Ghost of Tsushima', 'ghostoftsushima.exe'],
  ['Far Cry 6', 'farcry6.exe'],
  ['Far Cry 5', 'farcry5.exe'],
  ["Assassin's Creed", 'acvalhalla.exe', 'acmirage.exe', 'acshadows.exe', 'acodyssey.exe', 'acorigins.exe'],
];

/** Families of exe names (several versions, editions or anti-cheat builds). */
const KNOWN_RULES: [RegExp, string][] = [
  [/^fortniteclient-win64-shipping(_\w+)?\.exe$/, 'Fortnite'],
  [/^(\w+-)?cod\.exe$/, 'Call of Duty'],
  [/^gta5(_enhanced)?(_be)?\.exe$/, 'GTA V'],
  [/^fivem(_b\d+)?(_gtaprocess)?\.exe$/, 'FiveM'],
  [/^pathofexile(_x64)?(steam|_kg|egs)?\.exe$/, 'Path of Exile'],
  [/^factorygame(steam|egs)?-win64-shipping\.exe$/, 'Satisfactory'],
  [/^fc ?\d\d\.exe$/, 'EA Sports FC'],
  [/^fifa ?\d\d\.exe$/, 'FIFA'],
  [/^nba2k\d\d\.exe$/, 'NBA 2K'],
  [/^madden\d\d\.exe$/, 'Madden NFL'],
  [/^f1_?\d\d\.exe$/, 'F1'],
  [/^wwe2k\d\d(_x64)?\.exe$/, 'WWE 2K'],
];

/** Emulators: a game when one is in front (they also sit open with nothing running). */
const EMULATORS: [string, ...string[]][] = [
  ['RetroArch', 'retroarch.exe'],
  ['Dolphin', 'dolphin.exe'],
  ['Cemu', 'cemu.exe'],
  ['Ryujinx', 'ryujinx.exe'],
  ['Yuzu', 'yuzu.exe'],
  ['Citra', 'citra-qt.exe'],
  ['PCSX2', 'pcsx2-qt.exe', 'pcsx2.exe'],
  ['RPCS3', 'rpcs3.exe'],
  ['PPSSPP', 'ppssppwindows64.exe'],
  ['DuckStation', 'duckstation-qt-x64-releaseltcg.exe'],
  ['Xenia', 'xenia_canary.exe'],
  ['melonDS', 'melonds.exe'],
  ['mGBA', 'mgba.exe'],
  ['Project64', 'project64.exe'],
];

const byExe = (list: [string, ...string[]][]) => new Map(list.flatMap(([name, ...exes]) => exes.map((e) => [e, name] as const)));
const KNOWN = byExe(KNOWN_GAMES);
const EMULATOR = byExe(EMULATORS);

/** A popular game by its exe name alone, e.g. 'FortniteClient-Win64-Shipping.exe' -> 'Fortnite'. */
export function knownGame(exe: string): string | null {
  const e = exe.toLowerCase();
  return KNOWN.get(e) ?? KNOWN_RULES.find(([re]) => re.test(e))?.[1] ?? null;
}

// ---------------- Minecraft: Java Edition ----------------

const JAVA = /^javaw?\.exe$/i;
/** Java runs Minecraft: Java Edition (and other programs). */
export const isJava = (exe: string) => JAVA.test(exe);
/** "Minecraft 1.21.1", "Minecraft* 1.20.1 - Singleplayer", and the Lunar, Badlion and Feather clients. */
const MINECRAFT_TITLE = /^(minecraft\*?\s*\d|lunar client\b|badlion minecraft client|feather client\b)/i;
/** Java runtimes that Minecraft launchers bring along: only the game runs on them. */
const MINECRAFT_JAVA = /\\(\.minecraft|minecraft launcher|\.tlauncher|tlauncher|prismlauncher|multimc|polymc|modrinthapp|com\.modrinth\.theseus|curseforge\\minecraft|atlauncher|gdlauncher|\.lunarclient|\.feather|microsoft\.4297127d64ec6_8wekyb3d8bbwe)\\/i;
/** Whether a Java window is Minecraft's. */
export const minecraftTitle = (title: string) => MINECRAFT_TITLE.test(title.trim());

// ---------------- other games, by where they're installed ----------------

/** Folders games get installed into; the folder right after is the game's. */
const ROOTS: RegExp[] = [
  /\\steamapps\\common\\([^\\]+)\\/i,
  /\\epic games\\([^\\]+)\\/i,
  /\\riot games\\([^\\]+)\\/i,
  /\\gog galaxy\\games\\([^\\]+)\\/i,
  /\\gog games\\([^\\]+)\\/i,
  /\\ubisoft game launcher\\games\\([^\\]+)\\/i,
  /\\ea games\\([^\\]+)\\/i,
  /\\origin games\\([^\\]+)\\/i,
  /\\xboxgames\\([^\\]+)\\/i,
  /\\modifiablewindowsapps\\([^\\]+)\\/i,
  /\\rockstar games\\([^\\]+)\\/i,
  /\\amazon games\\library\\([^\\]+)\\/i,
  /\\itch\\apps\\([^\\]+)\\/i,
  /\\battle\.net\\([^\\]+)\\/i,
  /\\blizzard(?: entertainment)?\\([^\\]+)\\/i,
  /\\battlestate games\\([^\\]+)\\/i,
  /\\hoyoplay\\games\\([^\\]+)\\/i,
  /\\wargaming\.net\\games\\([^\\]+)\\/i,
];
/** Roblox's own folders and those of its popular bootstrappers, and the Store version. */
const ROBLOX = /\\(roblox|bloxstrap|fishstrap|voidstrap)\\versions\\|\\windowsapps\\robloxcorporation\.roblox/i;
/** Folders in those places that hold launchers, runtimes, tools and desktop toys rather than games. */
const NOT_GAME_FOLDER =
  /^(.*launcher.*|riot client|epic online services|directxredist|social club|steamworks shared|steamvr|steam controller configs|steamlinuxruntime.*|proton.*|ue_\d.*|unreal engine.*|wallpaper[_ ]engine|soundpad|obs studio|blender|aseprite|krita|vtube studio|displayfusion|lossless ?scaling|fl studio.*|rpg ?maker.*|gamemaker.*|godot.*|bongo ?cat|banana|egg|cats|desktop mate|vpet.*|3dmark.*|superposition.*|spacewar|virtual desktop|ovr toolkit|xsoverlay|fpsvr|voicemod.*|vegas.*|movavi.*|filmora.*|driver booster.*|rusty'?s retirement|spirit city.*|clip studio.*|live2d.*|battle\.net.*|agent|setup|installer|__installer|gamesave|redist.*|_commonredist)$/i;
/** Launchers, updaters, installers, crash reporters, anti-cheat, overlays, web helpers and tools that
 * live next to games or come with launchers (matched in exe names). */
const HELPER =
  /launcher|updat(e|er)|patcher|install|setup|uninst|unins\d|redist|prereq|dxsetup|dotnetfx|oalinst|physx|crash(report|handler|pad|sender|dump|upload)|bugsplat|bssndrpt|errorreport|reporter|sentry|helper|cefsharp|cefsub|cefprocess|webengine|webview|overlay|igoproxy|anticheat|beservice|battleye|start_protected_game|touchup|cleanup|dowser|activation|editor|server|dedicated|benchmark|config|settings|tool|studio|agent|service/i;
/** Game launchers: what they start (and isn't a helper) is a game. */
const LAUNCHERS = new Set([
  'steam.exe', 'epicgameslauncher.exe', 'battle.net.exe', 'riotclientservices.exe', 'eadesktop.exe', 'origin.exe', 'upc.exe', 'ubisoftconnect.exe',
  'galaxyclient.exe', 'amazongames.exe', 'itch.exe', 'playnite.desktopapp.exe', 'playnite.fullscreenapp.exe', 'heroic.exe',
]);
/** Programs that are never games: Windows itself, launchers and stores, and apps that can go full screen. */
const NOT_GAMES = new Set([
  'system', 'registry', 'smss.exe', 'csrss.exe', 'wininit.exe', 'winlogon.exe', 'services.exe', 'lsass.exe', 'svchost.exe', 'fontdrvhost.exe',
  'dwm.exe', 'explorer.exe', 'sihost.exe', 'taskhostw.exe', 'runtimebroker.exe', 'searchhost.exe', 'searchapp.exe', 'searchindexer.exe',
  'startmenuexperiencehost.exe', 'shellexperiencehost.exe', 'shellhost.exe', 'textinputhost.exe', 'ctfmon.exe', 'conhost.exe', 'openconsole.exe',
  'dllhost.exe', 'backgroundtaskhost.exe', 'systemsettings.exe', 'lockapp.exe', 'logonui.exe', 'widgets.exe', 'phoneexperiencehost.exe',
  'smartscreen.exe', 'securityhealthsystray.exe', 'msmpeng.exe', 'audiodg.exe', 'spoolsv.exe', 'wmiprvse.exe', 'taskmgr.exe', 'mmc.exe',
  'rundll32.exe', 'cmd.exe', 'powershell.exe', 'pwsh.exe', 'windowsterminal.exe', 'msedgewebview2.exe', 'snippingtool.exe', 'screenclippinghost.exe',
  'magnify.exe', 'notepad.exe', 'mspaint.exe', 'calculatorapp.exe', 'photos.exe', 'microsoft.photos.exe', 'mstsc.exe', 'msrdc.exe', 'vmconnect.exe',
  'steam.exe', 'steamwebhelper.exe', 'epicgameslauncher.exe', 'battle.net.exe', 'riotclientservices.exe', 'riotclientux.exe', 'riotclientuxrender.exe',
  'leagueclient.exe', 'leagueclientux.exe', 'leagueclientuxrender.exe', 'eadesktop.exe', 'origin.exe', 'upc.exe', 'ubisoftconnect.exe',
  'galaxyclient.exe', 'amazongames.exe', 'itch.exe', 'playnite.desktopapp.exe', 'playnite.fullscreenapp.exe', 'heroic.exe', 'xboxpcapp.exe',
  'gamingservices.exe', 'gamebar.exe', 'minecraftlauncher.exe', 'robloxplayerlauncher.exe', 'robloxstudiobeta.exe', 'curseforge.exe',
  'overwolf.exe', 'medal.exe', 'code.exe', 'cursor.exe', 'devenv.exe', 'notepad++.exe', 'sublime_text.exe', 'winword.exe', 'excel.exe',
  'powerpnt.exe', 'outlook.exe', 'olk.exe', 'onenote.exe', 'ms-teams.exe', 'teams.exe', 'zoom.exe', 'slack.exe', 'discord.exe', 'discordptb.exe',
  'discordcanary.exe', 'telegram.exe', 'whatsapp.exe', 'notion.exe', 'obsidian.exe', 'figma.exe', 'photoshop.exe', 'illustrator.exe',
  'afterfx.exe', 'adobe premiere pro.exe', 'acrobat.exe', 'acrord32.exe', 'blender.exe', 'krita.exe', 'clipstudiopaint.exe', 'paintdotnet.exe',
  'obs64.exe', 'streamlabs desktop.exe', 'sharex.exe', 'greenshot.exe', 'lightshot.exe', 'anydesk.exe', 'teamviewer.exe', 'parsecd.exe',
  'vmware.exe', 'virtualboxvm.exe', 'wallpaper32.exe', 'wallpaper64.exe', 'losslessscaling.exe', 'soundpad.exe', 'nvidia app.exe',
  'nvidia overlay.exe', 'nvcontainer.exe', 'radeonsoftware.exe', 'lghub.exe', 'icue.exe', 'onedrive.exe', 'hatchling.exe',
]);
/** Windows' own folder, and Microsoft's Store apps (Photos, Paint, Terminal...) apart from its card games. */
const SYSTEM_PATH = /^[a-z]:\\windows\\|\\windowsapps\\microsoft\.(?!microsoft(solitaire|mahjong|minesweeper))/i;

const stem = (exe: string) => exe.replace(/\.exe$/i, '');

/** Never a game: part of Windows, a launcher, a helper that comes with a game, or a known app. */
export function neverGame(exe: string, path = ''): boolean {
  const e = exe.toLowerCase();
  return NOT_GAMES.has(e) || HELPER.test(stem(e)) || e.endsWith('.scr') || SYSTEM_PATH.test(path);
}

/** The game folder an exe is in (under Steam's steamapps\common and the like): its name, '' for a
 * folder there that isn't a game (a launcher, a runtime, a tool), or null when it's somewhere else. */
export function gameFolder(path: string): string | null {
  for (const re of ROOTS) {
    const m = re.exec(path);
    if (m) return NOT_GAME_FOLDER.test(m[1].trim()) ? '' : m[1].trim();
  }
  return null;
}

/**
 * What game a program is, from its exe name, where it's installed and the launcher that started it
 * (`parent`: the exe name of its parent process). With a window `title` (its window in front), Java
 * windows can be told to be Minecraft and a game can get its name from its title.
 * Returns 'unknown' for a program that isn't known either way (it may be a game if it runs full
 * screen), null for one that's never a game.
 */
export function classifyGame(exe: string, title = '', path = '', parent = ''): GameGuess | 'unknown' | null {
  const e = exe.toLowerCase();
  const known = knownGame(e);
  if (known) return { name: known, sure: true };
  const emulator = EMULATOR.get(e);
  if (emulator) return { name: emulator, sure: false };
  if (isJava(e)) return MINECRAFT_JAVA.test(path) || minecraftTitle(title) ? { name: 'Minecraft', sure: true } : 'unknown';
  if (neverGame(e, path)) return null;
  if (ROBLOX.test(path)) return { name: 'Roblox', sure: false };
  const folder = gameFolder(path);
  if (folder === '') return null;
  if (folder !== null || LAUNCHERS.has(parent.toLowerCase())) return { name: gameName(title, fileName(path) || exe, folder ?? ''), sure: false };
  return 'unknown';
}

/** The file name at the end of a path, as written (process lists give exe names in lower case). */
export const fileName = (path: string) => path.slice(path.lastIndexOf('\\') + 1);

// ---------------- names ----------------

const letters = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

/** The name for a game that isn't in the list: its folder's name (window titles can be odd: Palworld's
 * says "Pal", Terraria's a random joke), unless the title is that name spelled nicely ("GarrysMod" ->
 * "Garry's Mod"); with no folder, the title, else the exe name. */
export function gameName(title: string, exe: string, folder = ''): string {
  const t = gameTitle(title);
  if (folder) return t && letters(t) === letters(folder) ? t : tidyName(folder);
  return t ?? tidyName(exe);
}

/** A game's name from its window title, or null when the title doesn't look like a name
 * ("Factorio 2.0.15" -> "Factorio", "ELDEN RING™" -> "ELDEN RING", "Loading..." -> null). */
export function gameTitle(title: string): string | null {
  const t = title
    .replace(/[™®©]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/ \(Not Responding\)$/i, '')
    // Versions and builds: "Kenshi 1.0.64 - x64 (Newland)", "Game v1.2", "Game - Build 12345".
    .replace(/\s*[-–—|:(]?\s*(\b(v|ver|version|build)\.?\s*)?\d+(\.\d+){1,3}[a-z]?\b.*$/i, '')
    .replace(/\s*[-–—|:(]?\s*\bbuild\s*\d+\)?$/i, '')
    .replace(/\s*[([]?(x64|x86|64-?bit|32-?bit|dx\s?1[12]|directx\s?1[12]|vulkan|opengl|d3d1[12])[)\]]?$/i, '')
    .replace(/\s*[-–—|:(]\s*(early access|alpha|beta|demo|playtest)\)?$/i, '')
    .replace(/[\s\-–—|:]+$/, '')
    .trim();
  if (t.length < 2 || t.length > 40) return null;
  if (/launcher|loading|updat|setup|install|error|splash|^(game|window|main|default|unity|unreal|direct3d|opengl|vulkan|untitled|program|application)( window)?$/i.test(t)) return null;
  return t;
}

/** A readable name from a folder or exe name: "hollow_knight.exe" -> "Hollow Knight",
 * "BlackMythWukong" -> "Black Myth Wukong", "SomeGame-Win64-Shipping.exe" -> "Some Game". */
export function tidyName(raw: string): string {
  let s = stem(raw.trim())
    .replace(/-win(64|32|gdk)-(shipping|test|development)$/i, '')
    .replace(/([-_ ](x64|x86|win64|win32|dx1[12]|vulkan|steam|egs|epic|gog|release|final|retail|be|eac))+$/i, '')
    .replace(/_+/g, ' ')
    .trim();
  // "Cities.Skylines" but not "L.A. Noire" or "R.E.P.O".
  if (!s.includes(' ')) s = s.replace(/\.(?=\p{L}{2})/gu, ' ');
  s = s.replace(/\s+/g, ' ');
  if (/^[A-Z]/.test(s) && !s.includes(' ')) s = s.replace(/([a-z])([A-Z])/g, '$1 $2');
  if (s === s.toLowerCase()) s = s.replace(/(^|\s)[a-z]/g, (c) => c.toUpperCase());
  return s || raw;
}
