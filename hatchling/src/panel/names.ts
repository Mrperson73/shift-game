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
  brachio: ['Longneck', 'Treetop', 'Gentle', 'Skyler', 'Willow', 'Bertha', 'Stretch', 'Atlas', 'Cloud', 'Maple'],
  allo: ['Big Al', 'Jaws', 'Rusty', 'Ridge', 'Alby', 'Fang', 'Hunter', 'Blaze', 'Allie', 'Cinder'],
  therizino: ['Edward', 'Scissors', 'Claws', 'Fluffy', 'Rake', 'Sickle', 'Shears', 'Tickles', 'Garden', 'Wolverine'],
  ptera: ['Swoop', 'Sky', 'Glider', 'Kite', 'Pip', 'Breezy', 'Soar', 'Flappy', 'Pelican', 'Aero'],
  quetzal: ['Quetzy', 'Giraffe', 'Zephyr', 'Condor', 'Stilts', 'Skyscraper', 'Zeppelin', 'Hawk', 'Monarch', 'Lofty'],
  diplo: ['Whiplash', 'Dippy', 'Noodle', 'Longtail', 'Ribbon', 'Slinky', 'Diplo', 'Lasso', 'Twiggy', 'Meadow'],
  styraco: ['Spikes', 'Crown', 'Halo', 'Styx', 'Thorn', 'Punk', 'Duchess', 'Pincushion', 'Horny', 'Sunny'],
  iguano: ['Thumbs', 'Iggy', 'Guano', 'Spike', 'Mossy', 'Bramble', 'Thumbelina', 'Iggo', 'Nobby', 'Hazel'],
  compy: ['Tiny', 'Peep', 'Nibbles', 'Compy', 'Squeak', 'Bean', 'Scamper', 'Crumb', 'Pocket', 'Zippy'],
  ovi: ['Eggbert', 'Beaky', 'Ovi', 'Nest', 'Pecky', 'Omelette', 'Hen', 'Sunny', 'Robin', 'Custard'],
  kentro: ['Pointy', 'Kent', 'Prickles', 'Quill', 'Cactus', 'Thistle', 'Needles', 'Porky', 'Spindle', 'Burr'],
  amarga: ['Sails', 'Amara', 'Zipper', 'Comb', 'Fins', 'Picket', 'Sierra', 'Spines', 'Harp', 'Mohawk'],
  corytho: ['Helmet', 'Cory', 'Casque', 'Hoot', 'Bonnet', 'Crested', 'Bugle', 'Melody', 'Cassie', 'Honker'],
  micro: ['Zip', 'Flutter', 'Glimmer', 'Micro', 'Pixel', 'Wisp', 'Sparky', 'Midge', 'Raven', 'Glide'],
  deino: ['Chomps', 'Snappy', 'Gator', 'Tick-Tock', 'Deino', 'Marsh', 'Bubbles', 'Log', 'Grinner', 'Swampy'],
};

const GENERIC = ['Hatch', 'Pebble', 'Scales', 'Mochi', 'Biscuit', 'Nova', 'Sunny', 'Ziggy', 'Tater', 'Olive'];

/** A random name for a species, different from `avoid` when possible. */
export function randomName(speciesId: string, avoid?: string): string {
  const list = NAMES[speciesId] ?? GENERIC;
  const pool = list.length > 1 ? list.filter((n) => n !== avoid) : list;
  return pool[Math.floor(Math.random() * pool.length)];
}
