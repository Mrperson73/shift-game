// Named poses the behaviours use. Each sets a target pose; the rig eases into it.

import { NEUTRAL, type EyeState, type LegMode, type Pose, type Rig } from './rig';

export interface PoseDef {
  pose: Partial<Pose>;
  eyes: EyeState;
  legs: LegMode;
}

export const POSES = {
  stand: { pose: {}, eyes: 'open', legs: 'gait' },
  alert: { pose: { neck: 0.25, head: 0.1, tailLift: 0.1 }, eyes: 'open', legs: 'gait' },
  sit: { pose: { hipDrop: 0.5, pitch: 0.32, neck: 0.1, tailCurl: 0.025, arms: 0.1 }, eyes: 'open', legs: 'fold' },
  lie: { pose: { hipDrop: 1, pitch: -0.08, abs: 1, neckAbs: 0.15, headAbs: -0.12, tailLift: -0.25 }, eyes: 'open', legs: 'fold' },
  sleep: { pose: { hipDrop: 1, pitch: -0.06, abs: 1, neckAbs: -0.3, headAbs: -0.06, tailLift: -0.35, tailCurl: -0.015 }, eyes: 'closed', legs: 'fold' },
  drowsy: { pose: { hipDrop: 1, pitch: -0.06, abs: 1, neckAbs: -0.12, headAbs: -0.1, tailLift: -0.3 }, eyes: 'sleepy', legs: 'fold' },
  roar: { pose: { neck: 0.35, head: 0.55, jaw: 1, tailLift: 0.35, arms: 0.55, tremble: 1, pitch: 0.12 }, eyes: 'open', legs: 'gait' },
  chirp: { pose: { neck: 0.3, head: 0.35, jaw: 0.55, tailLift: 0.2 }, eyes: 'open', legs: 'gait' },
  eat: { pose: { pitch: -0.3, abs: 1, neckAbs: -0.5, headAbs: -0.95, jaw: 0.35, tailLift: 0.3 }, eyes: 'happy', legs: 'gait' },
  sniff: { pose: { pitch: -0.25, abs: 1, neckAbs: -0.4, headAbs: -0.75, tailLift: 0.2 }, eyes: 'open', legs: 'gait' },
  crouch: { pose: { crouch: 1, pitch: -0.12, tailLift: 0.1, arms: 0.2 }, eyes: 'open', legs: 'gait' },
  jump: { pose: { tailLift: 0.35, arms: 0.6, pitch: 0.1, neck: 0.15 }, eyes: 'open', legs: 'air' },
  fall: { pose: { tailLift: 0.5, arms: 1, jaw: 0.55, neck: 0.2, head: 0.2 }, eyes: 'wide', legs: 'flail' },
  held: { pose: { pitch: 0.35, tailLift: -0.75, tailCurl: 0.02, neck: 0.2, head: 0.1, arms: 0.35 }, eyes: 'wide', legs: 'held' },
  happy: { pose: { tailWag: 0.32, tailLift: 0.28, head: 0.18, neck: 0.12 }, eyes: 'happy', legs: 'gait' },
  dizzy: { pose: { tremble: 0.15, neck: -0.15, head: -0.1, tailLift: -0.2 }, eyes: 'dizzy', legs: 'gait' },
  stretch: { pose: { stretch: 1, jaw: 0.75, neck: -0.2, head: 0.35, tailLift: 0.45 }, eyes: 'closed', legs: 'gait' },
  yawn: { pose: { jaw: 0.9, neck: 0.25, head: 0.5 }, eyes: 'closed', legs: 'gait' },
  look_up: { pose: { neck: 0.45, head: 0.35 }, eyes: 'open', legs: 'gait' },
  land: { pose: { crouch: 1, pitch: -0.1, tailLift: -0.1 }, eyes: 'closed', legs: 'gait' },
  dance: { pose: { dance: 1, tailLift: 0.25, head: 0.12, neck: 0.1 }, eyes: 'happy', legs: 'gait' },
  shake: { pose: { shake: 1, neck: 0.05 }, eyes: 'closed', legs: 'gait' },
  pounce: { pose: { crouch: 1, pitch: -0.18, wiggle: 1, tailLift: 0.3, neck: -0.12, head: 0.2 }, eyes: 'wide', legs: 'gait' },
  paw: { pose: { paw: 1, neck: -0.15, head: -0.12, tailLift: 0.12 }, eyes: 'open', legs: 'gait' },
  curious: { pose: { tilt: 0.3, neck: 0.18, head: 0.06 }, eyes: 'wide', legs: 'gait' },
  sneeze_in: { pose: { neck: 0.35, head: 0.5, jaw: 0.3 }, eyes: 'closed', legs: 'gait' },
  sneeze_out: { pose: { neck: -0.3, head: -0.5, jaw: 0.75, pitch: -0.08 }, eyes: 'closed', legs: 'gait' },
  growl: { pose: { neck: -0.08, head: -0.06, jaw: 0.35, tremble: 0.22, tailLift: 0.15 }, eyes: 'angry', legs: 'gait' },

  // ---- flying (the flap angle is set every frame) ----
  fly: { pose: { fly: 1, neck: 0.12, head: -0.08, tailLift: 0.12 }, eyes: 'open', legs: 'air' },
  takeoff: { pose: { crouch: 1, pitch: 0.12, fly: 0.35, flap: 0.8, tailLift: 0.25, neck: 0.12 }, eyes: 'open', legs: 'gait' },
  /** Wings spread on the ground (stretching, sunning). */
  wings: { pose: { wings: 1, flap: 0.3, pitch: 0.12, neck: 0.25, head: 0.15, tailLift: 0.2 }, eyes: 'open', legs: 'gait' },
  /** Wings spread and drooped forward over the ground, head low (mantling). */
  mantle: { pose: { wings: 0.8, flap: -0.6, pitch: -0.12, neck: -0.2, head: -0.25, tailLift: 0.2 }, eyes: 'angry', legs: 'gait' },

  // ---- tricks ----
  bow: { pose: { pitch: -0.32, neck: -0.45, head: -0.3, crouch: 0.35, tailLift: 0.45, arms: 0.3 }, eyes: 'happy', legs: 'gait' },
  /** Lying on its back with the legs in the air (the pet is drawn upside down, see playDead). */
  playdead: { pose: { hipDrop: 1, abs: 1, neckAbs: 0.45, headAbs: 0.15, jaw: 0.45, tailLift: 0.3 }, eyes: 'dizzy', legs: 'held' },
  cheer: { pose: { tailWag: 0.3, tailLift: 0.4, head: 0.3, neck: 0.25, arms: 0.9, jaw: 0.45 }, eyes: 'happy', legs: 'gait' },

  // ---- signature moves ----
  charge: { pose: { neck: -0.35, head: -0.35, pitch: -0.08, tailLift: 0.3 }, eyes: 'angry', legs: 'gait' },
  bonk: { pose: { neck: -0.45, head: -0.5, crouch: 0.4, pitch: -0.1, tailLift: 0.2 }, eyes: 'closed', legs: 'gait' },
  stomp: { pose: { pitch: 0.08, crouch: 0.35, neck: -0.05, head: 0.05, arms: 0.35, tailLift: 0.25, jaw: 0.25 }, eyes: 'angry', legs: 'gait' },
  inhale: { pose: { pitch: 0.18, neck: 0.3, head: 0.2, tailLift: 0.1, arms: 0.2 }, eyes: 'open', legs: 'gait' },
  honk: { pose: { pitch: 0.14, neck: 0.55, head: 0.65, jaw: 0.6, tailLift: 0.15 }, eyes: 'closed', legs: 'gait' },
  display: { pose: { display: 1, pitch: 0.12, neck: 0.25, head: 0.18, tailLift: 0.35 }, eyes: 'wide', legs: 'gait' },
  browse: { pose: { abs: 1, neckAbs: 1.25, headAbs: 0.35, pitch: 0.12, tailLift: -0.08 }, eyes: 'happy', legs: 'gait' },
  dig: { pose: { pitch: -0.25, abs: 1, neckAbs: -0.5, headAbs: -0.95, paw: 1, tailLift: 0.35 }, eyes: 'open', legs: 'gait' },
  screech: { pose: { pitch: 0.2, neck: 0.75, head: 0.95, jaw: 1.1, arms: 0.8, tremble: 0.6, tailLift: 0.45 }, eyes: 'closed', legs: 'gait' },
  rake: { pose: { pitch: 0.25, neck: 0.2, head: 0.15, jaw: 0.35, arms: 1.15, tailLift: 0.3 }, eyes: 'angry', legs: 'gait' },
  whip: { pose: { tailLift: 0.55, tailCurl: -0.03, neck: 0.05, head: 0.05 }, eyes: 'open', legs: 'gait' },
  curl: { pose: { hipDrop: 0.75, crouch: 1, abs: 1, neckAbs: -0.35, headAbs: -0.7, tailLift: -0.2, tailCurl: 0.045 }, eyes: 'closed', legs: 'fold' },
  peer: { pose: { pitch: -0.22, abs: 1, neckAbs: -0.55, headAbs: -1.05, tailLift: 0.3 }, eyes: 'wide', legs: 'gait' },
  snap: { pose: { pitch: -0.32, abs: 1, neckAbs: -0.9, headAbs: -1.35, jaw: 0.95, tailLift: 0.4 }, eyes: 'closed', legs: 'gait' },
  /** Crocodilian: belly low, sneaking. */
  lurk: { pose: { crouch: 0.9, pitch: -0.04, neck: -0.08, head: 0.02, tailLift: -0.1 }, eyes: 'open', legs: 'gait' },
  /** Crocodilian basking: flat on the ground, jaws wide open. */
  gape: { pose: { hipDrop: 1, abs: 1, neckAbs: 0.02, headAbs: 0.18, jaw: 1.1, tailLift: -0.3 }, eyes: 'sleepy', legs: 'fold' },

  // ---- watching videos ----
  video: { pose: { hipDrop: 0.5, pitch: 0.32, neck: 0.2, head: 0.14, tailCurl: 0.025, arms: 0.1 }, eyes: 'open', legs: 'fold' },
  laugh: { pose: { hipDrop: 0.5, pitch: 0.36, neck: 0.25, head: 0.35, jaw: 0.7, tremble: 0.25, tailCurl: 0.025 }, eyes: 'happy', legs: 'fold' },
  gasp: { pose: { hipDrop: 0.45, pitch: 0.3, neck: 0.3, head: 0.2, jaw: 0.75, arms: 0.35 }, eyes: 'wide', legs: 'fold' },

  // ---- fidgets ----
  scratch: { pose: { scratch: 1, pitch: -0.12, neck: -0.25, head: -0.2, tilt: 0.35, tailLift: 0.2 }, eyes: 'happy', legs: 'gait' },
  /** Grooming: head turned back to nibble at its back or wing. */
  preen: { pose: { abs: 1, neckAbs: 1.9, headAbs: -2.4, pitch: 0.05, tailLift: 0.15 }, eyes: 'closed', legs: 'gait' },
  rear: { pose: { pitch: 0.55, neck: 0.35, head: 0.2, arms: 0.6, tailLift: -0.3 }, eyes: 'wide', legs: 'gait' },
  crouchWatch: { pose: { crouch: 0.8, pitch: -0.14, neck: -0.05, head: 0.15, tailLift: 0.35 }, eyes: 'wide', legs: 'gait' },
  reach: { pose: { abs: 1, neckAbs: 1.1, headAbs: 0.25, pitch: 0.1, jaw: 0.1 }, eyes: 'open', legs: 'gait' },
  stretchNeck: { pose: { neck: -0.3, head: 0.25, pitch: -0.05, jaw: 0.3, tailLift: 0.2 }, eyes: 'closed', legs: 'gait' },
  headToss: { pose: { neck: 0.45, head: 0.55, pitch: 0.06 }, eyes: 'closed', legs: 'gait' },
  /** Nose to the ground while walking slowly. */
  forage: { pose: { pitch: -0.2, abs: 1, neckAbs: -0.35, headAbs: -0.8, tailLift: 0.25 }, eyes: 'open', legs: 'gait' },
  /** Clinging to a wall, looking around. */
  cling: { pose: { tailLift: 0.2, neck: 0.15, head: 0.1, crouch: 0.2 }, eyes: 'open', legs: 'gait' },
  /** Stork-like stalking: head held low and forward, peering down. */
  stalk: { pose: { pitch: -0.05, neck: 0.1, head: -0.45, tailLift: 0.05 }, eyes: 'wide', legs: 'gait' },
} satisfies Record<string, PoseDef>;

export type PoseName = keyof typeof POSES;

export function applyPose(r: Rig, name: PoseName, extra?: Partial<Pose>) {
  const d = POSES[name] as PoseDef;
  r.target = { ...NEUTRAL, ...d.pose, ...extra };
  r.eyes = d.eyes;
  r.legMode = d.legs;
}
