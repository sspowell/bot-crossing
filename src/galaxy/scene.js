import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js'
import { seeded } from './layout.js'
import { NOISE } from './glsl.js'

/**
 * The stage: deep space, a camera with some weight to it, and the light.
 *
 * Nothing in here knows about tasks. The nebula, the far stars and the drifting motes are the only
 * purely decorative things in the view, which is why they stay dim, far away or tiny — they set
 * the mood and must never be mistaken for a sun or a world.
 */
export function createScene(container) {
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches

  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
  renderer.setSize(innerWidth, innerHeight)
  renderer.setClearColor(0x000000, 1)
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 0.95
  container.appendChild(renderer.domElement)
  renderer.domElement.className = 'g-canvas'

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(48, innerWidth / innerHeight, 0.1, 9000)
  camera.position.set(0, 150, 460)

  const controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.dampingFactor = 0.05
  controls.zoomToCursor = true
  controls.screenSpacePanning = true
  controls.minDistance = 4
  controls.maxDistance = 1500
  controls.rotateSpeed = 0.5
  controls.autoRotate = !reducedMotion
  controls.autoRotateSpeed = 0.14

  // A slow drift that yields the instant you touch the sky and comes back once you let go.
  let resumeTimer = 0
  controls.addEventListener('start', () => {
    controls.autoRotate = false
    clearTimeout(resumeTimer)
  })
  controls.addEventListener('end', () => {
    clearTimeout(resumeTimer)
    if (!reducedMotion) resumeTimer = setTimeout(() => (controls.autoRotate = true), 5000)
  })

  const uniforms = { uTime: { value: 0 }, uPixelRatio: { value: renderer.getPixelRatio() } }

  scene.add(createNebula(uniforms))
  scene.add(createStarfield())
  const motes = createMotes(uniforms)
  scene.add(motes)

  const composer = new EffectComposer(renderer)
  composer.addPass(new RenderPass(scene, camera))
  const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.85, 0.6, 0.72)
  composer.addPass(bloom)
  composer.addPass(new OutputPass())
  const grade = new ShaderPass(gradeShader)
  composer.addPass(grade)

  // When a side panel covers part of the screen, slide the scene's visual centre into the space
  // that's left, so whatever the camera focuses on isn't hidden behind the panel.
  let shift = 0
  let shiftTarget = 0
  const setViewShift = (px) => (shiftTarget = innerWidth > 760 ? px : 0)
  const applyShift = () => {
    if (Math.abs(shift) < 0.5 && shiftTarget === 0) {
      if (camera.view) camera.clearViewOffset()
      return
    }
    camera.setViewOffset(innerWidth, innerHeight, shift, 0, innerWidth, innerHeight)
  }

  const setGradeSize = () => {
    grade.uniforms.uAspect.value = innerWidth / innerHeight
    grade.uniforms.uResolution.value.set(innerWidth * renderer.getPixelRatio(), innerHeight * renderer.getPixelRatio())
  }
  setGradeSize()

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight
    applyShift()
    camera.updateProjectionMatrix()
    renderer.setSize(innerWidth, innerHeight)
    composer.setSize(innerWidth, innerHeight)
    uniforms.uPixelRatio.value = renderer.getPixelRatio()
    setGradeSize()
  })

  /**
   * Glide the camera to look at a point, easing in and out. Pass `track` — a function returning
   * the point's current position — to chase something that moves, and keep following it after.
   */
  let flight = null
  let follow = null
  const lastFollow = new THREE.Vector3()
  function flyTo(target, distance = 42, track = null) {
    const from = { pos: camera.position.clone(), look: controls.target.clone() }
    const dir = camera.position.clone().sub(controls.target).normalize()
    // Timed by the wall clock, not by frames — a throttled tab or a slow phone still gets there on time.
    flight = { from, target: target.clone(), dir, distance, track, start: performance.now(), duration: reducedMotion ? 10 : 1600 }
    follow = null
    controls.autoRotate = false
    clearTimeout(resumeTimer)
  }
  const stopFollowing = () => {
    follow = null
    if (flight) flight.track = null
  }

  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2)

  // Governor: if the glow is making frames slow, drop it rather than stutter. It only ever turns
  // glow *off* under what you chose; it never turns on something you switched off.
  let slowFrames = 0
  let bloomOn = true

  function setQuality({ bloom: on, pixelRatio } = {}) {
    if (typeof on === 'boolean') {
      bloomOn = on
      bloom.enabled = on
      slowFrames = 0
    }
    if (pixelRatio) {
      renderer.setPixelRatio(Math.min(devicePixelRatio, pixelRatio))
      composer.setPixelRatio(renderer.getPixelRatio())
      composer.setSize(innerWidth, innerHeight)
      uniforms.uPixelRatio.value = renderer.getPixelRatio()
      setGradeSize()
    }
  }

  function render(dt) {
    uniforms.uTime.value += dt
    grade.uniforms.uTime.value = uniforms.uTime.value
    if (flight) {
      const t = Math.min(1, (performance.now() - flight.start) / flight.duration)
      const k = ease(t)
      const look = flight.track?.() || flight.target
      const pos = look.clone().addScaledVector(flight.dir, flight.distance)
      camera.position.lerpVectors(flight.from.pos, pos, k)
      controls.target.lerpVectors(flight.from.look, look, k)
      if (t >= 1) {
        if (flight.track) {
          follow = flight.track
          lastFollow.copy(look)
        }
        flight = null
      }
    } else if (follow) {
      const p = follow()
      if (!p) follow = null
      else {
        const dx = p.x - lastFollow.x
        const dy = p.y - lastFollow.y
        const dz = p.z - lastFollow.z
        camera.position.x += dx
        camera.position.y += dy
        camera.position.z += dz
        controls.target.set(controls.target.x + dx, controls.target.y + dy, controls.target.z + dz)
        lastFollow.copy(p)
      }
    }
    controls.update()
    motes.position.copy(camera.position)

    if (Math.abs(shiftTarget - shift) > 0.25) {
      shift += (shiftTarget - shift) * (1 - Math.exp(-dt * 5))
      applyShift()
    } else if (shift !== shiftTarget) {
      shift = shiftTarget
      applyShift()
    }

    // Time the render itself, not the gap between frames. The gap is also long when the page is
    // deliberately idling at 30fps or the tab is throttled, and neither means the glow is too heavy.
    const started = performance.now()
    composer.render()
    if (bloom.enabled) {
      slowFrames = performance.now() - started > 22 ? slowFrames + 1 : Math.max(0, slowFrames - 1)
      if (slowFrames > 90) bloom.enabled = false
    }
  }

  return {
    renderer, scene, camera, controls, uniforms, flyTo, stopFollowing, render, setViewShift, setQuality, reducedMotion,
    get flying() {
      return Boolean(flight) || Math.abs(shiftTarget - shift) > 0.25
    },
    get bloomOn() {
      return bloomOn
    },
  }
}

/** Vignette, a whisper of lens fringing at the edges, film grain, and cold shadows. */
const gradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uAspect: { value: 1 },
    uResolution: { value: new THREE.Vector2(1, 1) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uAspect;
    uniform vec2 uResolution;
    varying vec2 vUv;
    float grainHash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec2 c = vUv - 0.5;
      float dist = length(c * vec2(uAspect, 1.0));
      vec2 shift = c * dist * 0.006;
      vec3 col = vec3(
        texture2D(tDiffuse, vUv + shift).r,
        texture2D(tDiffuse, vUv).g,
        texture2D(tDiffuse, vUv - shift).b);
      float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col += vec3(0.0, 0.006, 0.014) * (1.0 - smoothstep(0.0, 0.25, lum));
      col = mix(col, col * vec3(1.04, 0.99, 0.93), smoothstep(0.3, 1.0, lum));
      col *= mix(1.0, smoothstep(1.2, 0.3, dist), 0.78);
      float g = grainHash(floor(vUv * uResolution / 1.5) + fract(uTime * 7.0) * 91.0) - 0.5;
      col += g * 0.028;
      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }`,
}

/** A dome of faint gas and dark dust lanes, far behind everything. */
function createNebula(uniforms) {
  const material = new THREE.ShaderMaterial({
    uniforms,
    side: THREE.BackSide,
    depthWrite: false,
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      varying vec3 vDir;
      ${NOISE}
      void main() {
        vec3 d = normalize(vDir);
        vec3 p = d * 2.4 + vec3(0.0, 0.0, uTime * 0.003);
        float warp = fbm(p * 1.3);
        float gas = fbm(p + warp * 1.8);
        float lanes = smoothstep(0.42, 0.62, fbm(p * 2.6 + 4.0));
        // Densest along the same tilted band as the far stars.
        float band = exp(-pow(dot(d, normalize(vec3(0.0, 0.9, -0.42))) * 2.6, 2.0));
        vec3 indigo = vec3(0.035, 0.03, 0.09);
        vec3 rust = vec3(0.13, 0.045, 0.03);
        vec3 teal = vec3(0.012, 0.07, 0.075);
        vec3 col = mix(indigo, teal, smoothstep(0.35, 0.7, warp));
        col = mix(col, rust, smoothstep(0.55, 0.8, gas) * 0.8);
        float density = smoothstep(0.4, 0.9, gas) * (0.2 + band * 1.0);
        col *= density * (1.0 - lanes * 0.75);
        gl_FragColor = vec4(col * 0.42, 1.0);
      }`,
  })
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(4200, 64, 32), material)
  mesh.renderOrder = -2
  mesh.frustumCulled = false
  return mesh
}

/** A few thousand far, faint stars — denser along a tilted band, like looking into a disc. */
function createStarfield() {
  const COUNT = 6000
  const rand = seeded(7)
  const positions = new Float32Array(COUNT * 3)
  const colors = new Float32Array(COUNT * 3)
  const sizes = new Float32Array(COUNT)
  const seeds = new Float32Array(COUNT)
  const tint = new THREE.Color()

  for (let i = 0; i < COUNT; i++) {
    const inBand = rand() < 0.55
    const theta = rand() * Math.PI * 2
    const y = inBand ? (rand() - 0.5) * 0.25 : rand() * 2 - 1
    const ring = Math.sqrt(1 - y * y)
    const r = 2600 + rand() * 900
    const x = ring * Math.cos(theta)
    const z = ring * Math.sin(theta)
    const tilt = 0.45
    positions.set([x * r, (y * Math.cos(tilt) + z * Math.sin(tilt)) * r, (z * Math.cos(tilt) - y * Math.sin(tilt)) * r], i * 3)
    const warm = rand() < 0.3
    tint.setHSL(warm ? 0.07 + rand() * 0.05 : 0.58 + rand() * 0.08, warm ? 0.5 : 0.3, 0.7 + rand() * 0.25)
    colors.set([tint.r, tint.g, tint.b], i * 3)
    sizes[i] = (rand() ** 3) * 2.4 + 0.6
    seeds[i] = rand()
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1))
  geometry.setAttribute('seed', new THREE.BufferAttribute(seeds, 1))

  const material = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: /* glsl */ `
      attribute float size;
      attribute float seed;
      attribute vec3 color;
      uniform float uTime;
      varying vec3 vColor;
      varying float vTwinkle;
      void main() {
        vColor = color;
        vTwinkle = 0.55 + 0.45 * sin(uTime * (0.3 + seed * 1.4) + seed * 60.0);
        gl_PointSize = size;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vColor;
      varying float vTwinkle;
      void main() {
        float d = length(gl_PointCoord - 0.5) * 2.0;
        float a = smoothstep(1.0, 0.0, d);
        gl_FragColor = vec4(vColor * a * a * vTwinkle * 0.55, 1.0);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })

  const points = new THREE.Points(geometry, material)
  points.frustumCulled = false
  points.renderOrder = -1
  points.onBeforeRender = () => {
    material.uniforms.uTime.value = performance.now() / 1000
  }
  return points
}

/**
 * Dust drifting past the lens. It rides along with the camera and wraps around it, so there is
 * always a little parallax when you move — the cheapest way to feel like you're *in* space.
 */
function createMotes(uniforms) {
  const COUNT = 900
  const BOX = 160
  const rand = seeded(19)
  const positions = new Float32Array(COUNT * 3)
  const seeds = new Float32Array(COUNT)
  for (let i = 0; i < COUNT; i++) {
    positions.set([(rand() - 0.5) * BOX, (rand() - 0.5) * BOX, (rand() - 0.5) * BOX], i * 3)
    seeds[i] = rand()
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('seed', new THREE.BufferAttribute(seeds, 1))
  const material = new THREE.ShaderMaterial({
    uniforms: { ...uniforms, uBox: { value: BOX } },
    vertexShader: /* glsl */ `
      attribute float seed;
      uniform float uTime;
      uniform float uPixelRatio;
      uniform float uBox;
      varying float vAlpha;
      void main() {
        // Wrap each mote into a box centred on the camera, drifting slowly.
        vec3 world = position + vec3(uTime * (0.4 + seed), sin(uTime * 0.1 + seed * 30.0) * 3.0, uTime * 0.3);
        vec3 camWorld = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
        vec3 local = mod(world - camWorld + uBox * 0.5, uBox) - uBox * 0.5;
        vec4 mv = viewMatrix * vec4(camWorld + local, 1.0);
        float depth = max(-mv.z, 0.5);
        gl_PointSize = clamp((0.35 + seed * 0.5) * uPixelRatio * 90.0 / depth, 0.5, 6.0);
        vAlpha = smoothstep(uBox * 0.5, uBox * 0.2, length(local)) * smoothstep(1.0, 6.0, depth) * (0.25 + seed * 0.35);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      varying float vAlpha;
      void main() {
        float d = length(gl_PointCoord - 0.5) * 2.0;
        float a = smoothstep(1.0, 0.0, d) * vAlpha;
        if (a < 0.003) discard;
        gl_FragColor = vec4(vec3(0.95, 0.85, 0.72) * a * 0.5, 1.0);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })
  const points = new THREE.Points(geometry, material)
  points.frustumCulled = false
  return points
}
