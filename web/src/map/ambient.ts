// The map's decorative motion (ambient pulses, the breathing core and hubs, the turning index,
// the level-7 halos, the Orbit turn) runs only while someone is using the map, at a calm frame
// rate, one ambient pulse at a time. Pure scheduling rules; MapCanvas runs the loop.

/** Decorative frames at most this many times a second. */
export const AMBIENT_FPS = 15;
/** Decorative motion stops this long after the last input. */
export const IDLE_AFTER_MS = 15_000;

export type AmbientState = { lastInput: number; lastPulseEnd: number };

/** True while decorative motion may run: input within IDLE_AFTER_MS and motion allowed. */
export function ambientAwake(
  s: AmbientState,
  now: number,
  reducedMotion: boolean,
): boolean {
  return !reducedMotion && now - s.lastInput <= IDLE_AFTER_MS;
}

/** True when a new ambient pulse may start: awake and no pulse still in flight. */
export function mayStartPulse(
  s: AmbientState,
  now: number,
  reducedMotion: boolean,
): boolean {
  return ambientAwake(s, now, reducedMotion) && now >= s.lastPulseEnd;
}

/** Delay to the next frame: 1000/60 while camera or interaction motion runs, 1000/AMBIENT_FPS
 *  while only ambient motion runs, null when nothing runs (the loop stops). */
export function nextFrameDelay(o: {
  moving: boolean;
  interactive: boolean;
  ambient: boolean;
}): number | null {
  if (o.moving || o.interactive) return 1000 / 60;
  if (o.ambient) return 1000 / AMBIENT_FPS;
  return null;
}
