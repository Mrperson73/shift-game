// What kind of animal a species is, for species-flavoured behaviour. Derived from features,
// stance, size and signature moves, so modded and new species get fitting behaviour too.

import { movesOf, type SignatureMove, type SpeciesDef } from '../pet/species';

export interface Traits {
  moves: SignatureMove[];
  wings: 'membrane' | 'feather' | null;
  /** Powered flyer that soars in circles (pterosaurs). */
  soarer: boolean;
  /** Mostly glides down from high places, with short fluttering hops up (Microraptor). */
  glider: boolean;
  /** Walks on all fours with folded wings and stalks the ground like a stork (pterosaurs). */
  stalker: boolean;
  /** Long neck on four legs: slow neck sways, reaching up, browsing. */
  sauropod: boolean;
  /** Quick, twitchy hunters: head jerks, crouch-and-watch. */
  raptor: boolean;
  /** Frills and horns: head tosses, pawing, charging. */
  ceratopsian: boolean;
  /** Duck bills and crests: rearing up on the hind legs, honking. */
  hadrosaur: boolean;
  /** Crocodilians: lurking low, gaping, death rolls. */
  croc: boolean;
  /** Tiny ones: hops and quick darts. */
  small: boolean;
  feathered: boolean;
  /** Big meat eaters on two legs: stomps and roar-offs. */
  bigTheropod: boolean;
  armored: boolean;
  /** Big and heavy: slow, stompy. */
  heavy: boolean;
  biped: boolean;
}

export function traitsOf(sp: SpeciesDef): Traits {
  const f = sp.features;
  const moves = movesOf(sp);
  const wings = f.wings ?? null;
  const biped = sp.stance === 'biped';
  return {
    moves,
    wings,
    soarer: wings === 'membrane',
    glider: wings === 'feather',
    stalker: wings === 'membrane' && !biped,
    sauropod: !biped && !wings && sp.body.neckLen > 40,
    raptor: !wings && (!!f.sickleClaw || (biped && sp.diet === 'carnivore' && sp.personality.speed >= 0.7 && sp.lengthM < 8)),
    ceratopsian: !!(f.frill || f.browHorns || f.noseHorn),
    hadrosaur: !!(f.duckBill || f.tubeCrest),
    croc: moves.includes('gape') || moves.includes('roll'),
    small: sp.lengthM <= 3,
    feathered: !!f.feathers || wings === 'feather',
    bigTheropod: biped && !!f.teeth && sp.lengthM >= 8,
    armored: !!(f.armor || f.plates),
    heavy: sp.lengthM >= 9,
    biped,
  };
}
