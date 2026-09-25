# Hatchling

**A dinosaur that lives on your desktop and grows up with you.**

Pick an egg, click it on your taskbar, and a baby dinosaur hatches. It walks along your taskbar, climbs the sides of your windows and wanders along their tops. It naps when you step away and gets excited when you launch a game. It grows from a big-headed hatchling to an adult over a few weeks of real use.

It runs fully offline. No account, no internet, no tracking.

## Install (Windows)

1. Download `Hatchling-Setup-x.y.z.exe` from the repository's **Releases** page.
2. Double-click it. It installs for your Windows user only, with no questions and no admin prompt, then opens Hatchling.
3. Windows may say *"Windows protected your PC"* because the app isn't code-signed. Click **More info → Run anyway**.

To uninstall, go to **Settings → Apps → Installed apps → Hatchling**. This also removes the start-with-Windows entry. Your pet's save file stays in `%APPDATA%\Hatchling` in case you reinstall.

## Your pet

| Species | | |
| --- | --- | --- |
| **Rex** (*Tyrannosaurus*) | Bold and loud | Loves meat, roars when it's grown up |
| **Raptor** (*Utahraptor*) | Fast, curious, jumpy | Chases your cursor, climbs the most |
| **Pachy** (*Pachycephalosaurus*) | Calm and stubborn | Loves leaves; has a very hard head |

Each species has four colours. You pick one when you choose the egg.

**Growing up.** Your pet grows only while you're actually at your PC: time you're idle or locked doesn't count. It goes hatchling → juvenile → sub-adult → adult, like in The Isle. That takes about 60 hours together, a few weeks at normal use. It gets bigger, and its proportions change from baby (big head, big eyes, stubby legs) to adult.

**What it does on its own.** It walks, runs and sits along the taskbar and on windows, looks at your cursor, sniffs around, chases its tail and has the zoomies. It climbs up the sides of windows, walks along the tops, and rides along if you drag a window it's standing on. It naps when it's tired, and it gets sleepy at night.

**Reacting to you.**

- It falls asleep when you're away for 5 minutes or lock your PC, and stretches and greets you when you're back.
- When **The Isle**, **Brawlhalla** or **Minecraft** starts, it roars and wishes you luck. When the game closes, it welcomes you back.
- It hides by itself while a full-screen game, video or presentation is in front, so it never gets in your way. It comes back when you leave full screen.

## Things you can do

| | |
| --- | --- |
| **Click** it | It looks at you (poke it too often and it gets grumpy) |
| **Rub** it with your cursor | Petting: hearts, happy eyes, tail wag |
| **Drag** it | Pick it up; let go to drop it, or flick to throw it (it lands a bit dizzy) |
| **Double-click** it | Opens its card: growth, mood, energy, hunger and stats |
| **Right-click** it, or the tray icon | Feed, play ball, come here, nap, wake up, hide for an hour, settings |

**Feed** drops food near it. It finds the food, climbing to it if needed. **Play ball** gives it a ball to chase and kick; you can throw the ball too. The pet never gets sick and never dies. Food and play just make it happier.

## Settings

- Size (small, medium, large) and energy level (calm, normal, lively)
- Sounds and volume. The sounds are small synthesized chirps and roars, deeper as it grows.
- Speech: off, emotes only (hearts, zzz, !), or chatty (short lines)
- Climb and walk on windows. When this is off, it stays on the taskbar.
- Hide during full-screen apps, react to games, start with Windows
- Which screen it lives on, if you have more than one

## Custom species

Add your own dinosaurs as small JSON files in `Documents\Hatchling\species`. To create the folder, use **Settings → Open species folder**. It includes a guide and a complete example (a Carnotaurus).

A species starts from Rex, Raptor or Pachy and can change:

- proportions (head, tail, legs, arms, neck and more)
- features (horns, a sail, back spikes, crest feathers, a dome, teeth)
- personality, colours, voice, and what it says

Hatchling reloads the folder when files change, and new species appear as eggs. Species files are data only and can't run code. A broken file shows a clear error in Settings instead of crashing anything.

Tip: give an AI the `README.txt` from that folder and ask for "a Hatchling species JSON for a Spinosaurus".

## Privacy and safety

- **No network.** Hatchling never connects to the internet. Every web request is blocked inside the app, and there's no telemetry or auto-updater.
- **What it reads on Windows** (to find window edges, notice full-screen apps and recognise games):
  - the position and size of visible windows;
  - which window is in front;
  - the names of running programs, the same list Task Manager shows.

  It doesn't inject into other programs, read their memory, hook your keyboard or mouse, or record your screen. None of this is saved or sent anywhere.
- **Idle detection** uses only "seconds since your last input" from Windows, never which keys you pressed.
- **Your data** lives in `%APPDATA%\Hatchling\hatchling.json`: your pet, your settings and past pets. Saves are atomic and keep a backup copy, so a crash or power cut can't corrupt your pet.

## Checking a download

Every Windows build is tested before it's published. CI installs it on a clean Windows machine, then runs `Hatchling.exe --smoke-test`. That test:

- hatches, feeds, throws and naps a pet in the real overlay;
- checks that the drawing and the Windows integration work;
- quits. CI then uninstalls the app.

Checksums (`SHA256SUMS-*.txt`) and a signed [build provenance attestation](https://docs.github.com/actions/security-for-github-actions/using-artifact-attestations) come with each build: `gh attestation verify Hatchling-Setup-1.0.0.exe -R Mrperson73/shift-game`.

## Limitations

- Made for Windows 10 and 11. The Linux build works but uses only the bottom of the screen, since window climbing and game detection are Windows-only.
- It hides during full-screen apps, so you won't see it over games. Over windowed (not full-screen) games it stays visible.
- It lives on one screen at a time; choose which one in Settings.
- Clicks land on the pet only when the cursor is exactly over it. Everywhere else, clicks go straight through to your windows.

## Build from source

Requires Node.js 22+.

```bash
cd hatchling
npm install
npm start            # build and run
npm test             # unit tests (vitest)
npm run test:e2e     # end-to-end tests against the real app (Playwright)
npm run dist:win     # Windows installer + portable zip → release/
npm run dist:linux   # Linux AppImage → release/
```

`node scripts/sheet.mjs rex` renders every pose at every growth stage to `shots/`, for checking the art.

## How it's built

- `src/pet`: species data, growth, a procedural 2D rig (spine, tail springs, two-bone leg IK with planted feet, blinking, poses), and the cartoon renderer. There are no image files: every frame is drawn.
- `src/sim`: the pet's life, as pure logic with unit tests. It covers physics, routes across platforms (walk, drop, jump, climb), behaviours, needs and growth.
- `src/overlay`: a transparent, click-through window over your work area that runs the simulation, draws the pet and handles the mouse.
- `src/main`: Electron main process. It handles the tray, the panel window, saving, species mods, and a small read-only Win32 layer (`desktop.ts`, via [koffi](https://koffi.dev)) for window positions, full-screen detection and the process list.
- `src/panel`: the egg chooser, pet card and settings (Preact).
