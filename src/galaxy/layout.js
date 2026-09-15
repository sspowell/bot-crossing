/**
 * Where things live in the sky.
 *
 * The rule that matters: a sun never moves because a *different* sun appeared. Positions come
 * from each list's own name, not from its place in a sorted list, and once placed a sun's spot is
 * saved — so the sky you learned yesterday is the sky you open today. Dragging something is the
 * only thing that moves it.
 */

/** Bumped when the meaning of saved positions changes, so old spots are cleared once. */
export const LAYOUT_VERSION = 'solar-3'

/** FNV-1a — stable across sessions and machines, which is the whole point. */
export function hashString(s) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** Small deterministic PRNG: same seed, same sequence. */
export function seeded(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Close enough that neighbouring systems' outer dust mingles, so they read as one web rather than islands. */
const SYSTEM_GAP = 108
const GOLDEN_ANGLE = 2.399963

/**
 * A spot for a sun that has never been placed. Starts where its own name says, and walks out
 * along a golden-angle spiral until it's clear of every sun already in the sky.
 */
export function placeNode(name, taken) {
  const r = seeded(hashString(`node:${name}`))
  let angle = r() * Math.PI * 2
  let radius = 30 + r() * 50
  const lift = (r() - 0.5) * 40
  for (let i = 0; i < 400; i++) {
    const p = [Math.cos(angle) * radius, lift, Math.sin(angle) * radius]
    if (taken.every((q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) >= SYSTEM_GAP)) return p
    angle += GOLDEN_ANGLE
    radius += 6
  }
  return [Math.cos(angle) * radius, lift, Math.sin(angle) * radius]
}

/** A sun grows with the number of tasks in its list, but slowly — ten tasks isn't ten times hotter. */
export const sunRadiusOf = (count) => Math.min(7.5, 2.8 + Math.sqrt(Math.max(0, count)) * 0.85)

/**
 * A planet's orbit around its sun, stored as [x, inclination, z]:
 *   hypot(x, z)  distance beyond the sun's edge
 *   atan2(z, x)  where on the orbit it started
 *   inclination  tilt of the orbit's plane, in radians
 */
export function thoughtOffset(id) {
  const r = seeded(hashString(`thought:${id}`))
  const radius = 6 + r() * 34
  const theta = r() * Math.PI * 2
  const incl = (r() - 0.5) * 0.4
  return [Math.cos(theta) * radius, incl, Math.sin(theta) * radius]
}

/** A per-thought number in [0, 1) for anything that should vary but never flicker. */
export const phaseOf = (id) => seeded(hashString(`phase:${id}`))()

/** Star colours, one per list, chosen by name so a sun keeps its colour forever. */
const SUNS = ['#ffb35c', '#ff8a4c', '#ffd27a', '#8fb8ff', '#ff6f5e', '#ffe2b0', '#c79bff', '#6fe0d0']
export const hueOf = (name) => SUNS[hashString(`hue:${name}`) % SUNS.length]
