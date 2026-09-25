// UI sounds for the panel window, plus a species' call (egg chooser, clicking the pet). Uses the synth
// in src/audio with its own lazily created context, released a few seconds after the last sound.

import { Engine } from '../audio/engine';
import type { UiSound, Voice } from '../audio/types';
import { uiSound } from '../audio/ui';
import { petSound } from '../audio/voices';

const engine = new Engine({ idleMs: 4000, maxVoices: 8 });

export const sfx = {
  /** Follows the Sounds setting and volume. */
  configure(on: boolean, vol: number) {
    engine.enabled = on;
    engine.volume = vol;
  },
  play(name: UiSound) {
    engine.play((p) => uiSound(p, name), { droppable: true, key: name });
  },
  /** Plays a species' call, e.g. when choosing its egg. `growth` 0 = hatchling, 1 = adult. */
  call(voice: Voice, growth: number) {
    const g = Number.isFinite(growth) ? Math.min(1, Math.max(0, growth)) : 0;
    engine.play((p) => petSound(p, 'call', voice, g, 0.8));
  },
};
