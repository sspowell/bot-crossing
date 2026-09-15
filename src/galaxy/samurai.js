import * as THREE from 'three'

/**
 * The samurai, modelled in detail: a sculpted head and face, a kimono with folds and a crossed
 * collar, pleated hakama, lamellar shoulder guards laced with silk cord, wrapped forearms, curled
 * fists, straw sandals, and a katana with a wrapped hilt and lacquered scabbard.
 *
 * Everything is built from code — lathe profiles, tubes along curves, and small procedural
 * textures drawn onto canvases (fabric weave, skin, the hilt's diamond wrap) — so there are no
 * model or image files to ship.
 *
 * The rig is the same one the flight code poses: joints are groups, each limb hangs down (-y) from
 * its joint, facing -z. Joint names and positions must stay put: neck, shoulderL/R, elbowL/R,
 * hipL/R, kneeL/R.
 */

// ── procedural textures ───────────────────────────────────────────────────────────────
function canvasTexture(size, paint, { color = false, repeat = [1, 1] } = {}) {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')
  paint(ctx, size)
  const tex = new THREE.CanvasTexture(canvas)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.repeat.set(...repeat)
  tex.anisotropy = 4
  if (color) tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/** Turn a height function into a tangent-space normal map. */
function normalMap(size, height, strength, repeat) {
  return canvasTexture(
    size,
    (ctx) => {
      const img = ctx.createImageData(size, size)
      const h = new Float32Array(size * size)
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) h[y * size + x] = height(x / size, y / size)
      const at = (x, y) => h[((y + size) % size) * size + ((x + size) % size)]
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const dx = (at(x + 1, y) - at(x - 1, y)) * strength
          const dy = (at(x, y + 1) - at(x, y - 1)) * strength
          const len = Math.hypot(dx, dy, 1)
          const i = (y * size + x) * 4
          img.data[i] = ((-dx / len) * 0.5 + 0.5) * 255
          img.data[i + 1] = ((-dy / len) * 0.5 + 0.5) * 255
          img.data[i + 2] = ((1 / len) * 0.5 + 0.5) * 255
          img.data[i + 3] = 255
        }
      }
      ctx.putImageData(img, 0, 0)
    },
    { repeat }
  )
}

/** Tileable value noise for the textures above. */
function tileNoise(seed, cells) {
  const grid = new Float32Array(cells * cells)
  let s = seed
  for (let i = 0; i < grid.length; i++) {
    s = (s * 16807) % 2147483647
    grid[i] = s / 2147483647
  }
  const g = (x, y) => grid[(((y % cells) + cells) % cells) * cells + (((x % cells) + cells) % cells)]
  return (u, v) => {
    const x = u * cells
    const y = v * cells
    const xi = Math.floor(x)
    const yi = Math.floor(y)
    const fx = x - xi
    const fy = y - yi
    const sx = fx * fx * (3 - 2 * fx)
    const sy = fy * fy * (3 - 2 * fy)
    const a = g(xi, yi) + (g(xi + 1, yi) - g(xi, yi)) * sx
    const b = g(xi, yi + 1) + (g(xi + 1, yi + 1) - g(xi, yi + 1)) * sx
    return a + (b - a) * sy
  }
}

function makeTextures() {
  const fine = tileNoise(7, 64)
  const coarse = tileNoise(11, 12)
  // Plain weave: threads alternate over and under in a checker of cells.
  const weave = normalMap(
    256,
    (u, v) => {
      const n = 24
      const cx = Math.floor(u * n)
      const cy = Math.floor(v * n)
      const fx = u * n - cx
      const fy = v * n - cy
      const warp = (cx + cy) % 2 === 0
      const thread = warp ? Math.sin(fx * Math.PI) : Math.sin(fy * Math.PI)
      return thread * 0.8 + fine(u, v) * 0.35
    },
    2.2,
    [6, 6]
  )
  const skin = normalMap(256, (u, v) => fine(u * 2, v * 2) * 0.6 + coarse(u, v) * 0.4, 1.2, [3, 3])
  const hair = normalMap(256, (u, v) => Math.sin((u * 90 + fine(u, v) * 6) * Math.PI) * 0.5 + fine(u * 4, v * 4) * 0.5, 2.5, [4, 4])
  const straw = normalMap(128, (u, v) => Math.sin(v * 60 * Math.PI + fine(u, v) * 3) * 0.6 + fine(u, v) * 0.4, 2, [2, 2])

  // Hakama: a quiet pinstripe over charcoal.
  const stripes = canvasTexture(
    256,
    (ctx, n) => {
      ctx.fillStyle = '#26252b'
      ctx.fillRect(0, 0, n, n)
      for (let x = 0; x < n; x += 16) {
        ctx.fillStyle = 'rgba(160,150,140,0.16)'
        ctx.fillRect(x, 0, 2, n)
        ctx.fillStyle = 'rgba(0,0,0,0.25)'
        ctx.fillRect(x + 7, 0, 1, n)
      }
    },
    { color: true, repeat: [4, 1] }
  )

  // Tsuka-ito: dark silk crossing over pale ray skin in diamonds.
  const ito = canvasTexture(
    256,
    (ctx, n) => {
      ctx.fillStyle = '#e6dcc4'
      ctx.fillRect(0, 0, n, n)
      ctx.fillStyle = '#1b130e'
      for (let i = -n; i < n * 2; i += n / 4) {
        ctx.beginPath()
        ctx.moveTo(i, 0)
        ctx.lineTo(i + n / 2, n)
        ctx.lineTo(i + n / 2 + n / 10, n)
        ctx.lineTo(i + n / 10, 0)
        ctx.fill()
        ctx.beginPath()
        ctx.moveTo(i + n / 2, 0)
        ctx.lineTo(i, n)
        ctx.lineTo(i + n / 10, n)
        ctx.lineTo(i + n / 2 + n / 10, 0)
        ctx.fill()
      }
    },
    { color: true, repeat: [1, 3] }
  )

  return { weave, skin, hair, straw, stripes, ito }
}

// ── geometry helpers ──────────────────────────────────────────────────────────────────
const V2 = (r, y) => new THREE.Vector2(Math.max(r, 0.0001), y)

/** A surface of revolution from [radius, y] pairs listed bottom to top. */
function lathe(points, segments = 32) {
  return new THREE.LatheGeometry(points.map(([r, y]) => V2(r, y)), segments)
}

/**
 * Push vertices in and out around the axis — cloth folds and pleats. `count` must be a whole number
 * so the seam lines up; `weight(y)` fades the folds in or out along the height.
 */
function folds(geo, count, amplitude, weight = () => 1, twist = 0) {
  const p = geo.attributes.position
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i)
    const y = p.getY(i)
    const z = p.getZ(i)
    const r = Math.hypot(x, z)
    if (r < 1e-5) continue
    const a = Math.atan2(z, x)
    const grow = 1 + (Math.sin(a * count + y * twist) * amplitude * weight(y)) / r
    p.setXYZ(i, x * grow, y, z * grow)
  }
  geo.computeVertexNormals()
  return geo
}

/**
 * A flat ribbon along a path, lying on the body: at each step it spreads sideways, perpendicular to
 * both the path and the direction out from the body's centre line. Used for the kimono collar.
 */
function band(points, width, segments = 40) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)))
  const positions = []
  const uvs = []
  const index = []
  const tangent = new THREE.Vector3()
  const out = new THREE.Vector3()
  const across = new THREE.Vector3()
  for (let i = 0; i <= segments; i++) {
    const u = i / segments
    const p = curve.getPointAt(u)
    curve.getTangentAt(u, tangent)
    out.set(p.x, 0, p.z).normalize()
    across.crossVectors(tangent, out).normalize().multiplyScalar(width / 2)
    positions.push(p.x - across.x, p.y - across.y, p.z - across.z, p.x + across.x, p.y + across.y, p.z + across.z)
    uvs.push(0, u * 6, 1, u * 6)
    if (i < segments) {
      const a = i * 2
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
    }
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geo.setIndex(index)
  geo.computeVertexNormals()
  return geo
}

function tube(points, radius, segments = 24, radial = 8) {
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p))), segments, radius, radial, false)
}

// ── the figure ────────────────────────────────────────────────────────────────────────
export function buildSamurai({ auraMaterial }) {
  const tex = makeTextures()

  const M = {
    skin: new THREE.MeshPhysicalMaterial({ color: '#4a2d1e', roughness: 0.5, sheen: 0.35, sheenColor: '#8a5a40', sheenRoughness: 0.6, clearcoat: 0.12, clearcoatRoughness: 0.55, normalMap: tex.skin, normalScale: new THREE.Vector2(0.18, 0.18) }),
    lips: new THREE.MeshPhysicalMaterial({ color: '#3a2016', roughness: 0.4, clearcoat: 0.3, clearcoatRoughness: 0.4 }),
    eye: new THREE.MeshPhysicalMaterial({ color: '#e4d8c6', roughness: 0.15, clearcoat: 1, clearcoatRoughness: 0.05 }),
    iris: new THREE.MeshPhysicalMaterial({ color: '#1a0f0a', roughness: 0.1, clearcoat: 1, clearcoatRoughness: 0.02 }),
    hair: new THREE.MeshPhysicalMaterial({ color: '#0e0b0a', roughness: 0.7, sheen: 0.6, sheenColor: '#3a3230', sheenRoughness: 0.4, normalMap: tex.hair, normalScale: new THREE.Vector2(0.6, 0.6) }),
    kimono: new THREE.MeshPhysicalMaterial({ color: '#1b2440', roughness: 0.88, sheen: 1, sheenColor: '#4a5d96', sheenRoughness: 0.55, normalMap: tex.weave, normalScale: new THREE.Vector2(0.45, 0.45), side: THREE.DoubleSide }),
    collar: new THREE.MeshPhysicalMaterial({ color: '#a8a095', roughness: 0.9, sheen: 0.3, sheenColor: '#e0d8c8', sheenRoughness: 0.8, normalMap: tex.weave, normalScale: new THREE.Vector2(0.35, 0.35), side: THREE.DoubleSide }),
    hakama: new THREE.MeshPhysicalMaterial({ map: tex.stripes, roughness: 0.9, sheen: 0.7, sheenColor: '#6a6670', sheenRoughness: 0.6, normalMap: tex.weave, normalScale: new THREE.Vector2(0.4, 0.4), side: THREE.DoubleSide }),
    obi: new THREE.MeshPhysicalMaterial({ color: '#c9501e', roughness: 0.7, sheen: 1, sheenColor: '#ff9a5c', sheenRoughness: 0.4, normalMap: tex.weave, normalScale: new THREE.Vector2(0.55, 0.55), side: THREE.DoubleSide }),
    band: new THREE.MeshPhysicalMaterial({ color: '#cfc7b8', roughness: 0.92, sheen: 0.25, sheenColor: '#d8d0c0', sheenRoughness: 0.8, normalMap: tex.weave, normalScale: new THREE.Vector2(0.5, 0.5), side: THREE.DoubleSide }),
    lacquer: new THREE.MeshPhysicalMaterial({ color: '#0f0e11', roughness: 0.32, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.06 }),
    cord: new THREE.MeshPhysicalMaterial({ color: '#b23c16', roughness: 0.55, sheen: 1, sheenColor: '#ff7a3c', sheenRoughness: 0.35 }),
    iron: new THREE.MeshPhysicalMaterial({ color: '#2e2c2a', roughness: 0.42, metalness: 1 }),
    gold: new THREE.MeshPhysicalMaterial({ color: '#b48c46', roughness: 0.24, metalness: 1 }),
    ito: new THREE.MeshPhysicalMaterial({ map: tex.ito, roughness: 0.7, sheen: 0.6, sheenColor: '#6b5a4a' }),
    wrap: new THREE.MeshPhysicalMaterial({ color: '#23201f', roughness: 0.9, normalMap: tex.weave, normalScale: new THREE.Vector2(0.5, 0.5) }),
    tabi: new THREE.MeshPhysicalMaterial({ color: '#e8e1d4', roughness: 0.9, normalMap: tex.weave, normalScale: new THREE.Vector2(0.3, 0.3) }),
    straw: new THREE.MeshPhysicalMaterial({ color: '#a8894f', roughness: 0.85, normalMap: tex.straw, normalScale: new THREE.Vector2(0.8, 0.8) }),
  }

  const add = (geo, mat, parent, [x, y, z] = [0, 0, 0], [rx, ry, rz] = [0, 0, 0], [sx, sy, sz] = [1, 1, 1]) => {
    const m = new THREE.Mesh(geo, mat)
    m.position.set(x, y, z)
    m.rotation.set(rx, ry, rz)
    m.scale.set(sx, sy, sz)
    m.castShadow = true
    m.receiveShadow = true
    parent.add(m)
    return m
  }
  const joint = (parent, x, y, z) => {
    const g = new THREE.Group()
    g.position.set(x, y, z)
    parent.add(g)
    return g
  }

  const root = new THREE.Group() // yaw
  const body = joint(root, 0, 0, 0) // pitch and bank, pivoting at the hips
  const j = {}
  const ribbons = []

  /** Cloth tails — the obi bow and the headband — as short chains that sway and stream behind. */
  const ribbon = (parent, [x, y, z], width, segment, count, mat, droop) => {
    let at = joint(parent, x, y, z)
    const chain = []
    for (let i = 0; i < count; i++) {
      const taper = 1 - (i / count) * 0.25
      const geo = new THREE.PlaneGeometry(width * taper, segment, 1, 3)
      add(geo, mat, at, [0, -segment / 2, 0], [0, 0, 0])
      chain.push(at)
      at = joint(at, 0, -segment, 0)
    }
    ribbons.push({ chain, droop, phase: ribbons.length * 1.7 })
  }

  // ── torso ──
  // Kimono body: broad at the chest, drawn in at the obi, with soft vertical folds.
  const chest = lathe([[0.1, -0.02], [0.108, 0.05], [0.117, 0.14], [0.127, 0.24], [0.126, 0.3], [0.108, 0.355], [0.07, 0.39], [0.042, 0.405]], 40)
  folds(chest, 11, 0.0035, (y) => Math.min(1, Math.max(0, (0.33 - y) * 6)), 8)
  add(chest, M.kimono, body, [0, 0, 0], [0, 0, 0], [1.08, 1, 0.78])

  // Crossed collar, left over right: a pale inner band with a navy edge beside it.
  for (const [side, depth] of [[1, 0], [-1, 0.006]]) {
    // From behind the neck, over the collarbone, down to meet just past the centre at the obi.
    const path = [
      [side * 0.02, 0.408, 0.032],
      [side * 0.042, 0.392, -0.03],
      [side * 0.032, 0.335, -0.084],
      [side * 0.012, 0.24, -0.1 + depth],
      [-side * 0.008, 0.15, -0.101 + depth],
      [-side * 0.016, 0.095, -0.097 + depth],
    ]
    add(band(path.map(([x, y, z]) => [x * 1.02, y, z * 1.02]), 0.026), M.collar, body)
    add(tube(path.map(([x, y, z]) => [x * 1.02 + side * 0.013, y - 0.002, z * 1.03]), 0.0028, 40, 6), M.kimono, body)
  }

  // Obi: a wide sash with a cord over it and a bow at the back.
  const obi = lathe([[0.121, 0.025], [0.126, 0.045], [0.127, 0.075], [0.124, 0.1]], 40)
  add(obi, M.obi, body, [0, 0, 0], [0, 0, 0], [1.1, 1, 0.84])
  add(new THREE.TorusGeometry(0.128, 0.0045, 8, 64), M.cord, body, [0, 0.062, 0], [Math.PI / 2, 0, 0], [1.1, 0.84, 1])
  add(new THREE.SphereGeometry(0.03, 20, 14), M.obi, body, [0, 0.064, 0.108], [0, 0, 0], [1.6, 1, 0.6])
  add(new THREE.SphereGeometry(0.02, 16, 12), M.obi, body, [-0.038, 0.07, 0.104], [0, 0, 0.5], [1.4, 0.7, 0.5])
  add(new THREE.SphereGeometry(0.02, 16, 12), M.obi, body, [0.038, 0.07, 0.104], [0, 0, -0.5], [1.4, 0.7, 0.5])
  ribbon(body, [0.022, 0.055, 0.112], 0.05, 0.08, 3, M.obi, 0.35)
  ribbon(body, [-0.022, 0.05, 0.112], 0.045, 0.07, 3, M.obi, 0.2)

  // Hakama waist: a pleated skirt from the obi down over the hips.
  const skirt = lathe([[0.17, -0.2], [0.155, -0.12], [0.138, -0.04], [0.125, 0.035]], 48)
  folds(skirt, 16, 0.007, (y) => Math.min(1, (0.04 - y) * 5))
  add(skirt, M.hakama, body, [0, 0, 0], [0, 0, 0], [1.05, 1, 0.84])

  // Katana at the left hip: a gently curved lacquered scabbard, a round iron guard, a wrapped hilt.
  const katana = joint(body, -0.13, 0.055, -0.01)
  katana.rotation.set(-1.15, 0.05, 0.14)
  const curve = [0, 1, 2, 3, 4].map((i) => [Math.sin(i / 4) * 0.012, -0.52 * (i / 4) + 0.1, 0])
  add(tube(curve, 0.0125, 48, 12), M.lacquer, katana)
  add(new THREE.SphereGeometry(0.0125, 12, 8), M.lacquer, katana, curve[4], [0, 0, 0], [1, 0.6, 1])
  add(new THREE.CylinderGeometry(0.0145, 0.0145, 0.012, 16), M.iron, katana, [0, 0.1, 0]) // koiguchi
  add(new THREE.TorusGeometry(0.009, 0.0026, 6, 12), M.lacquer, katana, [0.012, 0.06, 0], [0, Math.PI / 2, 0]) // kurigata
  const tsuba = new THREE.CylinderGeometry(0.03, 0.03, 0.006, 40)
  tsuba.scale(1, 1, 0.82)
  add(tsuba, M.iron, katana, [0, 0.112, 0])
  add(new THREE.TorusGeometry(0.03, 0.0022, 6, 40), M.gold, katana, [0, 0.112, 0], [Math.PI / 2, 0, 0], [1, 0.82, 1])
  add(new THREE.CylinderGeometry(0.011, 0.012, 0.014, 12), M.gold, katana, [0, 0.122, 0]) // habaki
  add(lathe([[0.0125, 0], [0.0135, 0.04], [0.013, 0.12], [0.0115, 0.165]], 16), M.ito, katana, [0, 0.128, 0])
  add(new THREE.SphereGeometry(0.0122, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), M.iron, katana, [0, 0.292, 0], [0, 0, 0], [1, 0.5, 1]) // kashira
  add(tube([[0.013, 0.09, 0], [0.03, 0.05, -0.012], [0.02, -0.02, 0.01], [0.034, -0.08, 0.004]], 0.0028, 24, 6), M.cord, katana) // sageo

  // ── head ──
  j.neck = joint(body, 0, 0.4, 0)
  add(lathe([[0.037, -0.02], [0.034, 0.02], [0.036, 0.045], [0.042, 0.06]], 24), M.skin, j.neck)
  // Skull and jaw from one profile, narrowed front to back, with a chin pushed forward.
  const head = lathe([[0.0, 0.028], [0.022, 0.03], [0.04, 0.042], [0.055, 0.065], [0.064, 0.09], [0.068, 0.118], [0.064, 0.145], [0.05, 0.168], [0.028, 0.18], [0.0, 0.184]], 40)
  add(head, M.skin, j.neck, [0, 0, 0.004], [0, 0, 0], [0.9, 1, 0.98])
  add(new THREE.SphereGeometry(0.022, 20, 14), M.skin, j.neck, [0, 0.046, -0.034], [0, 0, 0], [1.1, 0.75, 0.8]) // chin
  for (const side of [-1, 1]) {
    add(new THREE.SphereGeometry(0.014, 16, 12), M.skin, j.neck, [side * 0.032, 0.092, -0.046], [0, 0, 0], [1.1, 0.55, 0.6]) // cheekbone
    add(new THREE.SphereGeometry(0.0155, 16, 12), M.skin, j.neck, [side * 0.062, 0.1, 0.006], [0, side * 0.3, 0], [0.42, 1, 0.75]) // ear
    // Eyes set into the face, not on it: a narrow almond of white, a dark iris, a lid over the top.
    const eyeAt = [side * 0.022, 0.104, -0.051]
    add(new THREE.SphereGeometry(0.0078, 16, 12), M.eye, j.neck, eyeAt, [0, 0, 0], [1.05, 0.55, 0.7])
    add(new THREE.SphereGeometry(0.0042, 12, 10), M.iris, j.neck, [eyeAt[0], eyeAt[1], eyeAt[2] - 0.0046], [0, 0, 0], [1, 0.9, 0.6])
    add(tube([[side * 0.012, 0.114, -0.063], [side * 0.024, 0.118, -0.064], [side * 0.036, 0.115, -0.058]], 0.0026, 12, 6), M.hair, j.neck) // brow
    add(tube([[side * 0.013, 0.1075, -0.057], [side * 0.022, 0.1105, -0.0592], [side * 0.032, 0.1075, -0.0545]], 0.0024, 12, 6), M.skin, j.neck) // lid
  }
  // Nose: a short bridge widening to rounded nostrils.
  add(lathe([[0.0105, 0], [0.009, 0.006], [0.006, 0.014], [0.0035, 0.02]], 16), M.skin, j.neck, [0, 0.08, -0.058], [-0.95, 0, 0], [1.3, 1, 0.85])
  add(new THREE.SphereGeometry(0.0078, 14, 10), M.skin, j.neck, [0, 0.077, -0.066], [0, 0, 0], [1.5, 0.9, 1])
  // Closed lips: two soft, flattened rolls.
  add(new THREE.CapsuleGeometry(0.0034, 0.013, 4, 10), M.lips, j.neck, [0, 0.0655, -0.0585], [0, 0, Math.PI / 2], [0.8, 1, 0.8]) // upper lip
  add(new THREE.CapsuleGeometry(0.0038, 0.011, 4, 10), M.lips, j.neck, [0, 0.059, -0.0565], [0, 0, Math.PI / 2], [0.9, 1, 0.85]) // lower lip

  // Hair: a close crop with a clean hairline, a trimmed beard and moustache.
  add(new THREE.SphereGeometry(0.0715, 40, 20, 0, Math.PI * 2, 0, Math.PI * 0.5), M.hair, j.neck, [0, 0.114, 0.007], [0.3, 0, 0], [0.93, 1, 1])
  add(new THREE.SphereGeometry(0.0702, 32, 16, 0, Math.PI, Math.PI * 0.36, Math.PI * 0.3), M.hair, j.neck, [0, 0.1, 0.005], [0, 0, 0], [0.93, 1, 1])
  // A short, close beard along the jaw and chin, leaving the lips clear.
  const beard = new THREE.SphereGeometry(0.0655, 48, 20, Math.PI * 1.06, Math.PI * 0.88, Math.PI * 0.64, Math.PI * 0.26)
  folds(beard, 40, 0.0008)
  add(beard, M.hair, j.neck, [0, 0.1, 0.001], [0, 0, 0], [0.91, 1.02, 1])
  add(new THREE.SphereGeometry(0.02, 20, 12, 0, Math.PI * 2, Math.PI * 0.45, Math.PI * 0.5), M.hair, j.neck, [0, 0.047, -0.034], [0.2, 0, 0], [1.2, 0.85, 0.9]) // chin beard
  add(tube([[-0.019, 0.063, -0.054], [-0.009, 0.0705, -0.0605], [0.009, 0.0705, -0.0605], [0.019, 0.063, -0.054]], 0.0028, 16, 6), M.hair, j.neck) // moustache

  // Topknot: locs gathered up from the crown into a tied bun, a few ends falling back.
  const crown = [0, 0.182, 0.02]
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2
    const start = [Math.cos(a) * 0.045, 0.16 + Math.sin(a) * 0.01, 0.01 + Math.sin(a) * 0.04]
    add(tube([start, [start[0] * 0.5, 0.182, start[2] * 0.5 + 0.012], crown], 0.0062, 12, 6), M.hair, j.neck)
  }
  const bun = new THREE.SphereGeometry(0.026, 28, 18)
  folds(bun, 9, 0.0025, () => 1, 40)
  add(bun, M.hair, j.neck, [0, 0.2, 0.024], [0.3, 0, 0], [1, 0.85, 1])
  add(new THREE.TorusGeometry(0.014, 0.0038, 8, 20), M.band, j.neck, [0, 0.183, 0.021], [Math.PI / 2 - 0.3, 0, 0])
  for (let i = 0; i < 4; i++) {
    const x = (i - 1.5) * 0.009
    add(tube([[x, 0.205, 0.04], [x * 1.4, 0.2, 0.07], [x * 1.8, 0.175, 0.085]], 0.0045, 12, 6), M.hair, j.neck)
  }

  // Headband with a knot at the back and two tails.
  add(new THREE.TorusGeometry(0.0685, 0.0052, 10, 64), M.band, j.neck, [0, 0.122, 0.006], [Math.PI / 2 + 0.22, 0, 0], [0.93, 1, 1])
  add(new THREE.SphereGeometry(0.011, 14, 10), M.band, j.neck, [0, 0.11, 0.07], [0, 0, 0], [1.4, 1, 0.8])
  ribbon(j.neck, [0.01, 0.105, 0.074], 0.02, 0.055, 4, M.band, 0.5)
  ribbon(j.neck, [-0.01, 0.102, 0.074], 0.018, 0.05, 4, M.band, 0.65)

  // ── arms ──
  for (const side of [-1, 1]) {
    const name = side < 0 ? 'L' : 'R'
    const shoulder = joint(body, side * 0.15, 0.33, 0)

    // A wide, folded sleeve, open at the elbow.
    const sleeve = lathe([[0.084, -0.25], [0.07, -0.16], [0.056, -0.06], [0.046, 0.02]], 32)
    folds(sleeve, 7, 0.006, (y) => Math.min(1, -y * 5), 10)
    add(sleeve, M.kimono, shoulder, [0, 0, 0], [0, 0, 0], [1, 1, 0.92])
    add(lathe([[0.034, -0.22], [0.04, -0.1], [0.043, 0.0]], 20), M.skin, shoulder) // upper arm, mostly hidden

    // Sode: four curved lacquered lames laced with silk, draped over the outside of the arm.
    // Hugging the outside of the sleeve, each lame a little wider than the one above.
    const guard = joint(shoulder, 0, 0.012, 0)
    guard.rotation.z = side * 0.12
    const center = side > 0 ? Math.PI / 2 : -Math.PI / 2
    for (let r = 0; r < 4; r++) {
      const top = 0.056 + r * 0.007
      const lame = new THREE.CylinderGeometry(top, top + 0.006, 0.026, 28, 1, true, center - 0.7, 1.4)
      add(lame, M.lacquer, guard, [0, -0.006 - r * 0.024, 0])
    }
    for (const a of [-0.45, 0, 0.45]) {
      const ang = center + a
      const pts = [0, 1, 2, 3, 4].map((k) => {
        const rad = 0.058 + k * 0.0068
        return [Math.sin(ang) * rad, -0.006 - k * 0.022, Math.cos(ang) * rad]
      })
      add(tube(pts, 0.0021, 16, 5), M.cord, guard)
    }

    const elbow = joint(shoulder, 0, -0.22, 0)
    // Forearm with some shape to it, a cloth wrap from wrist to mid-forearm, and a cord tie.
    add(lathe([[0.023, -0.205], [0.026, -0.17], [0.033, -0.1], [0.037, -0.04], [0.034, 0.0]], 24), M.skin, elbow)
    const wrap = lathe([[0.027, -0.205], [0.029, -0.16], [0.034, -0.11]], 24)
    add(wrap, M.wrap, elbow)
    add(new THREE.TorusGeometry(0.03, 0.0028, 6, 20), M.cord, elbow, [0, -0.16, 0], [Math.PI / 2, 0, 0])

    // A closed fist: palm, four curled fingers, thumb across the front.
    const hand = joint(elbow, 0, -0.225, 0)
    add(new THREE.SphereGeometry(0.03, 20, 14), M.skin, hand, [0, -0.01, 0], [0, 0, 0], [1.05, 1.2, 0.8])
    for (let f = 0; f < 4; f++) {
      const x = (f - 1.5) * 0.0145
      add(new THREE.CapsuleGeometry(0.0078, 0.014, 4, 10), M.skin, hand, [x, -0.034, -0.012], [1.35, 0, 0])
      add(new THREE.CapsuleGeometry(0.0072, 0.01, 4, 10), M.skin, hand, [x, -0.03, -0.028], [0.3, 0, 0])
    }
    add(new THREE.CapsuleGeometry(0.0082, 0.022, 4, 10), M.skin, hand, [side * -0.006, -0.018, -0.03], [0, 0, side * 1.25])

    // ── legs ──
    const hip = joint(body, side * 0.068, -0.01, 0)
    const thigh = lathe([[0.1, -0.29], [0.092, -0.2], [0.083, -0.1], [0.074, 0.0]], 36)
    folds(thigh, 9, 0.006, () => 1, 3)
    add(thigh, M.hakama, hip)
    const knee = joint(hip, 0, -0.27, 0)
    const shin = lathe([[0.134, -0.245], [0.12, -0.16], [0.106, -0.06], [0.098, 0.02]], 40)
    folds(shin, 11, 0.009, (y) => Math.min(1, 0.4 - y * 3), 2)
    add(shin, M.hakama, knee)
    add(lathe([[0.024, -0.27], [0.027, -0.2], [0.035, -0.1], [0.038, 0.0]], 20), M.skin, knee)

    // Tabi sock and straw waraji with dark straps.
    const foot = joint(knee, 0, -0.28, -0.02)
    add(new THREE.SphereGeometry(0.03, 20, 14), M.tabi, foot, [0, 0.0, -0.01], [0, 0, 0], [0.95, 0.75, 1.9])
    const sole = new THREE.Shape()
    sole.absellipse(0, 0, 0.034, 0.068, 0, Math.PI * 2)
    const soleGeo = new THREE.ExtrudeGeometry(sole, { depth: 0.01, bevelEnabled: true, bevelThickness: 0.002, bevelSize: 0.002, bevelSegments: 2, curveSegments: 24 })
    soleGeo.rotateX(Math.PI / 2)
    add(soleGeo, M.straw, foot, [0, -0.018, -0.012])
    add(new THREE.TorusGeometry(0.03, 0.0032, 6, 20, Math.PI), M.wrap, foot, [0, -0.012, -0.03], [0, 0, 0], [1, 1.1, 1])
    add(new THREE.TorusGeometry(0.03, 0.003, 6, 20, Math.PI), M.wrap, foot, [0, -0.01, 0.018], [0, 0, 0], [1, 1.2, 1])

    j['shoulder' + name] = shoulder
    j['elbow' + name] = elbow
    j['hip' + name] = hip
    j['knee' + name] = knee
  }

  // The aura shell is supplied by the flight code, which owns its look.
  const aura = new THREE.Mesh(new THREE.CapsuleGeometry(0.36, 0.7, 16, 32), auraMaterial)
  aura.position.y = 0.1
  body.add(aura)

  return { root, body, joints: j, aura, ribbons, materials: M }
}

/**
 * A small, dim studio for reflections: a dark gradient dome with one warm light and one cool rim,
 * pre-filtered once. It gives the lacquer, metal and silk something to reflect so they read as
 * materials instead of flat colour.
 */
export function makeEnvironment(renderer) {
  const scene = new THREE.Scene()
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(10, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'varying vec3 vP; void main(){ vec3 top = vec3(0.05,0.07,0.12); vec3 bottom = vec3(0.07,0.04,0.025); gl_FragColor = vec4(mix(bottom, top, smoothstep(-0.6, 0.8, vP.y)), 1.0); }',
    })
  )
  scene.add(dome)
  const panel = (color, strength, pos, size) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(strength), side: THREE.DoubleSide }))
    m.position.set(...pos)
    m.lookAt(0, 0, 0)
    scene.add(m)
  }
  panel('#ffd2a0', 9, [6, 4, -3], 3.5)
  panel('#8fb0ff', 3, [-6, 2, 4], 4)
  panel('#ffffff', 1.2, [0, 9, 0], 5)
  const pmrem = new THREE.PMREMGenerator(renderer)
  const env = pmrem.fromScene(scene, 0.03).texture
  pmrem.dispose()
  return env
}
