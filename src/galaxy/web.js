import * as THREE from 'three'

/**
 * The web of thoughts.
 *
 * Every visible thing means something:
 *   a node        one TickTick list — a cluster of collective thoughts
 *   a star        one open task — a thought
 *   a faint spoke a thought belonging to its node
 *   a thread      two thoughts in *different* nodes sharing a tag — the tangle itself
 *   rose + ripple overdue — a tangled thought, trembling
 *   gold + ripple due today — a thought asking for you
 *   size          priority — heavier thoughts burn bigger
 *   moons         checklist steps; bright ones still to do, faint ones done
 *   sinking       the longer a thought is overdue, the further it drifts from its node toward
 *                 the galactic core — and the core glows with the weight of everything down there
 *
 * Whole crowd, one draw call per kind: all stars are one Points object, all threads one
 * LineSegments. Positions are computed on the CPU each frame because there are tens or hundreds
 * of them, not tens of thousands, and CPU positions are also what picking and labels read.
 */

const STARLIGHT = new THREE.Color('#eef3ff')
const TANGLED = new THREE.Color('#ff5c77')
const ASKING = new THREE.Color('#ffcf7a')

export const stateOf = (thread) => (thread.hasError ? 'tangled' : thread.unread ? 'asking' : 'drifting')

const PULSE = { drifting: 0, asking: 1, tangled: 2 }

const CORE = new THREE.Vector3(0, 0, 0)
/** How far toward the core an overdue thought has sunk: none on day zero, most of the way by ~6 weeks. */
const MAX_SINK = 0.55
const sinkOf = (t) => (t.state === 'tangled' ? Math.min(MAX_SINK, (Number(t.thread.overdueDays) || 0) / 45) : 0)

const starVertex = /* glsl */ `
  attribute vec3 color;
  attribute float size;
  attribute float glow;
  attribute float pulse;
  attribute float phase;
  attribute float soft;
  uniform float uTime;
  uniform float uPixelRatio;
  varying vec3 vColor;
  varying float vGlow;
  varying float vBeat;
  varying float vSoft;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float beat = 0.0;
    if (pulse > 1.5) beat = 0.5 + 0.5 * sin(uTime * 2.1 + phase * 6.2831);
    else if (pulse > 0.5) beat = 0.5 + 0.5 * sin(uTime * 3.3 + phase * 6.2831);
    gl_PointSize = size * (1.0 + beat * 0.3) * uPixelRatio * (300.0 / max(-mv.z, 1.0));
    vColor = color;
    vGlow = glow;
    vBeat = beat;
    vSoft = soft;
    gl_Position = projectionMatrix * mv;
  }`

const starFragment = /* glsl */ `
  varying vec3 vColor;
  varying float vGlow;
  varying float vBeat;
  varying float vSoft;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    if (d > 1.0) discard;
    float a;
    if (vSoft > 0.5) {
      a = exp(-d * 2.6) * 0.18 * (1.0 - d);
    } else {
      float core = smoothstep(0.26, 0.0, d);
      float halo = exp(-d * 3.0) * 0.85;
      a = (core * 1.6 + halo) * (0.9 + vBeat * 0.45);
    }
    a *= vGlow;
    if (a < 0.002) discard;
    gl_FragColor = vec4(vColor * a, 1.0);
  }`

const beaconVertex = /* glsl */ `
  attribute vec3 color;
  attribute float phase;
  attribute float glow;
  uniform float uPixelRatio;
  varying vec3 vColor;
  varying float vPhase;
  varying float vGlow;
  void main() {
    vColor = color;
    vPhase = phase;
    vGlow = glow;
    gl_PointSize = 46.0 * uPixelRatio;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`

const beaconFragment = /* glsl */ `
  uniform float uTime;
  varying vec3 vColor;
  varying float vPhase;
  varying float vGlow;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float a = 0.0;
    for (int i = 0; i < 2; i++) {
      float r = fract(uTime * 0.45 + vPhase + float(i) * 0.5);
      a += smoothstep(0.09, 0.0, abs(d - r)) * (1.0 - r);
    }
    a *= 0.55 * vGlow;
    if (a < 0.003) discard;
    gl_FragColor = vec4(vColor * a, 1.0);
  }`

export function createWeb(stage) {
  const { scene, camera, uniforms, reducedMotion } = stage

  const nodes = new Map()
  const thoughts = new Map()
  let tagLinks = []

  let hovered = null
  let selected = null
  let focusNode = null
  let filter = null
  let dropTarget = null
  let coreGlow = 0

  // ── GPU objects ─────────────────────────────────────────────────────────────────────
  const starMaterial = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: starVertex,
    fragmentShader: starFragment,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })
  const beaconMaterial = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: beaconVertex,
    fragmentShader: beaconFragment,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
  })
  const lineMaterial = new THREE.LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })

  function pointBuffers(capacity, extra = []) {
    const g = new THREE.BufferGeometry()
    const attrs = { position: 3, color: 3, size: 1, glow: 1, pulse: 1, phase: 1, soft: 1 }
    for (const [name, n] of Object.entries(attrs)) {
      g.setAttribute(name, new THREE.BufferAttribute(new Float32Array(capacity * n), n).setUsage(THREE.DynamicDrawUsage))
    }
    for (const name of extra) g.setAttribute(name, new THREE.BufferAttribute(new Float32Array(capacity), 1))
    g.setDrawRange(0, 0)
    return g
  }

  let starCap = 0
  let beaconCap = 0
  let lineCap = 0
  const stars = new THREE.Points(new THREE.BufferGeometry(), starMaterial)
  const beacons = new THREE.Points(new THREE.BufferGeometry(), beaconMaterial)
  const lines = new THREE.LineSegments(new THREE.BufferGeometry(), lineMaterial)
  for (const o of [lines, stars, beacons]) {
    o.frustumCulled = false
    scene.add(o)
  }
  beacons.renderOrder = 10

  function ensureCapacity(starsNeeded, linesNeeded) {
    if (starsNeeded > starCap) {
      starCap = Math.ceil(starsNeeded * 1.5) + 16
      stars.geometry.dispose()
      stars.geometry = pointBuffers(starCap)
    }
    if (starsNeeded > beaconCap) {
      beaconCap = starCap
      beacons.geometry.dispose()
      beacons.geometry = pointBuffers(beaconCap)
    }
    if (linesNeeded > lineCap) {
      lineCap = Math.ceil(linesNeeded * 1.5) + 16
      lines.geometry.dispose()
      const g = new THREE.BufferGeometry()
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(lineCap * 6), 3).setUsage(THREE.DynamicDrawUsage))
      g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(lineCap * 6), 3).setUsage(THREE.DynamicDrawUsage))
      g.setDrawRange(0, 0)
      lines.geometry = g
    }
  }

  // ── sparks: the dissolve when a thought is resolved ────────────────────────────────
  const SPARK_CAP = 480
  const sparkGeo = pointBuffers(SPARK_CAP)
  const sparks = new THREE.Points(sparkGeo, starMaterial)
  sparks.frustumCulled = false
  scene.add(sparks)
  const sparkPool = []

  function burst(at, color) {
    for (let i = 0; i < 44; i++) {
      const dir = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize()
      sparkPool.push({
        pos: at.clone(),
        vel: dir.multiplyScalar(4 + Math.random() * 14),
        life: 0,
        max: 0.9 + Math.random() * 0.9,
        color: color.clone().lerp(STARLIGHT, Math.random() * 0.6),
      })
    }
    if (sparkPool.length > SPARK_CAP) sparkPool.splice(0, sparkPool.length - SPARK_CAP)
  }

  // ── data in ─────────────────────────────────────────────────────────────────────────
  /**
   * Reconcile with a fresh picture. New thoughts arrive (they grow out of their node), missing
   * ones fade away, existing ones keep every bit of state they had — nothing pops.
   */
  function setData({ nodeList, thoughtList }) {
    const seenNodes = new Set()
    for (const n of nodeList) {
      seenNodes.add(n.name)
      const existing = nodes.get(n.name)
      if (existing) {
        if (!existing.dragging) existing.pos.fromArray(n.pos)
        existing.color.set(n.hue)
        existing.leaving = false
      } else {
        nodes.set(n.name, { name: n.name, pos: new THREE.Vector3().fromArray(n.pos), color: new THREE.Color(n.hue), glow: 0, arrive: 0, leaving: false })
      }
    }
    for (const [name, n] of nodes) if (!seenNodes.has(name)) n.leaving = true

    const seen = new Set()
    for (const t of thoughtList) {
      seen.add(t.id)
      const state = stateOf(t.thread)
      const existing = thoughts.get(t.id)
      if (existing) {
        existing.thread = t.thread
        existing.node = t.node
        existing.state = state
        existing.leaving = false
        if (!existing.dragging) existing.offset.fromArray(t.offset)
      } else {
        thoughts.set(t.id, {
          id: t.id,
          thread: t.thread,
          node: t.node,
          state,
          offset: new THREE.Vector3().fromArray(t.offset),
          phase: t.phase,
          world: new THREE.Vector3().fromArray(nodes.get(t.node)?.pos.toArray() || [0, 0, 0]),
          glow: 0,
          arrive: 0,
          dissolving: null,
          leaving: false,
          dragging: false,
        })
      }
    }
    for (const [id, t] of thoughts) if (!seen.has(id) && t.dissolving === null) t.leaving = true

    // The tangle: link thoughts that share a tag but live in different nodes. Chained per tag
    // (A–B–C) rather than every pair, so ten shared tags are a readable thread, not a hairball.
    const byTag = new Map()
    for (const t of thoughtList) {
      for (const tag of t.thread.tags || []) {
        if (!byTag.has(tag)) byTag.set(tag, [])
        byTag.get(tag).push(t)
      }
    }
    tagLinks = []
    for (const [tag, list] of byTag) {
      if (new Set(list.map((t) => t.node)).size < 2) continue
      list.sort((a, b) => a.node.localeCompare(b.node) || a.id.localeCompare(b.id))
      for (let i = 1; i < list.length; i++) {
        if (list[i].node !== list[i - 1].node) tagLinks.push({ a: list[i - 1].id, b: list[i].id, tag })
      }
    }
  }

  // ── per frame ───────────────────────────────────────────────────────────────────────
  const tmp = new THREE.Vector3()
  const tmp2 = new THREE.Vector3()
  const col = new THREE.Color()

  const rotY = (v, angle, out) => {
    const c = Math.cos(angle)
    const s = Math.sin(angle)
    return out.set(v.x * c + v.z * s, v.y, -v.x * s + v.z * c)
  }

  const angleOf = (t, time) => {
    if (reducedMotion) return t.phase * Math.PI * 2
    const speed = t.state === 'asking' ? 0.05 : t.state === 'tangled' ? 0.022 : 0.035
    return t.phase * Math.PI * 2 + time * speed
  }

  function glowTargetOf(t) {
    let g = 1
    if (focusNode && t.node !== focusNode) g = 0.1
    if (filter && !filter(t)) g = Math.min(g, 0.1)
    if (selected === t.id) g = 2.1
    else if (hovered?.kind === 'thought' && hovered.id === t.id) g = Math.max(g, 1.7)
    else if (hovered?.kind === 'node' && hovered.id === t.node) g = Math.max(g, 1.35)
    return g
  }

  function update(dt, time) {
    const k = 1 - Math.exp(-dt * 6)

    for (const [name, n] of nodes) {
      n.arrive = Math.min(1, n.arrive + dt / 1.6)
      let target = focusNode && focusNode !== name ? 0.25 : 1
      if (hovered?.kind === 'node' && hovered.id === name) target = 1.5
      if (dropTarget === name) target = 2.2
      if (n.leaving) target = 0
      n.glow += (target - n.glow) * k
      if (n.leaving && n.glow < 0.01) nodes.delete(name)
    }

    let si = 0
    let bi = 0
    let li = 0
    let moonCount = 0
    for (const t of thoughts.values()) moonCount += t.thread.items?.length || 0
    const starsNeeded = thoughts.size + nodes.size * 2 + moonCount + 2
    ensureCapacity(starsNeeded, thoughts.size + tagLinks.length)

    const sg = stars.geometry.attributes
    const bg = beacons.geometry.attributes
    const lg = lines.geometry.attributes

    const writeStar = (pos, color, size, glow, pulse, phase, soft) => {
      sg.position.array.set([pos.x, pos.y, pos.z], si * 3)
      sg.color.array.set([color.r, color.g, color.b], si * 3)
      sg.size.array[si] = size
      sg.glow.array[si] = glow
      sg.pulse.array[si] = pulse
      sg.phase.array[si] = phase
      sg.soft.array[si] = soft
      si++
    }

    for (const n of nodes.values()) {
      const g = n.glow * n.arrive
      col.copy(n.color).lerp(STARLIGHT, 0.55)
      writeStar(n.pos, col, 20, g, 0, 0, 0)
      writeStar(n.pos, n.color, 95, g * 0.8, 0, 0, 1)
    }

    // The core only glows with what has sunk into it. A calm web has a dark centre.
    let weight = 0
    for (const t of thoughts.values()) if (!t.leaving && t.dissolving === null) weight += sinkOf(t) / MAX_SINK
    coreGlow += (Math.min(1, weight / 6) - coreGlow) * (1 - Math.exp(-dt * 1.5))
    if (coreGlow > 0.01) {
      writeStar(CORE, TANGLED, 40 + coreGlow * 50, coreGlow * 0.9, 2, 0.5, 1)
      writeStar(CORE, col.copy(TANGLED).lerp(STARLIGHT, 0.4), 8 + coreGlow * 8, coreGlow * 0.7, 2, 0.5, 0)
    }

    for (const [id, t] of thoughts) {
      const node = nodes.get(t.node)
      if (!node) continue

      if (t.dissolving !== null) {
        t.dissolving += dt
        if (t.dissolving > 0.9) {
          thoughts.delete(id)
          continue
        }
      }
      t.arrive = Math.min(1, t.arrive + dt / 1.6)
      const arriveEase = 1 - (1 - t.arrive) ** 3

      let target = glowTargetOf(t)
      if (t.leaving) target = 0
      t.glow += (target - t.glow) * k
      if (t.leaving && t.glow < 0.01) {
        thoughts.delete(id)
        continue
      }

      if (!t.dragging) {
        rotY(t.offset, angleOf(t, time), tmp).multiplyScalar(arriveEase)
        if (t.state === 'tangled' && !reducedMotion) {
          tmp.x += Math.sin(time * 7 + t.phase * 40) * 0.18
          tmp.y += Math.cos(time * 6 + t.phase * 30) * 0.18
        }
        t.world.copy(node.pos).add(tmp)
        const sink = sinkOf(t) * arriveEase
        if (sink > 0) t.world.lerp(CORE, sink)
      }

      const urgency = Number(t.thread.urgency) || 0
      let size = 10 + urgency * 10 + (t.state === 'drifting' ? 0 : 3)
      let glow = t.glow * arriveEase
      if (t.dissolving !== null) {
        const p = t.dissolving / 0.9
        size *= 1 + p * 3
        glow *= p < 0.25 ? 1 + p * 8 : Math.max(0, 3 * (1 - p))
      }

      const base = t.state === 'tangled' ? TANGLED : t.state === 'asking' ? ASKING : col.copy(STARLIGHT).lerp(node.color, 0.35)
      writeStar(t.world, base, size, glow, PULSE[t.state], t.phase, 0)

      // Moons: one per checklist step, circling close. Done steps are faint, open ones bright.
      const items = t.thread.items || []
      if (items.length && t.dissolving === null) {
        const radius = 2.4 + size * 0.09
        const spin = reducedMotion ? 0 : time * 0.7
        for (let i = 0; i < items.length; i++) {
          const a = spin + t.phase * 6.283 + (i / items.length) * 6.283
          tmp2.set(t.world.x + Math.cos(a) * radius, t.world.y + Math.sin(a * 2) * radius * 0.25, t.world.z + Math.sin(a) * radius)
          writeStar(tmp2, items[i].done ? col.copy(node.color).lerp(STARLIGHT, 0.5) : STARLIGHT, 3.4, glow * (items[i].done ? 0.35 : 0.95), 0, 0, 0)
        }
      }

      if (t.state !== 'drifting' && t.dissolving === null) {
        bg.position.array.set([t.world.x, t.world.y, t.world.z], bi * 3)
        bg.color.array.set([base.r, base.g, base.b], bi * 3)
        bg.phase.array[bi] = t.phase
        bg.glow.array[bi] = Math.min(1, glow)
        bi++
      }

      // Spoke back to its node.
      const spoke = 0.16 * Math.min(glow, 1.4) * Math.min(node.glow, 1)
      lg.position.array.set([node.pos.x, node.pos.y, node.pos.z, t.world.x, t.world.y, t.world.z], li * 6)
      lg.color.array.set([node.color.r * spoke * 0.4, node.color.g * spoke * 0.4, node.color.b * spoke * 0.4, node.color.r * spoke, node.color.g * spoke, node.color.b * spoke], li * 6)
      li++
    }

    for (const link of tagLinks) {
      const a = thoughts.get(link.a)
      const b = thoughts.get(link.b)
      if (!a || !b) continue
      const lit = [a.id, b.id].includes(selected) || (hovered?.kind === 'thought' && [a.id, b.id].includes(hovered.id))
      const strength = (lit ? 0.75 : 0.26) * Math.min(a.glow, b.glow, 1.2)
      lg.position.array.set([a.world.x, a.world.y, a.world.z, b.world.x, b.world.y, b.world.z], li * 6)
      lg.color.array.set([strength, strength * 0.95, strength * 1.1, strength, strength * 0.95, strength * 1.1], li * 6)
      li++
    }

    // Sparks
    let pi = 0
    const pg = sparkGeo.attributes
    for (let i = sparkPool.length - 1; i >= 0; i--) {
      const s = sparkPool[i]
      s.life += dt
      if (s.life >= s.max) {
        sparkPool.splice(i, 1)
        continue
      }
      s.vel.multiplyScalar(1 - dt * 1.8)
      s.pos.addScaledVector(s.vel, dt)
      const fade = 1 - s.life / s.max
      pg.position.array.set([s.pos.x, s.pos.y, s.pos.z], pi * 3)
      pg.color.array.set([s.color.r, s.color.g, s.color.b], pi * 3)
      pg.size.array[pi] = 2.5 * fade + 0.5
      pg.glow.array[pi] = fade * 1.4
      pg.pulse.array[pi] = 0
      pg.soft.array[pi] = 0
      pi++
    }

    for (const g of [stars.geometry, beacons.geometry, lines.geometry, sparkGeo]) {
      for (const attr of Object.values(g.attributes)) attr.needsUpdate = true
    }
    stars.geometry.setDrawRange(0, si)
    beacons.geometry.setDrawRange(0, bi)
    lines.geometry.setDrawRange(0, li * 2)
    sparkGeo.setDrawRange(0, pi)
  }

  // ── looking things up ───────────────────────────────────────────────────────────────
  const projected = new THREE.Vector3()

  function screenOf(world) {
    projected.copy(world).project(camera)
    return {
      x: (projected.x * 0.5 + 0.5) * innerWidth,
      y: (-projected.y * 0.5 + 0.5) * innerHeight,
      visible: projected.z < 1 && projected.z > -1,
      depth: camera.position.distanceTo(world),
    }
  }

  /** Nearest thing under a screen point — thoughts first, since they sit on top of nodes. */
  function pick(x, y) {
    let best = null
    let bestD = Infinity
    for (const t of thoughts.values()) {
      if (t.dissolving !== null || t.glow < 0.3) continue
      const s = screenOf(t.world)
      if (!s.visible) continue
      const d = Math.hypot(s.x - x, s.y - y)
      const reach = Math.max(12, 420 / s.depth)
      if (d < reach && d < bestD) {
        best = { kind: 'thought', id: t.id }
        bestD = d
      }
    }
    if (best) return best
    for (const n of nodes.values()) {
      const s = screenOf(n.pos)
      if (!s.visible) continue
      const d = Math.hypot(s.x - x, s.y - y)
      const reach = Math.max(22, 1500 / s.depth)
      if (d < reach && d < bestD) {
        best = { kind: 'node', id: n.name }
        bestD = d
      }
    }
    return best
  }

  // ── dragging ────────────────────────────────────────────────────────────────────────
  const plane = new THREE.Plane()
  const ray = new THREE.Raycaster()
  const ndc = new THREE.Vector2()
  const hit = new THREE.Vector3()

  function beginDrag(kind, id) {
    const obj = kind === 'thought' ? thoughts.get(id) : nodes.get(id)
    if (!obj) return false
    obj.dragging = true
    const at = kind === 'thought' ? obj.world : obj.pos
    plane.setFromNormalAndCoplanarPoint(camera.getWorldDirection(new THREE.Vector3()).negate(), at)
    return true
  }

  /** Move the dragged thing under the pointer. Returns what to persist. */
  function dragTo(kind, id, x, y, time) {
    ndc.set((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1)
    ray.setFromCamera(ndc, camera)
    if (!ray.ray.intersectPlane(plane, hit)) return null
    if (kind === 'node') {
      const n = nodes.get(id)
      if (!n) return null
      n.pos.copy(hit)
      return n.pos.toArray()
    }
    const t = thoughts.get(id)
    const node = t && nodes.get(t.node)
    if (!t || !node) return null
    t.world.copy(hit)

    // Hovering over a different node while dragging = offering to move it into that list.
    dropTarget = null
    let best = 70
    for (const n of nodes.values()) {
      if (n.name === t.node) continue
      const s = screenOf(n.pos)
      const d = Math.hypot(s.x - x, s.y - y)
      if (s.visible && d < best) {
        best = d
        dropTarget = n.name
      }
    }

    // Undo the sink toward the core, then store it in the node's un-rotated frame — so on release
    // it keeps drifting from exactly where it was left instead of jumping.
    const sink = sinkOf(t)
    tmp.copy(hit)
    if (sink > 0) tmp.sub(tmp2.copy(CORE).multiplyScalar(sink)).divideScalar(1 - sink)
    rotY(tmp.sub(node.pos), -angleOf(t, time), t.offset)
    return t.offset.toArray()
  }

  /** Ends a drag. Returns the node it was dropped onto, if it was dropped onto one. */
  function endDrag(kind, id) {
    const obj = kind === 'thought' ? thoughts.get(id) : nodes.get(id)
    if (obj) obj.dragging = false
    const target = kind === 'thought' ? dropTarget : null
    dropTarget = null
    return target
  }

  /** Optimistically move a thought to another node while the real move happens. */
  function reassign(id, nodeName, offset) {
    const t = thoughts.get(id)
    if (!t || !nodes.has(nodeName)) return
    t.node = nodeName
    t.offset.fromArray(offset)
    t.arrive = 0.35
  }

  /** A new star being born at a node: a small burst of starlight before the real task arrives. */
  function birth(nodeName) {
    const n = nodes.get(nodeName)
    burst(n ? n.pos : CORE, STARLIGHT)
  }

  return {
    setData,
    update,
    pick,
    screenOf,
    beginDrag,
    dragTo,
    endDrag,
    reassign,
    birth,
    get dropTarget() {
      return dropTarget
    },
    nodes,
    thoughts,
    get tagLinks() {
      return tagLinks
    },
    setHover: (h) => (hovered = h),
    setSelected: (id) => (selected = id),
    setFocusNode: (name) => (focusNode = name),
    setFilter: (fn) => (filter = fn),
    dissolve(id) {
      const t = thoughts.get(id)
      if (!t) return
      t.dissolving = 0
      burst(t.world, t.state === 'tangled' ? TANGLED : t.state === 'asking' ? ASKING : STARLIGHT)
    },
    restore(id, thread) {
      // Resolve failed after the dissolve started — bring it back in.
      if (thoughts.has(id)) {
        const t = thoughts.get(id)
        t.dissolving = null
        t.arrive = 0
      }
      return thread
    },
  }
}
