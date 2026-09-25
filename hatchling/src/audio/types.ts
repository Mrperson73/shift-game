// Names and voice settings shared by the pet's sounds (overlay) and the panel's UI sounds.

/** The character of a species' calls. */
export type VoiceKind = 'roar' | 'screech' | 'honk' | 'bellow' | 'hoot' | 'trill';

export interface Voice {
  /** Base pitch in Hz for an adult; hatchlings are about an octave higher. */
  pitch: number;
  /** 0..1 how growly (noise) versus tonal the calls are. */
  growl: number;
  kind: VoiceKind;
}

/** Sounds the pet makes. All are synthesized; there are no audio files. */
export type SoundName =
  | 'call' // short signature call of the species (idle vocalising)
  | 'roar' // big signature call (game starts, growing up, showing off)
  | 'chirp' // small friendly noise (poked, hello)
  | 'growl' // annoyed
  | 'happy' // happy trill
  | 'purr' // being petted
  | 'crunch' // a bite of food
  | 'gulp' // finished a meal
  | 'yawn'
  | 'snore'
  | 'sneeze'
  | 'squeak' // picked up
  | 'boing' // thrown, ball bounce
  | 'thud' // hard landing
  | 'step' // one footstep (big adults, running)
  | 'crack' // egg crack
  | 'hatch'
  | 'grow' // reached a new growth stage
  | 'whoosh' // jump, pounce
  | 'pop' // food or ball appears
  | 'sniff';

/** Sounds of the panel window's UI. */
export type UiSound = 'click' | 'toggle' | 'tab' | 'select' | 'hatch' | 'open' | 'error' | 'coin';

export const SOUND_NAMES: SoundName[] = ['call', 'roar', 'chirp', 'growl', 'happy', 'purr', 'crunch', 'gulp', 'yawn', 'snore', 'sneeze', 'squeak', 'boing', 'thud', 'step', 'crack', 'hatch', 'grow', 'whoosh', 'pop', 'sniff'];
export const UI_SOUNDS: UiSound[] = ['click', 'toggle', 'tab', 'select', 'hatch', 'open', 'error', 'coin'];
