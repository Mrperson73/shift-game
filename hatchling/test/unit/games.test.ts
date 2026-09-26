import { describe, expect, it } from 'vitest';
import { classifyGame, gameFolder, gameName, gameTitle, knownGame, minecraftTitle, neverGame, tidyName } from '../../src/main/games';

const steam = (folder: string, exe: string) => `D:\\SteamLibrary\\steamapps\\common\\${folder}\\${exe}`;

describe('knownGame', () => {
  it('knows popular games by exe name, whatever the case', () => {
    const cases: [string, string][] = [
      ['FortniteClient-Win64-Shipping.exe', 'Fortnite'],
      ['FortniteClient-Win64-Shipping_EAC_EOS.exe', 'Fortnite'],
      ['Minecraft.Windows.exe', 'Minecraft'],
      ['RobloxPlayerBeta.exe', 'Roblox'],
      ['VALORANT-Win64-Shipping.exe', 'Valorant'],
      ['League of Legends.exe', 'League of Legends'],
      ['cs2.exe', 'Counter-Strike 2'],
      ['dota2.exe', 'Dota 2'],
      ['r5apex_dx12.exe', 'Apex Legends'],
      ['Overwatch.exe', 'Overwatch 2'],
      ['RocketLeague.exe', 'Rocket League'],
      ['GTA5.exe', 'GTA V'],
      ['GTA5_Enhanced.exe', 'GTA V'],
      ['eldenring.exe', 'Elden Ring'],
      ['TheIsleClient-Win64-Shipping.exe', 'The Isle'],
      ['TheIsle-Win64-Shipping.exe', 'The Isle'],
      ['Brawlhalla.exe', 'Brawlhalla'],
      ['Terraria.exe', 'Terraria'],
      ['Among Us.exe', 'Among Us'],
      ['GenshinImpact.exe', 'Genshin Impact'],
      ['cod.exe', 'Call of Duty'],
      ['sp23-cod.exe', 'Call of Duty'],
      ['TslGame.exe', 'PUBG: Battlegrounds'],
      ['RustClient.exe', 'Rust'],
      ['ArkAscended.exe', 'ARK: Survival Ascended'],
      ['Palworld-Win64-Shipping.exe', 'Palworld'],
      ['Lethal Company.exe', 'Lethal Company'],
      ['FallGuys_client_game.exe', 'Fall Guys'],
      ['Stardew Valley.exe', 'Stardew Valley'],
      ['TS4_x64.exe', 'The Sims 4'],
      ['Cyberpunk2077.exe', 'Cyberpunk 2077'],
      ['bg3_dx11.exe', "Baldur's Gate 3"],
      ['helldivers2.exe', 'Helldivers 2'],
      ['Marvel-Win64-Shipping.exe', 'Marvel Rivals'],
      ['FC25.exe', 'EA Sports FC'],
      ['PathOfExile_x64Steam.exe', 'Path of Exile'],
      ['FactoryGameSteam-Win64-Shipping.exe', 'Satisfactory'],
      ['PathOfTitans-Win64-Shipping.exe', 'Path of Titans'],
    ];
    for (const [exe, name] of cases) expect(knownGame(exe), exe).toBe(name);
  });

  it("doesn't know launchers, helpers or apps", () => {
    const exes = ['steam.exe', 'EpicGamesLauncher.exe', 'RiotClientServices.exe', 'LeagueClient.exe', 'Battle.net.exe', 'RobloxPlayerLauncher.exe', 'RobloxStudioBeta.exe', 'MinecraftLauncher.exe', 'FortniteLauncher.exe', 'brawlhallaeac.exe', 'javaw.exe', 'chrome.exe', 'Code.exe', 'Discord.exe', 'explorer.exe', 'EasyAntiCheat.exe'];
    for (const exe of exes) expect(knownGame(exe), exe).toBeNull();
  });
});

describe('classifyGame', () => {
  it('counts known games as soon as they run', () => {
    expect(classifyGame('Brawlhalla.exe', '', steam('Brawlhalla', 'Brawlhalla.exe'))).toEqual({ name: 'Brawlhalla', sure: true });
    expect(classifyGame('RobloxPlayerBeta.exe', '', 'C:\\Users\\Kid\\AppData\\Local\\Bloxstrap\\Versions\\version-4f2b1e\\RobloxPlayerBeta.exe')).toEqual({ name: 'Roblox', sure: true });
  });

  it('finds any other game by where launchers install games (it counts once its window is in front)', () => {
    const cases: [string, string, string][] = [
      ['RainWorld.exe', steam('Rain World', 'RainWorld.exe'), 'Rain World'],
      ['ULTRAKILL.exe', 'C:\\Program Files (x86)\\Steam\\steamapps\\common\\ULTRAKILL\\ULTRAKILL.exe', 'ULTRAKILL'],
      ['hl2.exe', steam('GarrysMod', 'hl2.exe'), 'Garrys Mod'],
      ['dotnet.exe', steam('tModLoader', 'dotnet\\8.0.0\\dotnet.exe'), 'tModLoader'],
      ['KingdomTwoCrowns.exe', 'C:\\Program Files\\Epic Games\\Kingdom Two Crowns\\KingdomTwoCrowns.exe', 'Kingdom Two Crowns'],
      ['2XKO.exe', 'C:\\Riot Games\\2XKO\\live\\2XKO.exe', '2XKO'],
      ['disco.exe', 'C:\\Program Files (x86)\\GOG Galaxy\\Games\\Disco Elysium\\disco.exe', 'Disco Elysium'],
      ['Trackmania.exe', 'C:\\Program Files (x86)\\Ubisoft\\Ubisoft Game Launcher\\games\\Trackmania\\Trackmania.exe', 'Trackmania'],
      ['NeedForSpeedUnbound.exe', 'C:\\Program Files\\EA Games\\Need for Speed Unbound\\NeedForSpeedUnbound.exe', 'Need for Speed Unbound'],
      ['Maine-WinGDK-Shipping.exe', 'C:\\XboxGames\\Grounded\\Content\\Maine-WinGDK-Shipping.exe', 'Grounded'],
      ['LANoire.exe', 'C:\\Program Files\\Rockstar Games\\L.A. Noire\\LANoire.exe', 'L.A. Noire'],
      ['Windows10Universal.exe', 'C:\\Program Files\\WindowsApps\\ROBLOXCORPORATION.ROBLOX_2.646.655.0_x64__55nm5eh3cm0pr\\Windows10Universal.exe', 'Roblox'],
    ];
    for (const [exe, path, name] of cases) expect(classifyGame(exe, '', path), path).toEqual({ name, sure: false });
  });

  it('names a game after its window title when that is its folder spelled nicely', () => {
    expect(classifyGame('hl2.exe', "Garry's Mod", steam('GarrysMod', 'hl2.exe'))).toEqual({ name: "Garry's Mod", sure: false });
    expect(classifyGame('slaythespire.exe', 'Slay the Spire', steam('SlayTheSpire', 'SlayTheSpire.exe'))).toEqual({ name: 'Slay the Spire', sure: false });
    // Odd titles lose to the folder: a codename, a joke, a version.
    expect(classifyGame('Pal-Win64-Shipping.exe', 'Pal', steam('Palworld', 'Pal\\Binaries\\Win64\\Pal-Win64-Shipping.exe'))).toEqual({ name: 'Palworld', sure: false });
    expect(classifyGame('dotnet.exe', 'Terraria: Also try Minecraft!', steam('tModLoader', 'dotnet\\dotnet.exe'))).toEqual({ name: 'tModLoader', sure: false });
    expect(classifyGame('RainWorld.exe', 'Rain World 1.9.15', steam('Rain World', 'RainWorld.exe'))).toEqual({ name: 'Rain World', sure: false });
  });

  it('finds games a launcher started, wherever they are installed', () => {
    expect(classifyGame('tinyglade.exe', 'Tiny Glade', 'E:\\Games\\Tiny Glade\\tinyglade.exe', 'EpicGamesLauncher.exe')).toEqual({ name: 'Tiny Glade', sure: false });
    expect(classifyGame('SomeGame-Win64-Shipping.exe', '', 'E:\\Games\\SomeGame\\SomeGame-Win64-Shipping.exe', 'Battle.net.exe')).toEqual({ name: 'Some Game', sure: false });
    // ...but not their helpers.
    expect(classifyGame('steamwebhelper.exe', '', 'C:\\Program Files (x86)\\Steam\\bin\\cef\\cef.win7x64\\steamwebhelper.exe', 'steam.exe')).toBeNull();
    expect(classifyGame('cmd.exe', '', 'C:\\Windows\\System32\\cmd.exe', 'steam.exe')).toBeNull();
  });

  it('leaves out launchers, helpers, tools and things that live next to games', () => {
    const paths = [
      'C:\\Program Files (x86)\\Steam\\steam.exe',
      steam('Steamworks Shared', '_CommonRedist\\vcredist\\2022\\VC_redist.x64.exe'),
      steam('Some Game', '_CommonRedist\\DirectX\\Jun2010\\DXSETUP.exe'),
      steam('Some Game', 'UnityCrashHandler64.exe'),
      steam('Some Game', 'Engine\\Binaries\\Win64\\CrashReportClient.exe'),
      steam('Some Game', 'EasyAntiCheat\\EasyAntiCheat_EOS_Setup.exe'),
      steam('Some Game', 'start_protected_game.exe'),
      steam('Some Game', 'SomeGameLauncher.exe'),
      steam('wallpaper_engine', 'wallpaper64.exe'),
      steam('SteamVR', 'bin\\win64\\vrmonitor.exe'),
      steam('Lossless Scaling', 'LosslessScaling.exe'),
      steam('Bongo Cat', 'BongoCat.exe'),
      'C:\\Program Files (x86)\\Epic Games\\Launcher\\Portal\\Binaries\\Win64\\EpicGamesLauncher.exe',
      'C:\\Program Files (x86)\\Epic Games\\Launcher\\Portal\\Extras\\Overlay\\EOSOverlayRenderer-Win64-Shipping.exe',
      'C:\\Program Files\\Epic Games\\UE_5.4\\Engine\\Binaries\\Win64\\UnrealEditor.exe',
      'C:\\Riot Games\\Riot Client\\RiotClientServices.exe',
      'C:\\Riot Games\\League of Legends\\LeagueClient.exe',
      'C:\\XboxGames\\Minecraft Launcher\\Content\\Minecraft.exe',
      'C:\\Program Files\\EA Games\\Battlefield 2042\\__Installer\\Touchup.exe',
      'C:\\Program Files (x86)\\Battle.net\\Battle.net.13845\\Battle.net.exe',
      'C:\\ProgramData\\Battle.net\\Agent\\Agent.9175\\Agent.exe',
      'C:\\Users\\A\\AppData\\Local\\Roblox\\Versions\\version-4f2b1e\\RobloxStudioBeta.exe',
      'C:\\Users\\A\\AppData\\Local\\Discord\\app-1.0.9170\\Discord.exe',
      'C:\\Users\\A\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe',
      'C:\\Windows\\System32\\notepad.exe',
      'C:\\Windows\\System32\\mstsc.exe',
      'C:\\Program Files\\WindowsApps\\Microsoft.Windows.Photos_2024.11050.3002.0_x64__8wekyb3d8bbwe\\Photos.exe',
    ];
    for (const path of paths) expect(classifyGame(path.slice(path.lastIndexOf('\\') + 1), '', path), path).toBeNull();
  });

  it('calls anything else unknown (a game only if it stays full screen)', () => {
    expect(classifyGame('thing.exe', '', 'C:\\Program Files\\Some Vendor\\Thing\\thing.exe')).toBe('unknown');
    expect(classifyGame('Solitaire.exe', '', 'C:\\Program Files\\WindowsApps\\Microsoft.MicrosoftSolitaireCollection_4.20.6070.0_x64__8wekyb3d8bbwe\\Solitaire.exe')).toBe('unknown');
    expect(classifyGame('CrashBandicoot4.exe', '', 'E:\\Games\\Crash 4\\CrashBandicoot4.exe')).toBe('unknown');
  });

  it("tells Minecraft: Java Edition by its launcher's Java or its window title", () => {
    const official = 'C:\\Users\\A\\AppData\\Roaming\\.minecraft\\runtime\\java-runtime-gamma\\windows-x64\\java-runtime-gamma\\bin\\javaw.exe';
    const store = 'C:\\Users\\A\\AppData\\Local\\Packages\\Microsoft.4297127D64EC6_8wekyb3d8bbwe\\LocalCache\\Local\\runtime\\java-runtime-delta\\windows-x64\\java-runtime-delta\\bin\\javaw.exe';
    const prism = 'C:\\Users\\A\\AppData\\Roaming\\PrismLauncher\\java\\java-runtime-delta\\bin\\javaw.exe';
    const system = 'C:\\Program Files\\Eclipse Adoptium\\jdk-21.0.2.13-hotspot\\bin\\javaw.exe';
    for (const path of [official, store, prism]) expect(classifyGame('javaw.exe', '', path), path).toEqual({ name: 'Minecraft', sure: true });
    expect(classifyGame('javaw.exe', '', system)).toBe('unknown');
    expect(classifyGame('javaw.exe', 'Minecraft* 1.21.4 - Singleplayer', system)).toEqual({ name: 'Minecraft', sure: true });
    expect(classifyGame('java.exe', 'IntelliJ IDEA', system)).toBe('unknown');
  });
});

describe('minecraftTitle', () => {
  it("matches the game's window, not the launcher, server or modding tools", () => {
    for (const t of ['Minecraft 1.21.1', 'Minecraft* 1.20.1 - Singleplayer', 'Minecraft 1.21.1 - Multiplayer (3rd-party Server)', 'Lunar Client (1.8.9-4a1b2c3/master)', 'Badlion Minecraft Client v4.2.0 (1.8.9)'])
      expect(minecraftTitle(t), t).toBe(true);
    for (const t of ['Minecraft server', 'Minecraft Launcher', 'MCreator 2024.1', 'IntelliJ IDEA']) expect(minecraftTitle(t), t).toBe(false);
  });
});

describe('gameFolder', () => {
  it('finds the game folder under each kind of install folder', () => {
    expect(gameFolder(steam('Hollow Knight', 'hollow_knight.exe'))).toBe('Hollow Knight');
    expect(gameFolder('C:\\Program Files\\Epic Games\\Fortnite\\FortniteGame\\Binaries\\Win64\\FortniteClient-Win64-Shipping.exe')).toBe('Fortnite');
    expect(gameFolder('C:\\Program Files (x86)\\Epic Games\\Launcher\\Portal\\Binaries\\Win64\\EpicGamesLauncher.exe')).toBe('');
    expect(gameFolder('C:\\Program Files\\Some Vendor\\app.exe')).toBeNull();
    expect(gameFolder('')).toBeNull();
  });
});

describe('neverGame', () => {
  it('is true for Windows, launchers, helpers and apps', () => {
    for (const exe of ['svchost.exe', 'explorer.exe', 'steamwebhelper.exe', 'UnityCrashHandler64.exe', 'CrashReportClient.exe', 'EasyAntiCheat_EOS.exe', 'BEService.exe', 'vc_redist.x64.exe', 'UE4PrereqSetup_x64.exe', 'QtWebEngineProcess.exe', 'start_protected_game.exe', 'Ribbons.scr', 'Discord.exe', 'POWERPNT.EXE'])
      expect(neverGame(exe), exe).toBe(true);
    expect(neverGame('game.exe', 'C:\\Windows\\System32\\game.exe')).toBe(true);
  });

  it('is false for things that may be games', () => {
    for (const exe of ['CrashBandicoot4.exe', 'hl2.exe', 'dotnet.exe', 'Game.exe', 'javaw.exe']) expect(neverGame(exe), exe).toBe(false);
  });
});

describe('names', () => {
  it('takes game names from window titles when they look like names', () => {
    expect(gameTitle('ELDEN RING™')).toBe('ELDEN RING');
    expect(gameTitle('Factorio 2.0.15')).toBe('Factorio');
    expect(gameTitle('Kenshi 1.0.64 - x64 (Newland)')).toBe('Kenshi');
    expect(gameTitle('Starbound - Beta v. 1.4.4')).toBe('Starbound');
    expect(gameTitle('Some Game (DX12)')).toBe('Some Game');
    expect(gameTitle('Some Game - Early Access')).toBe('Some Game');
    expect(gameTitle('Hades II')).toBe('Hades II');
    expect(gameTitle('Cyberpunk 2077')).toBe('Cyberpunk 2077');
    expect(gameTitle('Crash Bandicoot 4')).toBe('Crash Bandicoot 4');
    expect(gameTitle('Rain World (Not Responding)')).toBe('Rain World');
    for (const t of ['', 'x', 'Loading...', 'Launcher', 'Game Launcher', 'Unity', 'Game', 'A title that is much too long to be the name of any game']) expect(gameTitle(t), t).toBeNull();
  });

  it('prefers a folder name to an odd title, and falls back to the exe name', () => {
    expect(gameName("Garry's Mod", 'hl2.exe', 'GarrysMod')).toBe("Garry's Mod");
    expect(gameName('Pal', 'palworld-win64-shipping.exe', 'Palworld')).toBe('Palworld');
    expect(gameName('Tiny Glade', 'tinyglade.exe')).toBe('Tiny Glade');
    expect(gameName('', 'hollow_knight.exe')).toBe('Hollow Knight');
    expect(gameName('Loading...', 'SuperGame.exe')).toBe('Super Game');
  });

  it('tidies folder and exe names', () => {
    const cases: [string, string][] = [
      ['hollow_knight.exe', 'Hollow Knight'],
      ['BlackMythWukong', 'Black Myth Wukong'],
      ['SomeGame-Win64-Shipping.exe', 'Some Game'],
      ['Maine-WinGDK-Shipping.exe', 'Maine'],
      ['Game_x64.exe', 'Game'],
      ['tModLoader', 'tModLoader'],
      ['ELDEN RING', 'ELDEN RING'],
      ['Cities_Skylines', 'Cities Skylines'],
      ['L.A. Noire', 'L.A. Noire'],
      ['R.E.P.O', 'R.E.P.O'],
      ['2XKO', '2XKO'],
    ];
    for (const [raw, name] of cases) expect(tidyName(raw), raw).toBe(name);
  });
});
