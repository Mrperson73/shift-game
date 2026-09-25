// Name ideas for a new hatchling, per species (mods get the generic list).

const NAMES: Record<string, string[]> = {
  rex: ['Rexy', 'Chomper', 'Tiny', 'Sue', 'Stomps', 'Rumble', 'Bruno', 'Titan', 'Nibbles', 'Tyra'],
  raptor: ['Blue', 'Zip', 'Echo', 'Dash', 'Delta', 'Clicky', 'Sprint', 'Pip', 'Talon', 'Scout'],
  pachy: ['Bonk', 'Dome', 'Pebble', 'Nugget', 'Butters', 'Rocky', 'Thump', 'Noggin', 'Marble', 'Boop'],
  trike: ['Trixie', 'Horns', 'Tank', 'Pumpkin', 'Tri', 'Clover', 'Duke', 'Frilly', 'Moose', 'Bramble'],
  stego: ['Spike', 'Plates', 'Stegz', 'Ridge', 'Maple', 'Sprout', 'Shelly', 'Waffles', 'Kite', 'Toast'],
  anky: ['Clubs', 'Armour', 'Tortle', 'Knobby', 'Bolt', 'Cobble', 'Bumpy', 'Rusty', 'Nutmeg', 'Brick'],
  spino: ['Sails', 'Finn', 'Nile', 'Marlin', 'Gills', 'Splash', 'Captain', 'Reef', 'Salty', 'Koi'],
  carno: ['Toro', 'Blaze', 'Flash', 'Ember', 'Sprocket', 'Rascal', 'Carnie', 'Diablo', 'Bullet', 'Nova'],
  dilo: ['Frill', 'Spitz', 'Crest', 'Dilly', 'Zigzag', 'Pickle', 'Twiggy', 'Venom', 'Juniper', 'Slick'],
  parasaur: ['Toot', 'Honk', 'Tuba', 'Melody', 'Crest', 'Echo', 'Banjo', 'Kazoo', 'Piper', 'Harmony'],
  galli: ['Dash', 'Zoom', 'Pip', 'Flick', 'Road', 'Skippy', 'Twitch', 'Nimble', 'Pecky', 'Breeze'],
};

const GENERIC = ['Hatch', 'Pebble', 'Scales', 'Mochi', 'Biscuit', 'Nova', 'Sunny', 'Ziggy', 'Tater', 'Olive'];

/** A random name for a species, different from `avoid` when possible. */
export function randomName(speciesId: string, avoid?: string): string {
  const list = NAMES[speciesId] ?? GENERIC;
  const pool = list.length > 1 ? list.filter((n) => n !== avoid) : list;
  return pool[Math.floor(Math.random() * pool.length)];
}
