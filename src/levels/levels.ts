import type { Segment } from '../physics/Track';

export interface LevelDef {
  id: number;
  name: string;
  tag: string; // ramp type
  hint: string;
  segments: Segment[];
  landing: 'hill' | 'deck' | 'pad';
  /** fraction of max exit speed the landing window is designed around */
  window?: [number, number, number];
}

// Every ramp's shape is the launch: it decides the angle you leave at and the
// rotation you carry into the air. Runways are straight; you can steer across them.
export const LEVELS: LevelDef[] = [
  {
    id: 1, name: 'KICKSTART', tag: 'Classic kicker',
    hint: 'Floor it. In the air, W/S pitch the nose. Match the slope of the landing hill.',
    segments: [{ type: 'straight', length: 75 }, { type: 'arc', angle: 22, radius: 50 }, { type: 'straight', length: 6 }],
    landing: 'hill',
  },
  {
    id: 11, name: 'INVERSION', tag: 'Inverted arch · ease it down',
    hint: 'Up the wall, over the top and along the ceiling: you leave upside down, flying backwards. Roll it over, then hold SPACE and lower it onto the pad. Gently.',
    segments: [{ type: 'straight', length: 14 }, { type: 'arc', angle: 90, radius: 9 }, { type: 'straight', length: 12 }, { type: 'arc', angle: 90, radius: 6 }],
    landing: 'pad',
  },
  {
    id: 3, name: 'SKYHOOK', tag: 'Curved lip · backflip',
    hint: 'The lip keeps curving, so you leave it rotating backwards. Push W early to stop the flip.',
    segments: [{ type: 'straight', length: 95 }, { type: 'arc', angle: 41, radius: 58 }],
    landing: 'hill',
  },
  {
    id: 4, name: 'CORKSCREW', tag: 'Twisted lip · roll',
    hint: 'The lip twists 75 degrees. You leave rolling hard. Catch it with A/D.',
    segments: [{ type: 'straight', length: 80 }, { type: 'arc', angle: 26, radius: 55 }, { type: 'straight', length: 24, roll: 75 }],
    landing: 'hill',
  },
  {
    id: 5, name: 'SIDEWINDER', tag: 'Banked lip · thrown sideways',
    hint: 'The road banks 25 degrees into the lip, so it throws you up and off to the side. Roll level and yaw to line up.',
    segments: [{ type: 'straight', length: 35 }, { type: 'straight', length: 70, roll: 25 }, { type: 'arc', angle: 32, radius: 50 }, { type: 'straight', length: 5 }],
    landing: 'hill',
  },
  {
    id: 6, name: 'LAUNCH TUBE', tag: '52° shot · hang time',
    hint: 'Almost straight up. A long hang time with a long way down: save air for the belly blasts.',
    segments: [{ type: 'straight', length: 95 }, { type: 'arc', angle: 52, radius: 44 }, { type: 'straight', length: 4 }],
    landing: 'hill',
  },
  {
    id: 7, name: 'THE WALL', tag: 'Quarter pipe 145°',
    hint: 'You leave the wall upside down, flying backwards. Roll (A/D) or keep flipping (S) to get wheels down.',
    segments: [{ type: 'straight', length: 45 }, { type: 'arc', angle: 145, radius: 18 }],
    landing: 'hill',
  },
  {
    id: 8, name: 'HELIX', tag: 'Half-twist lip',
    hint: 'The lip twists a full 180 degrees. You launch upside down and still rolling.',
    segments: [{ type: 'straight', length: 85 }, { type: 'arc', angle: 22, radius: 50 }, { type: 'arc', angle: 70, radius: 34, roll: 180 }],
    landing: 'hill',
  },
  {
    id: 9, name: 'IMMELMANN', tag: 'Half loop',
    hint: 'Half a loop leaves you inverted 40 m up, heading home. A half roll puts you right.',
    segments: [{ type: 'straight', length: 45 }, { type: 'arc', angle: 180, radius: 20 }],
    landing: 'hill',
  },
  {
    id: 10, name: 'SINGULARITY', tag: 'Twisted pipe 125°',
    hint: 'A quarter pipe that twists 90 degrees as it climbs. You leave backwards, sideways and spinning on two axes.',
    segments: [{ type: 'straight', length: 75 }, { type: 'arc', angle: 125, radius: 20, roll: 90 }],
    landing: 'hill',
  },
];
