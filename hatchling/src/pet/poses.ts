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
} satisfies Record<string, PoseDef>;

export type PoseName = keyof typeof POSES;

export function applyPose(r: Rig, name: PoseName, extra?: Partial<Pose>) {
  const d = POSES[name] as PoseDef;
  r.target = { ...NEUTRAL, ...d.pose, ...extra };
  r.eyes = d.eyes;
  r.legMode = d.legs;
}
