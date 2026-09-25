// UI sounds for the panel window (placeholder: being replaced by the synth in src/audio).

import type { UiSound, Voice } from '../audio/types';

let enabled = true;
let volume = 0.5;

export const sfx = {
  /** Follows the Sounds setting and volume. */
  configure(on: boolean, vol: number) {
    enabled = on;
    volume = vol;
  },
  play(name: UiSound) {
    void name;
    void enabled;
    void volume;
  },
  /** Plays a species' call, e.g. when choosing its egg. `growth` 0 = hatchling, 1 = adult. */
  call(voice: Voice, growth: number) {
    void voice;
    void growth;
  },
};
