import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { seeded } from './layout.js'

/**
 * The stage: an empty black sky, a camera with some weight to it, and the glow.
 *
 * Nothing in here knows about tasks. The background stars are the one purely decorative thing in
 * the whole view, which is why they're faint, tiny and far away — they must never be mistaken for
 * a thought.
 */
export function createScene(container) {
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches

  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
  renderer.setSize(innerWidth, innerHeight)
  renderer.setClearColor(0x000000, 1)
  container.appendChild(renderer.domElement)
  renderer.domElement.className = 'g-canvas'

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(52, innerWidth / innerHeight, 0.1, 3000)
  camera.position.set(0, 120, 250)

  const controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.dampingFactor = 0.055
  controls.zoomToCursor = true
  controls.screenSpacePanning = true
  controls.minDistance = 6
  controls.maxDistance = 760
  controls.rotateSpeed = 0.55
  controls.autoRotate = !reducedMotion
  controls.autoRotateSpeed = 0.18

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

  scene.add(createStarfield())

  const composer = new EffectComposer(renderer)
  composer.addPass(new RenderPass(scene, camera))
  const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.95, 0.65, 0.05)
  composer.addPass(bloom)
  composer.addPass(new OutputPass())

  const uniforms = { uTime: { value: 0 }, uPixelRatio: { value: renderer.getPixelRatio() } }

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

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight
    applyShift()
    camera.updateProjectionMatrix()
    renderer.setSize(innerWidth, innerHeight)
    composer.setSize(innerWidth, innerHeight)
    uniforms.uPixelRatio.value = renderer.getPixelRatio()
  })

  /** Glide the camera to look at a point, easing in and out. */
  let flight = null
  function flyTo(target, distance = 42) {
    const from = { pos: camera.position.clone(), look: controls.target.clone() }
    const dir = camera.position.clone().sub(controls.target).normalize()
    const to = { look: target.clone(), pos: target.clone().add(dir.multiplyScalar(distance)) }
    // Timed by the wall clock, not by frames — a throttled tab or a slow phone still gets there in 1.4s.
    flight = { from, to, start: performance.now(), duration: reducedMotion ? 10 : 1400 }
    controls.autoRotate = false
    clearTimeout(resumeTimer)
  }

  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2)

  // Frame-time governor: if the glow is making frames slow, drop it rather than stutter. It only
  // ever turns glow *off* under what you chose; it never turns on something you switched off.
  let slowFrames = 0
  let bloomOn = true

  function setQuality({ bloom, pixelRatio } = {}) {
    if (typeof bloom === 'boolean') {
      bloomOn = bloom
      slowFrames = 0
    }
    if (pixelRatio) {
      renderer.setPixelRatio(Math.min(devicePixelRatio, pixelRatio))
      composer.setPixelRatio(renderer.getPixelRatio())
      composer.setSize(innerWidth, innerHeight)
      uniforms.uPixelRatio.value = renderer.getPixelRatio()
    }
  }

  function render(dt) {
    uniforms.uTime.value += dt
    if (flight) {
      const t = Math.min(1, (performance.now() - flight.start) / flight.duration)
      const k = ease(t)
      camera.position.lerpVectors(flight.from.pos, flight.to.pos, k)
      controls.target.lerpVectors(flight.from.look, flight.to.look, k)
      if (t >= 1) flight = null
    }
    controls.update()

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
    if (bloomOn) composer.render()
    else renderer.render(scene, camera)
    if (bloomOn) {
      slowFrames = performance.now() - started > 22 ? slowFrames + 1 : Math.max(0, slowFrames - 1)
      if (slowFrames > 90) bloomOn = false
    }
  }

  return {
    renderer, scene, camera, controls, uniforms, flyTo, render, setViewShift, setQuality, reducedMotion,
    get flying() {
      return Boolean(flight) || Math.abs(shiftTarget - shift) > 0.25
    },
  }
}

/** A few thousand far, faint stars — denser along a tilted band, like looking into a disc. */
function createStarfield() {
  const COUNT = 5000
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
    const r = 1100 + rand() * 400
    // Tilt the band so it crosses the view diagonally instead of sitting flat on the horizon.
    const x = ring * Math.cos(theta)
    const z = ring * Math.sin(theta)
    const tilt = 0.45
    positions.set([x * r, (y * Math.cos(tilt) + z * Math.sin(tilt)) * r, (z * Math.cos(tilt) - y * Math.sin(tilt)) * r], i * 3)
    tint.setHSL(0.58 + rand() * 0.12, 0.35, 0.72 + rand() * 0.25)
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
        gl_FragColor = vec4(vColor * a * a * vTwinkle * 0.5, 1.0);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })

  const points = new THREE.Points(geometry, material)
  points.frustumCulled = false
  points.onBeforeRender = () => {
    material.uniforms.uTime.value = performance.now() / 1000
  }
  return points
}
