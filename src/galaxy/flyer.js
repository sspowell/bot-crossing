import * as THREE from 'three'
import { NOISE } from './glsl.js'
import { buildSamurai, makeEnvironment } from './samurai.js'

/**
 * You, flying: a samurai crossing the systems under his own power.
 *
 * He hovers upright with a slow breath when still, leans flat into a fist-forward dive as he picks
 * up speed, flares gold when you power up, and sits cross-legged in the air beside a world when he
 * lands — after announcing himself with a gathered sphere of energy thrown into the world. When
 * you resolve a task he's sitting with, he finishes it with an ultimate: a charged beam that
 * breaks the world apart. The flight is tuned to feel smooth rather than twitchy: every control eases in and out,
 * turning carves the path instead of sliding it, and the camera rides on a spring. Nothing here
 * changes a task — landing only opens its card.
 *
 *   W / S or ↑ / ↓   fly forward / slow down
 *   A / D or ← / →   turn
 *   R / F            rise / sink
 *   Shift            power up
 *   E or Enter       land beside the nearest world, or fly on
 *   Esc              stop flying
 *   click a planet   fly there and land
 *   scroll           pull the camera in or out
 */

const UP = new THREE.Vector3(0, 1, 0)
const CALM = new THREE.Color('#bcd4ff')
const POWER = new THREE.Color('#ffc34d')

// ── the aura ──────────────────────────────────────────────────────────────────────────
/** A flickering shell of light around the whole figure: a shimmer at rest, flames when powered up. */
function auraMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uPower: { value: 0 }, uColor: { value: CALM.clone() } },
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform float uPower;
      varying vec3 vN;
      varying vec3 vView;
      varying vec3 vObj;
      ${NOISE}
      void main() {
        vObj = position;
        float n = noise3(vec3(position.xz * 6.0, position.y * 3.0 - uTime * 3.2));
        float lift = smoothstep(-0.6, 0.7, position.y);
        vec3 p = position + normal * (n - 0.35) * (0.06 + uPower * 0.12);
        p.y += lift * n * (0.1 + uPower * 0.35);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        vN = normalize(normalMatrix * normal);
        vView = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uPower;
      uniform vec3 uColor;
      varying vec3 vN;
      varying vec3 vView;
      varying vec3 vObj;
      ${NOISE}
      void main() {
        float fres = 1.0 - abs(dot(normalize(vN), vView));
        float flame = fbm(vec3(vObj.x * 6.0, vObj.y * 5.0 - uTime * 3.0, vObj.z * 6.0));
        // Idle: a faint shimmer at the silhouette. Powered up: tongues of flame break through.
        float rim = pow(fres, 5.0) * (0.015 + uPower * uPower * 0.6);
        float tongues = pow(fres, 2.0) * smoothstep(0.52 - uPower * 0.1, 0.82, flame) * (0.004 + uPower * uPower * 0.8);
        float a = (rim + tongues) * smoothstep(-0.75, -0.25, vObj.y);
        gl_FragColor = vec4(uColor * a * 1.15, 1.0);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })
}

// Poses: [x, y, z] per joint, plus the body's pitch. Blended every frame.
const POSES = {
  hover: {
    pitch: 0,
    neck: [0.05, 0, 0],
    shoulderL: [0.12, 0, -0.28], elbowL: [0.45, 0, 0],
    shoulderR: [0.12, 0, 0.28], elbowR: [0.45, 0, 0],
    hipL: [0.3, 0, -0.08], kneeL: [-0.6, 0, 0],
    hipR: [0.12, 0, 0.08], kneeR: [-0.4, 0, 0],
  },
  fly: {
    pitch: -1.38,
    neck: [0.75, 0, 0],
    shoulderL: [-0.2, 0, -0.14], elbowL: [0.15, 0, 0],
    shoulderR: [3.05, 0, 0.06], elbowR: [0, 0, 0],
    hipL: [-0.05, 0, -0.06], kneeL: [-0.12, 0, 0],
    hipR: [0.05, 0, 0.05], kneeR: [-0.3, 0, 0],
  },
  rise: {
    pitch: 0.05,
    neck: [-0.25, 0, 0],
    shoulderL: [-0.1, 0, -0.2], elbowL: [0.1, 0, 0],
    shoulderR: [3.0, 0, 0.1], elbowR: [0, 0, 0],
    hipL: [0, 0, -0.04], kneeL: [-0.1, 0, 0],
    hipR: [0.1, 0, 0.04], kneeR: [-0.25, 0, 0],
  },
  // Arms raised, gathering a sphere of energy overhead.
  charge: {
    pitch: 0.05,
    neck: [0.45, 0, 0],
    shoulderL: [2.95, 0, -0.3], elbowL: [0.2, 0, 0],
    shoulderR: [2.95, 0, 0.3], elbowR: [0.2, 0, 0],
    hipL: [0.12, 0, -0.2], kneeL: [-0.25, 0, 0],
    hipR: [0.12, 0, 0.2], kneeR: [-0.25, 0, 0],
  },
  // Following through after the throw.
  throw: {
    pitch: -0.35,
    neck: [0.25, 0, 0],
    shoulderL: [1.5, 0, -0.12], elbowL: [0.05, 0, 0],
    shoulderR: [1.5, 0, 0.12], elbowR: [0.05, 0, 0],
    hipL: [0.55, 0, -0.1], kneeL: [-0.9, 0, 0],
    hipR: [-0.25, 0, 0.1], kneeR: [-0.2, 0, 0],
  },
  // Wide stance, hands cupped at the right hip, drawing everything in.
  beamCharge: {
    pitch: 0.12,
    neck: [0.05, 0, 0],
    shoulderL: [0.35, 0, 0.85], elbowL: [1.5, 0, 0],
    shoulderR: [-0.55, 0, 0.15], elbowR: [1.9, 0, 0],
    hipL: [0.35, 0, -0.4], kneeL: [-0.7, 0, 0],
    hipR: [-0.1, 0, 0.38], kneeR: [-0.35, 0, 0],
  },
  // Both palms driven forward, releasing it.
  beamFire: {
    pitch: -0.08,
    neck: [0.1, 0, 0],
    shoulderL: [1.57, 0, 0.08], elbowL: [0, 0, 0],
    shoulderR: [1.57, 0, -0.08], elbowR: [0, 0, 0],
    hipL: [0.4, 0, -0.4], kneeL: [-0.7, 0, 0],
    hipR: [-0.15, 0, 0.38], kneeR: [-0.3, 0, 0],
  },
  meditate: {
    pitch: 0,
    neck: [0.2, 0, 0],
    shoulderL: [0.35, 0, -0.2], elbowL: [1.0, 0, 0.3],
    shoulderR: [0.35, 0, 0.2], elbowR: [1.0, 0, -0.3],
    hipL: [1.45, 0, -0.75], kneeL: [-2.5, 0, 0.35],
    hipR: [1.45, 0, 0.75], kneeR: [-2.5, 0, -0.35],
  },
}
const JOINTS = Object.keys(POSES.hover).filter((k) => k !== 'pitch')

function blendPoses(weights) {
  const out = { pitch: 0 }
  for (const name of JOINTS) out[name] = [0, 0, 0]
  let total = 0
  for (const [pose, w] of Object.entries(weights)) {
    if (w <= 0) continue
    total += w
    out.pitch += POSES[pose].pitch * w
    for (const name of JOINTS) for (let i = 0; i < 3; i++) out[name][i] += POSES[pose][name][i] * w
  }
  if (total > 0) {
    out.pitch /= total
    for (const name of JOINTS) for (let i = 0; i < 3; i++) out[name][i] /= total
  }
  return out
}

/** Critically damped spring toward a target (Unity's SmoothDamp): no overshoot, no snapping. */
function smoothDamp(current, target, velocity, smoothTime, dt) {
  const omega = 2 / Math.max(0.0001, smoothTime)
  const x = omega * dt
  const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x)
  const cx = current.x - target.x
  const cy = current.y - target.y
  const cz = current.z - target.z
  const tx = (velocity.x + omega * cx) * dt
  const ty = (velocity.y + omega * cy) * dt
  const tz = (velocity.z + omega * cz) * dt
  velocity.set((velocity.x - omega * tx) * exp, (velocity.y - omega * ty) * exp, (velocity.z - omega * tz) * exp)
  current.set(target.x + (cx + tx) * exp, target.y + (cy + ty) * exp, target.z + (cz + tz) * exp)
  return current
}

const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a))

export function createFlyer(stage, web, hooks = {}) {
  const { scene, camera, controls, reducedMotion } = stage

  const { root, body, joints, aura, ribbons } = buildSamurai({ auraMaterial: auraMaterial() })
  // Reflections for his lacquer, metal and silk. Only standard materials use this; every shader in
  // the sky draws its own light, so nothing else changes.
  scene.environment = makeEnvironment(stage.renderer)
  scene.environmentIntensity = 0.7
  root.visible = false
  scene.add(root)

  const sunLight = new THREE.DirectionalLight('#ffffff', 0)
  // Shadows only from him onto himself: a tiny shadow camera that follows him around.
  sunLight.castShadow = true
  sunLight.shadow.mapSize.set(1024, 1024)
  sunLight.shadow.camera.left = sunLight.shadow.camera.bottom = -0.9
  sunLight.shadow.camera.right = sunLight.shadow.camera.top = 0.9
  sunLight.shadow.camera.near = 0.1
  sunLight.shadow.camera.far = 8
  sunLight.shadow.bias = -0.0004
  sunLight.shadow.normalBias = 0.012
  sunLight.shadow.radius = 3
  const fill = new THREE.HemisphereLight('#8fa4c4', '#1c120c', 0)
  // A soft light from just above the camera, so his face and clothes read even with a sun behind him.
  const key = new THREE.DirectionalLight('#ffe9d2', 0)
  scene.add(sunLight, sunLight.target, fill, key, key.target)

  // ── ki: sparks of energy shed from the aura ─────────────────────────────────────────
  const KI = 1400
  const kiGeo = new THREE.BufferGeometry()
  kiGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(KI * 3), 3).setUsage(THREE.DynamicDrawUsage))
  kiGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(KI * 3), 3).setUsage(THREE.DynamicDrawUsage))
  const ki = new THREE.Points(
    kiGeo,
    new THREE.ShaderMaterial({
      uniforms: stage.uniforms,
      vertexShader: /* glsl */ `
        attribute vec3 color;
        uniform float uPixelRatio;
        varying vec3 vColor;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = clamp(0.14 * uPixelRatio * (300.0 / max(-mv.z, 0.5)), 1.0, 7.0);
          vColor = color;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vColor;
        void main() {
          float d = length(gl_PointCoord - 0.5) * 2.0;
          float a = smoothstep(1.0, 0.0, d);
          if (a < 0.01) discard;
          gl_FragColor = vec4(vColor * a, 1.0);
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
  )
  ki.frustumCulled = false
  ki.visible = false
  scene.add(ki)
  const kiPool = []

  // ── attacks ─────────────────────────────────────────────────────────────────────────
  const energyShader = (color) =>
    new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(color) }, uIntensity: { value: 0 } },
      vertexShader: /* glsl */ `
        varying vec3 vN;
        varying vec3 vView;
        varying vec3 vObj;
        varying vec2 vUv;
        void main() {
          vObj = position;
          vUv = uv;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vN = normalize(normalMatrix * normal);
          vView = normalize(-mv.xyz);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform vec3 uColor;
        uniform float uIntensity;
        varying vec3 vN;
        varying vec3 vView;
        varying vec3 vObj;
        varying vec2 vUv;
        ${NOISE}
        void main() {
          float facing = abs(dot(normalize(vN), vView));
          // Swirling energy: noise flowing along the surface, a white-hot centre, a coloured edge.
          float swirl = fbm(vec3(vObj.xy * 3.0 + vUv.y * 6.0, uTime * 1.6) + vec3(0.0, -uTime * 2.5, 0.0));
          vec3 core = mix(uColor, vec3(1.0), smoothstep(0.6, 1.0, facing) * 0.8);
          float a = (0.35 + 0.65 * facing) * (0.7 + swirl * 0.8) * uIntensity;
          gl_FragColor = vec4(core * a * 1.1, 1.0);
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })

  const orb = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 24), energyShader('#7fb4ff'))
  const orbHalo = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), energyShader('#bcd4ff'))
  // The beam: a bright core inside a wider, rougher sheath. Unit height along +y, rotated into place.
  const beamCore = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 24, 8, true).translate(0, 0.5, 0), energyShader('#ffffff'))
  const beamSheath = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 32, 8, true).translate(0, 0.5, 0), energyShader('#6fa8ff'))
  for (const m of [orb, orbHalo, beamCore, beamSheath]) {
    m.visible = false
    m.frustumCulled = false
    scene.add(m)
  }

  // Shockwaves: flat rings that face the camera and race outward.
  const rings = Array.from({ length: 5 }, () => {
    const m = new THREE.Mesh(
      new THREE.RingGeometry(0.955, 1, 96),
      new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
    )
    m.visible = false
    scene.add(m)
    return { mesh: m, life: 1, max: 1, at: new THREE.Vector3(), size: 1 }
  })
  let ringCursor = 0
  function shockwave(at, size, duration, color = '#dfeaff') {
    const r = rings[ringCursor++ % rings.length]
    r.at.copy(at)
    r.size = size
    r.life = 0
    r.max = duration
    r.mesh.material.color.set(color).multiplyScalar(1.4)
    r.mesh.visible = true
  }

  let shake = 0
  /** The attack in progress, if any: { kind: 'bomb' | 'ult', id, t, impacted, onImpact }. */
  let seq = null

  // ── state ───────────────────────────────────────────────────────────────────────────
  let active = false
  const pos = new THREE.Vector3()
  const vel = new THREE.Vector3()
  let yaw = 0
  let yawVel = 0
  let bank = 0
  let power = 0
  let chase = 5
  const keys = new Set()
  let autopilot = null
  let landed = null
  let landAngle = 0
  // Where the world we're with was last seen, so a finishing blow still has somewhere to land after
  // the world itself is gone.
  const lastTarget = { world: new THREE.Vector3(), size: 1 }
  let near = null
  let lastNearKey = ''
  let time = 0
  const pose = blendPoses({ hover: 1 })

  // Eased controls: keys set targets, these follow them smoothly.
  const input = { thrust: 0, turn: 0, climb: 0, boost: 0 }
  let wasBoosting = false
  let flow = 0 // smoothed forward-speed fraction, drives the pose

  // Camera rig: an offset from you and a look point, each on its own spring, plus a yaw that
  // trails yours so turns sweep the view around instead of whipping it.
  const camOffset = new THREE.Vector3()
  const camOffsetVel = new THREE.Vector3()
  const lookOffset = new THREE.Vector3()
  const lookOffsetVel = new THREE.Vector3()
  let camYaw = 0

  const forwardOf = (angle, out) => out.set(-Math.sin(angle), 0, -Math.cos(angle))
  const forward = new THREE.Vector3()
  const tmp = new THREE.Vector3()
  const tmp2 = new THREE.Vector3()
  const col = new THREE.Color()

  const worldOf = (id) => {
    const t = web.thoughts.get(id)
    return t && !t.leaving && t.dissolving === null ? t : null
  }

  function burst(count, speed) {
    for (let i = 0; i < count; i++) {
      const dir = new THREE.Vector3(Math.random() - 0.5, (Math.random() - 0.5) * 0.6, Math.random() - 0.5).normalize()
      kiPool.push({ p: root.position.clone().add(tmp.set(0, 0.2, 0)), v: dir.multiplyScalar(speed * (0.5 + Math.random())), life: 0, max: 0.5 + Math.random() * 0.6, gold: power })
    }
  }

  // ── taking off and coming down ──────────────────────────────────────────────────────
  function enter() {
    if (active) return
    active = true
    const dir = camera.getWorldDirection(new THREE.Vector3())
    yaw = Math.atan2(-dir.x, -dir.z)
    camYaw = yaw
    pos.copy(controls.target).addScaledVector(forwardOf(yaw, tmp), -Math.min(30, camera.position.distanceTo(controls.target) * 0.3))
    vel.set(0, 0, 0)
    yawVel = 0
    Object.assign(input, { thrust: 0, turn: 0, climb: 0, boost: 0 })
    // Start the camera where it already is, so taking flight is a glide in, not a cut.
    camOffset.copy(camera.position).sub(pos)
    camOffsetVel.set(0, 0, 0)
    lookOffset.copy(controls.target).sub(pos)
    lookOffsetVel.set(0, 0, 0)
    root.position.copy(pos)
    root.visible = true
    ki.visible = true
    fill.intensity = 0.35
    key.intensity = 0.75
    burst(80, 3)
    stage.setPiloted(true)
    hooks.onChange?.(true)
  }

  function exit() {
    if (!active) return
    endSequence()
    if (landed) liftOff()
    active = false
    autopilot = null
    keys.clear()
    root.visible = false
    ki.visible = false
    kiPool.length = 0
    sunLight.intensity = 0
    fill.intensity = 0
    key.intensity = 0
    controls.target.copy(pos)
    stage.setPiloted(false)
    lastNearKey = ''
    hooks.onNear?.(null)
    hooks.onChange?.(false)
  }

  function land(id) {
    const t = worldOf(id)
    if (!t) return
    autopilot = null
    landed = id
    tmp.copy(pos).sub(t.world)
    landAngle = Math.atan2(tmp.z, tmp.x)
    lastTarget.world.copy(t.world)
    lastTarget.size = t.size || 1
    if (reducedMotion) return hooks.onLand?.(id)
    // Announce yourself: gather a sphere of energy and throw it into the world. The card opens when
    // it lands. It's only a greeting; the task is untouched.
    seq = { kind: 'bomb', id, t: 0, impacted: false }
    hooks.onCharge?.(1.7, 0.7)
  }

  /**
   * The finishing move for a task being resolved while you sit with it. `onImpact` fires when the
   * beam breaks the world — that's the moment to dissolve it. Returns false if it can't play.
   */
  function ultimate(id, onImpact) {
    if (!active || landed !== id || reducedMotion) return false
    endSequence()
    seq = { kind: 'ult', id, t: 0, impacted: false, onImpact }
    hooks.onCharge?.(1.9, 1)
    return true
  }

  /** Stop any attack now, making sure whatever it owed (a dissolve, an open card) still happens. */
  function endSequence() {
    if (!seq) return
    const done = seq
    seq = null
    orb.visible = orbHalo.visible = beamCore.visible = beamSheath.visible = false
    if (done.impacted) return
    if (done.kind === 'ult') done.onImpact?.()
    else if (landed === done.id) hooks.onLand?.(done.id)
  }

  function liftOff() {
    if (seq?.kind === 'ult') return
    if (seq) {
      seq.impacted = true // lifting off mid-throw just abandons it
      endSequence()
    }
    const t = landed && web.thoughts.get(landed)
    landed = null
    if (t) vel.copy(pos).sub(t.world).setY(0).normalize().multiplyScalar(4)
    hooks.onLeave?.()
  }

  function autopilotTo(id) {
    if (!worldOf(id)) return
    if (landed) liftOff()
    autopilot = id
  }

  // ── input ───────────────────────────────────────────────────────────────────────────
  const CONTROL = new Set(['w', 's', 'a', 'd', 'r', 'f', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'shift'])

  /** Returns true if flight used the key, so nothing else reacts to it. */
  function handleKey(e, down) {
    if (!active) return false
    const key = e.key.toLowerCase()
    // Mid-ultimate, hold your ground: movement and lift-off wait until it's done.
    if (seq?.kind === 'ult' && (CONTROL.has(key) || key === 'e' || key === 'enter')) {
      e.preventDefault()
      return true
    }
    if (CONTROL.has(key)) {
      if (down) {
        keys.add(key)
        if (key !== 'shift') {
          autopilot = null
          if (landed && ['w', 'arrowup', 'r', 'f'].includes(key)) liftOff()
        }
      } else keys.delete(key)
      e.preventDefault()
      return true
    }
    if (!down) return false
    if (key === 'e' || key === 'enter') {
      if (landed) liftOff()
      else if (near) land(near.id)
      return true
    }
    if (key === 'escape') {
      exit()
      return true
    }
    return false
  }

  addEventListener('blur', () => keys.clear())

  function zoom(deltaY) {
    chase = Math.min(60, Math.max(2, chase * Math.exp(deltaY * 0.0012)))
  }

  // ── each frame ──────────────────────────────────────────────────────────────────────
  function update(frameDt) {
    if (!active) return
    // Small fixed steps keep the springs identical at 30fps, 60fps or 144fps.
    const STEP = 1 / 120
    let left = Math.min(frameDt, 0.1)
    while (left > 1e-6) {
      const dt = Math.min(STEP, left)
      step(dt)
      left -= dt
    }
    present(frameDt)
  }

  const k = (rate, dt) => 1 - Math.exp(-dt * rate)

  function step(dt) {
    time += dt
    const held = (...list) => list.some((x) => keys.has(x))
    let wantThrust = (held('w', 'arrowup') ? 1 : 0) - (held('s', 'arrowdown') ? 1 : 0)
    let wantTurn = (held('a', 'arrowleft') ? 1 : 0) - (held('d', 'arrowright') ? 1 : 0)
    let wantClimb = (held('r') ? 1 : 0) - (held('f') ? 1 : 0)
    let wantBoost = held('shift') ? 1 : 0

    if (landed && !seq && !worldOf(landed)) liftOff()

    let approach = null
    if (autopilot) {
      const t = worldOf(autopilot)
      if (!t) autopilot = null
      else {
        tmp.copy(t.world).sub(pos)
        const dist = tmp.length()
        const diff = wrapAngle(Math.atan2(-tmp.x, -tmp.z) - yaw)
        wantTurn = Math.max(-1, Math.min(1, diff * 1.6))
        wantThrust = Math.max(0, Math.cos(diff)) * Math.min(1, dist / 25)
        wantClimb = Math.max(-1, Math.min(1, tmp.y / 12))
        // Long trips power up on their own, so a far-off task is a short, bright flight away.
        if (dist > 45) wantBoost = 1
        if (dist < (t.size || 1) * 5 + 4) land(autopilot)
        else if (dist < 40) approach = tmp.clone().normalize().multiplyScalar(Math.min(30, dist * 1.2 + 4))
      }
    }

    // Controls ease in and out rather than switching on and off.
    input.thrust += (wantThrust - input.thrust) * k(wantThrust ? 3.5 : 2.5, dt)
    input.turn += (wantTurn - input.turn) * k(4, dt)
    input.climb += (wantClimb - input.climb) * k(3, dt)
    input.boost += (wantBoost - input.boost) * k(wantBoost ? 2.2 : 1.2, dt)
    if (wantBoost && !wasBoosting && !landed) burst(120, 7)
    wasBoosting = Boolean(wantBoost)

    const speed = vel.length()
    const boost = 1 + input.boost * 2
    const maxSpeed = 24 * boost
    const speedFrac = Math.min(1, speed / 30)

    // Turning: wider, calmer arcs at speed.
    const yawTarget = input.turn * (1.25 - speedFrac * 0.5)
    yawVel += (yawTarget - yawVel) * k(3, dt)
    yaw = wrapAngle(yaw + yawVel * dt)
    forwardOf(yaw, forward)

    if (landed) {
      // Floating cross-legged beside the world, slowly circling it, facing it. Mid-attack, hold still.
      const live = worldOf(landed)
      if (live) {
        lastTarget.world.copy(live.world)
        lastTarget.size = live.size || lastTarget.size
      }
      const t = lastTarget
      const radius = t.size * (seq?.kind === 'ult' ? 4.5 : 3.2) + 1.6
      if (!seq) landAngle += dt * 0.12
      tmp.set(Math.cos(landAngle) * radius, t.size * 0.5, Math.sin(landAngle) * radius).add(t.world)
      vel.lerp(tmp.sub(pos).multiplyScalar(2), k(3, dt))
      pos.addScaledVector(vel, dt)
      tmp.copy(t.world).sub(pos)
      yaw = wrapAngle(yaw + wrapAngle(Math.atan2(-tmp.x, -tmp.z) - yaw) * k(1.5, dt))
      yawVel *= 1 - k(4, dt)
      forwardOf(yaw, forward)
      return
    }

    if (approach) {
      vel.lerp(approach, k(2.5, dt))
    } else {
      // Carve: when flying forward, the path bends to follow where you face instead of skidding.
      const hSpeed = Math.hypot(vel.x, vel.z)
      if (hSpeed > 0.5 && input.thrust > 0.05) {
        const heading = Math.atan2(-vel.x, -vel.z)
        const turned = heading + wrapAngle(yaw - heading) * k(2.4 * input.thrust, dt)
        vel.x = -Math.sin(turned) * hSpeed
        vel.z = -Math.cos(turned) * hSpeed
      }
      vel.addScaledVector(forward, input.thrust * 13 * boost * dt)
      vel.y += input.climb * 9 * (1 + input.boost * 0.8) * dt
      // Drift to a gentle stop: stronger drag when nothing's held.
      const idle = 1 - Math.min(1, Math.abs(input.thrust) + Math.abs(input.climb))
      vel.multiplyScalar(Math.exp(-dt * (0.3 + idle * 0.55)))
      vel.y *= Math.exp(-dt * (Math.abs(input.climb) < 0.1 ? 1.2 : 0))
      if (speed > maxSpeed) vel.multiplyScalar(1 - k(2, dt) * (1 - maxSpeed / speed))
    }

    // Suns and worlds nudge you aside rather than letting you fly into them.
    for (const n of web.nodes.values()) {
      tmp2.copy(pos).sub(n.pos)
      const d = tmp2.length()
      const keep = n.radius * 1.6 + 1.5
      if (d < keep && d > 0.001) vel.addScaledVector(tmp2.normalize(), ((keep - d) / keep) * 50 * dt)
    }
    for (const t of web.thoughts.values()) {
      tmp2.copy(pos).sub(t.world)
      const d = tmp2.length()
      const keep = (t.size || 1) * 1.8 + 0.6
      if (d < keep && d > 0.001) vel.addScaledVector(tmp2.normalize(), ((keep - d) / keep) * 35 * dt)
    }
    pos.addScaledVector(vel, dt)
  }

  function present(dt) {
    const speed = vel.length()
    const kk = (rate) => k(rate, dt)

    // Power: the aura swells with speed and flares as you power up.
    const surge = seq ? (seq.kind === 'ult' ? 1 : 0.55) : 0
    power += ((landed ? surge : Math.max(input.boost, Math.min(0.18, speed / 140))) - power) * kk(3)
    aura.material.uniforms.uTime.value = time
    aura.material.uniforms.uPower.value = power
    aura.material.uniforms.uColor.value.copy(CALM).lerp(POWER, Math.min(1, power * 1.3))
    aura.scale.setScalar(1 + power * 0.25)

    // Pose: upright hover, flat dive with speed, fist-up when climbing, cross-legged when landed.
    flow += (Math.min(1, Math.max(0, vel.dot(forward)) / 13) - flow) * kk(2.5)
    const s = landed ? 0 : flow
    const c = landed ? 0 : Math.max(0, Math.min(1, vel.y / 8)) * (1 - s * 0.6)
    let target = landed ? blendPoses({ meditate: 1 }) : blendPoses({ hover: (1 - s) * (1 - c), fly: s, rise: c })
    if (seq) target = runSequence(dt) || target
    if (!landed && vel.y < 0) target.pitch -= Math.min(0.3, -vel.y * 0.025) * s
    const kp = kk(seq ? 9 : landed ? 2 : 4)
    pose.pitch += (target.pitch - pose.pitch) * kp
    for (const name of JOINTS) {
      for (let i = 0; i < 3; i++) pose[name][i] += (target[name][i] - pose[name][i]) * kp
      joints[name].rotation.set(pose[name][0], pose[name][1], pose[name][2])
    }
    bank += (-yawVel * (0.25 + s * 0.45) - bank) * kk(2.5)

    const calm = reducedMotion ? 0 : 1
    const bob = calm * Math.sin(time * (landed ? 0.8 : 1.3)) * (landed ? 0.05 : 0.035) * (1 - s * 0.7)
    joints.kneeL.rotation.x += calm * Math.sin(time * 1.3) * 0.05 * (1 - s)
    joints.kneeR.rotation.x += calm * Math.sin(time * 1.3 + 1) * 0.05
    joints.shoulderL.rotation.x += calm * Math.sin(time * 1.1) * 0.035
    root.position.set(pos.x, pos.y + bob, pos.z)
    root.rotation.set(0, yaw, 0)
    body.rotation.set(pose.pitch, 0, bank)
    body.position.y = 0.25 * (1 - Math.cos(pose.pitch))

    // Cloth: hangs back and sways when still, streams out and flutters when flying.
    for (const r of ribbons) {
      r.chain.forEach((seg, i) => {
        const flutter = calm * Math.sin(time * (3 + s * 9) + r.phase + i * 1.3) * (0.08 + s * 0.22) * (i + 1) * 0.5
        seg.rotation.x = (i === 0 ? r.droop * (1 - s) + s * 0.2 : 0.12 * (1 - s)) + flutter
        seg.rotation.z = calm * Math.sin(time * 2 + r.phase * 2 + i) * 0.05 * (1 + s)
      })
    }

    // Light from the nearest sun.
    let nearestSun = null
    let sunD = Infinity
    for (const n of web.nodes.values()) {
      const d = n.pos.distanceTo(pos)
      if (d < sunD) {
        sunD = d
        nearestSun = n
      }
    }
    if (nearestSun) {
      sunLight.target.position.copy(root.position)
      sunLight.position.copy(nearestSun.pos).sub(root.position).setLength(4).add(root.position)
      sunLight.color.copy(nearestSun.color).lerp(new THREE.Color('#ffffff'), 0.4)
      sunLight.intensity = 3.4 * Math.max(0.35, Math.min(1, 160 / Math.max(sunD, 1)))
    }

    // Ki sparks rise off the aura and stream behind when moving.
    const emit = Math.round(((reducedMotion ? 1 : 3) + power * 18 + speed * dt * 8) * Math.min(2, dt * 60))
    for (let i = 0; i < emit; i++) {
      tmp.set((Math.random() - 0.5) * 0.5, Math.random() * 0.9 - 0.3, (Math.random() - 0.5) * 0.4)
      tmp.applyEuler(body.rotation).applyAxisAngle(UP, yaw).add(root.position)
      tmp.addScaledVector(vel, -Math.random() * dt)
      kiPool.push({
        p: tmp.clone(),
        v: new THREE.Vector3((Math.random() - 0.5) * 0.4, 0.8 + power * 2.2, (Math.random() - 0.5) * 0.4).addScaledVector(vel, 0.55),
        life: 0,
        max: 0.35 + Math.random() * 0.5,
        gold: power,
      })
    }
    if (kiPool.length > KI) kiPool.splice(0, kiPool.length - KI)
    const kpos = kiGeo.attributes.position.array
    const kcol = kiGeo.attributes.color.array
    let n = 0
    for (let i = kiPool.length - 1; i >= 0; i--) {
      const q = kiPool[i]
      q.life += dt
      if (q.life >= q.max) {
        kiPool.splice(i, 1)
        continue
      }
      if (q.to) q.p.lerp(q.to, 1 - Math.exp(-dt * 5))
      else {
        q.p.addScaledVector(q.v, dt)
        q.v.multiplyScalar(Math.exp(-dt * 2.5))
      }
      const fade = (1 - q.life / q.max) ** 1.4 * (0.35 + q.gold * 0.9)
      col.copy(CALM).lerp(POWER, Math.min(1, q.gold * 1.3)).multiplyScalar(fade)
      kpos[n * 3] = q.p.x
      kpos[n * 3 + 1] = q.p.y
      kpos[n * 3 + 2] = q.p.z
      kcol[n * 3] = col.r
      kcol[n * 3 + 1] = col.g
      kcol[n * 3 + 2] = col.b
      n++
    }
    kiGeo.attributes.position.needsUpdate = true
    kiGeo.attributes.color.needsUpdate = true
    kiGeo.setDrawRange(0, n)

    // What's close enough to land beside
    let best = null
    let bestD = Infinity
    for (const t of web.thoughts.values()) {
      if (t.leaving || t.dissolving !== null) continue
      const d = t.world.distanceTo(pos)
      if (d < (t.size || 1) * 7 + 6 && d < bestD) {
        best = t
        bestD = d
      }
    }
    near = best
    const nearKey = `${landed || ''}|${best?.id || ''}`
    if (nearKey !== lastNearKey) {
      lastNearKey = nearKey
      hooks.onNear?.(landed ? { thought: web.thoughts.get(landed), landed: true } : best ? { thought: best, landed: false } : null)
    }

    // Camera: the offset from you rides a spring, so it follows every move without a jolt and
    // never falls far behind. Its heading trails yours, so turns sweep the view around.
    const t = landed && (worldOf(landed) || lastTarget)
    if (t) {
      tmp.copy(pos).sub(t.world).setY(0).normalize()
      tmp2.set(-tmp.z, 0, tmp.x)
      const d = Math.max(chase, (t.size || 1) * 4.5) * (seq?.kind === 'ult' ? 1.8 : seq ? 1.35 : 1)
      // From the far side, so the task's card (docked at the right edge) doesn't cover you.
      const want = tmp.clone().multiplyScalar(d * 0.75).addScaledVector(tmp2, -d * 0.55).addScaledVector(UP, d * 0.25)
      smoothDamp(camOffset, want, camOffsetVel, 0.9, dt)
      smoothDamp(lookOffset, tmp.copy(t.world).sub(pos).multiplyScalar(seq ? 0.5 : 0.45).addScaledVector(UP, seq?.kind === 'bomb' ? 0.5 : 0), lookOffsetVel, 0.7, dt)
      camYaw = yaw
    } else {
      camYaw = wrapAngle(camYaw + wrapAngle(yaw - camYaw) * kk(2.2))
      const reach = chase * (1 + power * 0.3)
      const back = forwardOf(camYaw, tmp)
      const want = tmp2.copy(back).multiplyScalar(-reach * (1 - s * 0.25)).addScaledVector(UP, reach * (0.22 + s * 0.4) + 0.3)
      smoothDamp(camOffset, want, camOffsetVel, 0.45, dt)
      smoothDamp(lookOffset, back.multiplyScalar(reach * 0.12).addScaledVector(UP, 0.05 + s * 0.25), lookOffsetVel, 0.3, dt)
    }
    camera.position.copy(pos).add(camOffset)
    camera.lookAt(tmp.copy(pos).add(lookOffset))
    if (shake > 0.001) {
      shake *= Math.exp(-dt * 4)
      camera.position.x += (Math.random() - 0.5) * shake
      camera.position.y += (Math.random() - 0.5) * shake
      camera.rotateZ((Math.random() - 0.5) * shake * 0.04)
    }
    for (const r of rings) {
      if (!r.mesh.visible) continue
      r.life += dt
      const p = r.life / r.max
      if (p >= 1) {
        r.mesh.visible = false
        continue
      }
      r.mesh.position.copy(r.at)
      r.mesh.quaternion.copy(camera.quaternion)
      r.mesh.scale.setScalar(r.size * (0.15 + (1 - (1 - p) ** 3)))
      r.mesh.material.opacity = (1 - p) ** 2 * 0.75
    }
    key.position.copy(camera.position).addScaledVector(UP, 1.5)
    key.target.position.copy(pos)
    hooks.onSpeed?.(speed)
  }

  // ── running an attack ───────────────────────────────────────────────────────────────
  const ease = (x) => (x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2)
  const gather = (at, count, spread, gold) => {
    for (let i = 0; i < count; i++) {
      const from = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.4, Math.random() - 0.5).normalize().multiplyScalar(spread * (0.4 + Math.random())).add(at)
      kiPool.push({ p: from, v: new THREE.Vector3(), to: at.clone(), life: 0, max: 0.5 + Math.random() * 0.45, gold })
    }
  }

  /** Advances the attack in progress and returns the pose to hold, or null once it's over. */
  function runSequence(dt) {
    seq.t += dt
    const tt = seq.t
    const live = worldOf(seq.id)
    const world = live ? live.world : lastTarget.world
    const size = lastTarget.size
    for (const m of [orb, orbHalo, beamCore, beamSheath]) m.material.uniforms.uTime.value = time

    if (seq.kind === 'bomb') {
      const CHARGE = 1.7
      const THROW = 0.55
      const radius = Math.min(1.3, 0.35 + size * 0.32)
      const overhead = new THREE.Vector3(0, 0.95 + radius, 0).add(root.position)
      if (tt < CHARGE) {
        // Energy drawn in from all around into a sphere swelling overhead.
        const grow = ease(tt / CHARGE)
        orb.visible = orbHalo.visible = true
        orb.position.copy(overhead)
        orbHalo.position.copy(overhead)
        orb.scale.setScalar(radius * grow * 0.8 + 0.02)
        orbHalo.scale.setScalar(radius * grow * 1.3 + 0.03)
        orb.material.uniforms.uIntensity.value = 0.55
        orbHalo.material.uniforms.uIntensity.value = 0.12
        gather(overhead, 5, 7, 0.05)
        return blendPoses({ charge: 1 })
      }
      if (tt < CHARGE + THROW) {
        const p = (tt - CHARGE) / THROW
        orb.position.lerpVectors(overhead, world, p * p)
        orbHalo.position.copy(orb.position)
        return blendPoses({ throw: 1 })
      }
      if (!seq.impacted) {
        seq.impacted = true
        orb.visible = orbHalo.visible = false
        web.impact?.(seq.id, 1)
        shockwave(world, size * 5, 0.9)
        shockwave(world, size * 3, 0.6, '#7fb4ff')
        shake = 0.3
        hooks.onFlash?.(0.3, '#cfe2ff')
        hooks.onBoom?.(0.6)
        hooks.onLand?.(seq.id)
      }
      if (tt > CHARGE + THROW + 1) {
        seq = null
        return null
      }
      return blendPoses({ throw: 0.35, meditate: 0.65 })
    }

    // The ultimate: charge at the hip, then a beam held on the world until it breaks.
    const CHARGE = 1.9
    const FIRE = 0.18
    const HOLD = 1.4
    const FADE = 0.6
    const width = Math.min(1.1, 0.3 + size * 0.45)
    if (tt < CHARGE) {
      const grow = ease(tt / CHARGE)
      const cup = new THREE.Vector3(0.2, 0.08, 0.05).applyAxisAngle(UP, yaw).add(root.position)
      orb.visible = orbHalo.visible = true
      orb.position.copy(cup)
      orbHalo.position.copy(cup)
      orb.scale.setScalar(0.05 + grow * 0.16)
      orbHalo.scale.setScalar(0.1 + grow * 0.36 + Math.sin(time * 40) * 0.02)
      orb.material.uniforms.uIntensity.value = 1.2
      orbHalo.material.uniforms.uIntensity.value = 0.45
      shake = Math.max(shake, grow * 0.06)
      gather(cup, 9, 6, 0.9)
      if (tt + dt >= CHARGE) hooks.onFlash?.(0.25, '#ffe2a8')
      return blendPoses({ beamCharge: 1 })
    }
    orb.visible = orbHalo.visible = false
    const beamT = tt - CHARGE
    if (beamT < FIRE + HOLD + FADE) {
      const open = beamT < FIRE ? ease(beamT / FIRE) : beamT < FIRE + HOLD ? 1 : 1 - ease((beamT - FIRE - HOLD) / FADE)
      const origin = new THREE.Vector3(0, 0.28, -0.45).applyAxisAngle(UP, yaw).add(root.position)
      const dir = world.clone().sub(origin)
      const length = Math.max(0.01, dir.length())
      dir.normalize()
      for (const [b, scaleW, intensity] of [[beamCore, 0.42, 1.3], [beamSheath, 1, 0.55]]) {
        b.visible = open > 0.001
        b.position.copy(origin)
        b.quaternion.setFromUnitVectors(UP, dir)
        const flicker = 1 + Math.sin(time * 50 + scaleW * 10) * 0.05
        b.scale.set(width * scaleW * open * flicker, length, width * scaleW * open * flicker)
        b.material.uniforms.uIntensity.value = intensity * Math.max(open, 0.001)
      }
      if (beamT < FIRE + HOLD) {
        web.impact?.(seq.id, 0.5)
        shake = Math.max(shake, 0.16)
        if (Math.random() < dt * 12) shockwave(world, size * 2.5, 0.35, '#9cc4ff')
      }
      if (!seq.impacted && beamT >= FIRE + HOLD * 0.85) {
        seq.impacted = true
        seq.onImpact?.()
        shockwave(world, size * 10, 1.5, '#ffe2a8')
        shockwave(world, size * 6.5, 1.1)
        shockwave(world, size * 3.5, 0.8, '#7fb4ff')
        shake = 0.7
        hooks.onFlash?.(0.85, '#fff4de')
        hooks.onBoom?.(1.4)
      }
      return blendPoses({ beamFire: 1 })
    }
    beamCore.visible = beamSheath.visible = false
    seq = null
    return null
  }

  return {
    enter,
    exit,
    ultimate,
    toggle: () => (active ? exit() : enter()),
    autopilotTo,
    handleKey,
    zoom,
    update,
    get active() {
      return active
    },
    get landed() {
      return landed
    },
    get speed() {
      return vel.length()
    },
    liftOff: () => landed && liftOff(),
  }
}
