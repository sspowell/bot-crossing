/**
 * Where things live in the galaxy.
 *
 * The rule that matters: a node never moves because a *different* node appeared. Positions come
 * from each node's own name, not from its place in a sorted list, and once placed a node's spot
 * is saved — so the galaxy you learned yesterday is the galaxy you open today. Dragging something
 * is the only thing that moves it.
 */

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

const NODE_GAP = 80
const GOLDEN_ANGLE = 2.399963

/**
 * A spot for a node that has never been placed. Starts where its own name says, and walks out
 * along a golden-angle spiral until it's clear of every node already in the sky.
 */
export function placeNode(name, taken) {
  const r = seeded(hashString(`node:${name}`))
  let angle = r() * Math.PI * 2
  let radius = 50 + r() * 60
  const lift = (r() - 0.5) * 30
  for (let i = 0; i < 400; i++) {
    const p = [Math.cos(angle) * radius, lift, Math.sin(angle) * radius]
    if (taken.every((q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) >= NODE_GAP)) return p
    angle += GOLDEN_ANGLE
    radius += 5
  }
  return [Math.cos(angle) * radius, lift, Math.sin(angle) * radius]
}

/**
 * Where a thought sits around its node, relative to the node. A flattened shell — thoughts
 * cluster like a small spiral galaxy around their centre rather than a perfect ball.
 */
export function thoughtOffset(id) {
  const r = seeded(hashString(`thought:${id}`))
  const u = r() * 2 - 1
  const theta = r() * Math.PI * 2
  const ring = Math.sqrt(1 - u * u)
  const radius = 11 + r() * 17
  return [ring * Math.cos(theta) * radius, u * radius * 0.4, ring * Math.sin(theta) * radius]
}

/** A per-thought number in [0, 1) for anything that should vary but never flicker. */
export const phaseOf = (id) => seeded(hashString(`phase:${id}`))()

/** Soft nebula hues, one per node, chosen by name so a node keeps its colour forever. */
const NEBULA = ['#9d86ff', '#56d4c8', '#6c95ff', '#e37bd9', '#f0b574', '#7fdc9a', '#ff8f9f', '#8fd0ff']
export const hueOf = (name) => NEBULA[hashString(`hue:${name}`) % NEBULA.length]
