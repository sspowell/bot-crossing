import * as THREE from 'three'
import { NOISE } from './glsl.js'
import { sunRadiusOf } from './layout.js'

/**
 * The solar systems of your mind.
 *
 * Every visible thing means something:
 *   a sun          one TickTick list — bigger with more tasks in it
 *   a planet       one open task, lit by its own sun
 *   an orbit line  the path it travels; the bright tail is where it just was
 *   size           priority — heavier tasks are bigger worlds
 *   rings          top priority
 *   moons          checklist steps; bright ones still to do, dark ones done
 *   cracking red   overdue — tangled. The longer it's overdue, the lower its orbit falls toward
 *                  the sun and the hotter it glows
 *   gold aurora    due today — asking for you
 *   a filament     two systems joined: every sun is linked into one web, and links carrying
 *                  shared tags burn brighter
 *   a dust stream  the same link made of matter — dust flowing out of each system toward its
 *                  neighbour, thick where it leaves a sun and thinning to a thread in between,
 *                  so the systems touch without merging
 *   a light thread two tasks in different lists sharing a tag — the tangle itself
 *
 * One draw per kind: all suns are one instanced mesh, all planets another, all moons, rings,
 * coronas, lines and sparks likewise. Positions are computed on the CPU each frame because there
 * are tens or hundreds of them, and CPU positions are also what picking, labels and the card read.
 */

const STARLIGHT = new THREE.Color('#f4ecdf')
const TANGLED = new THREE.Color('#ff5a4a')
const ASKING = new THREE.Color('#ffc46b')
const KIND = { drifting: 0, asking: 1, tangled: 2 }

export const stateOf = (thread) => (thread.hasError ? 'tangled' : thread.unread ? 'asking' : 'drifting')

/** How far an overdue task's orbit has decayed toward its sun: none on day zero, most of the way by ~6 weeks. */
const MAX_SINK = 0.72
const sinkOf = (t) => (t.state === 'tangled' ? Math.min(MAX_SINK, (Number(t.thread.overdueDays) || 0) / 45) : 0)

const ORBIT_SEGMENTS = 96
const THREAD_SEGMENTS = 40
const FILAMENT_SEGMENTS = 64

// ── shaders ─────────────────────────────────────────────────────────────────────────
const sunVertex = /* glsl */ `
  attribute vec3 aColor;
  attribute float aGlow;
  attribute float aSeed;
  varying vec3 vObj;
  varying vec3 vN;
  varying vec3 vP;
  varying vec3 vColor;
  varying float vGlow;
  varying float vSeed;
  void main() {
    vObj = position;
    vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
    vN = normalize(mat3(modelMatrix * instanceMatrix) * normal);
    vP = wp.xyz;
    vColor = aColor;
    vGlow = aGlow;
    vSeed = aSeed;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }`

const sunFragment = /* glsl */ `
  uniform float uTime;
  varying vec3 vObj;
  varying vec3 vN;
  varying vec3 vP;
  varying vec3 vColor;
  varying float vGlow;
  varying float vSeed;
  ${NOISE}
  void main() {
    vec3 N = normalize(vN);
    vec3 V = normalize(cameraPosition - vP);
    float mu = max(dot(N, V), 0.0);
    vec3 o = vObj * 2.1 + vec3(vSeed * 40.0, uTime * 0.02, 0.0);
    float warp = fbm(o * 1.4 + vec3(0.0, 0.0, uTime * 0.04));
    float plasma = fbm(o + warp * 1.6);
    float cells = fbm(vObj * 11.0 + vec3(uTime * 0.07, vSeed * 9.0, 0.0));
    float heat = plasma * 0.72 + cells * 0.28;
    vec3 hot = mix(vColor, vec3(1.0, 0.97, 0.9), 0.6);
    vec3 deep = vColor * vec3(0.85, 0.42, 0.26);
    vec3 col = mix(deep, hot, smoothstep(0.32, 0.72, heat));
    // Sunspots: dark umbrae with softer penumbrae, drifting slowly; bright faculae toward the limb.
    float spotField = fbm(vObj * 3.2 + vec3(vSeed * 7.0, uTime * 0.006, 0.0));
    float umbra = smoothstep(0.66, 0.72, spotField);
    float penumbra = smoothstep(0.6, 0.68, spotField);
    col *= 1.0 - penumbra * 0.45 - umbra * 0.4;
    col += hot * smoothstep(0.55, 0.7, cells) * pow(1.0 - mu, 2.0) * 0.5;
    col *= 0.45 + 0.55 * pow(mu, 0.5);
    col += vColor * pow(1.0 - mu, 3.0) * 0.9;
    gl_FragColor = vec4(col * 1.7 * vGlow, 1.0);
  }`

/** Camera-facing quads around each sun: a hot haze and slow, shifting rays. */
const coronaVertex = /* glsl */ `
  attribute vec3 aColor;
  attribute float aGlow;
  attribute float aSeed;
  attribute float aScale;
  varying vec2 vUv;
  varying vec3 vColor;
  varying float vGlow;
  varying float vSeed;
  void main() {
    vec4 center = viewMatrix * modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    center.xy += position.xy * aScale;
    vUv = position.xy;
    vColor = aColor;
    vGlow = aGlow;
    vSeed = aSeed;
    gl_Position = projectionMatrix * center;
  }`

const coronaFragment = /* glsl */ `
  uniform float uTime;
  varying vec2 vUv;
  varying vec3 vColor;
  varying float vGlow;
  varying float vSeed;
  ${NOISE}
  void main() {
    float d = length(vUv);
    if (d > 1.0) discard;
    float r = max(d * 7.0, 1.0);              // 1.0 at the sun's edge, 7.0 at the quad's edge
    float haze = exp(-(r - 1.0) * 1.9);
    float wide = exp(-(r - 1.0) * 0.45) * 0.08;
    float ang = atan(vUv.y, vUv.x);
    float rays = fbm(vec3(cos(ang) * 2.8, sin(ang) * 2.8, uTime * 0.05 + vSeed * 13.0));
    float ray = pow(smoothstep(0.45, 0.8, rays), 2.0) * exp(-(r - 1.0) * 0.6) * 0.7;
    float a = (haze * 0.95 + ray + wide) * smoothstep(1.0, 0.72, d) * vGlow;
    // Prominences: loops of hot gas standing off the edge of the sun, slowly changing shape.
    vec3 around = vec3(cos(ang) * 5.0, sin(ang) * 5.0, uTime * 0.04 + vSeed * 20.0);
    float arcs = smoothstep(0.58, 0.8, fbm(around)) * smoothstep(0.35, 0.95, fbm(around * 2.3 + (r - 1.0) * 6.0));
    float prom = arcs * smoothstep(1.0, 1.04, r) * (1.0 - smoothstep(1.08, 1.45, r)) * vGlow;
    if (a + prom < 0.002) discard;
    vec3 promColor = mix(vColor, vec3(1.0, 0.36, 0.14), 0.55);
    gl_FragColor = vec4(vColor * a * 0.75 + promColor * prom * 1.6, 1.0);
  }`

const planetVertex = /* glsl */ `
  attribute vec3 aColor;
  attribute vec3 aSun;
  attribute vec3 aSunColor;
  attribute float aSeed;
  attribute float aKind;
  attribute float aGlow;
  attribute float aHeat;
  attribute float aFlash;
  varying vec3 vObj;
  varying vec3 vN;
  varying vec3 vP;
  varying vec3 vColor;
  varying vec3 vSun;
  varying vec3 vSunColor;
  varying float vSeed;
  varying float vKind;
  varying float vGlow;
  varying float vHeat;
  varying float vFlash;
  varying mat3 vToWorld;
  void main() {
    vObj = position;
    vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
    mat3 m = mat3(modelMatrix * instanceMatrix);
    vToWorld = mat3(normalize(m[0]), normalize(m[1]), normalize(m[2]));
    vN = normalize(m * normal);
    vP = wp.xyz;
    vColor = aColor;
    vSun = aSun;
    vSunColor = aSunColor;
    vSeed = aSeed;
    vKind = aKind;
    vGlow = aGlow;
    vHeat = aHeat;
    vFlash = aFlash;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }`

const planetFragment = /* glsl */ `
  uniform float uTime;
  varying vec3 vObj;
  varying vec3 vN;
  varying vec3 vP;
  varying vec3 vColor;
  varying vec3 vSun;
  varying vec3 vSunColor;
  varying float vSeed;
  varying float vKind;
  varying float vGlow;
  varying float vHeat;
  varying float vFlash;
  varying mat3 vToWorld;
  ${NOISE}

  // Height of the surface at a point on the unit sphere, per kind of world.
  float heightAt(vec3 o, float kind, float seed) {
    if (kind > 2.5) {
      float craters = smoothstep(0.58, 0.66, fbm(o * 9.0 + seed * 3.0));
      return fbm(o * 5.0 + seed * 20.0) * 0.6 - craters * 0.5 + fbm(o * 22.0) * 0.15;
    }
    if (seed < 0.45) return fbm(vec3(o.x * 1.6, o.y * 20.0, o.z * 1.6) + seed * 7.0) * 0.25;
    float h = fbm(o * 2.2 + seed * 31.0);
    float ridges = 1.0 - abs(fbm(o * 7.0 + seed * 11.0) * 2.0 - 1.0);
    return h + max(0.0, h - 0.5) * ridges * 0.6;
  }

  void main() {
    vec3 o = normalize(vObj);
    vec3 base = vColor;
    bool moon = vKind > 2.5;
    bool gas = !moon && vSeed < 0.45;

    // Relief: tilt the normal by the slope of the height field, measured along the surface.
    vec3 t1 = normalize(cross(abs(o.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0), o));
    vec3 t2 = cross(o, t1);
    const float E = 0.006;
    float h0 = heightAt(o, vKind, vSeed);
    float hx = heightAt(normalize(o + t1 * E), vKind, vSeed);
    float hy = heightAt(normalize(o + t2 * E), vKind, vSeed);
    float relief = moon ? 0.9 : gas ? 0.15 : 0.55;
    vec3 bumped = normalize(o - (t1 * (hx - h0) + t2 * (hy - h0)) / E * relief * 0.02);

    vec3 N = normalize(vToWorld * bumped);
    vec3 Ng = normalize(vN);
    vec3 L = normalize(vSun - vP);
    vec3 V = normalize(cameraPosition - vP);
    vec3 surf;
    float wet = 0.0;

    if (moon) {
      surf = mix(vec3(0.1, 0.095, 0.09), vec3(0.62, 0.58, 0.52), clamp(h0 + 0.35, 0.0, 1.0)) * base;
    } else if (gas) {
      // Bands bent by turbulence, a finer shear inside them, and on some worlds a great storm.
      float warp = fbm(o * 2.0 + vSeed * 13.0);
      float band = sin((o.y + warp * 0.38) * (8.0 + vSeed * 16.0)) * 0.5 + 0.5;
      float fine = fbm(vec3(o.x * 1.6, o.y * 26.0, o.z * 1.6) + vSeed * 7.0 + vec3(uTime * 0.012, 0.0, 0.0));
      vec3 light = mix(base, vec3(0.94, 0.86, 0.72), 0.45);
      surf = mix(base * 0.32, light, band * 0.62 + fine * 0.38);
      if (vSeed > 0.12 && vSeed < 0.32) {
        float lon = atan(o.z, o.x) + uTime * 0.01;
        vec2 q = vec2(sin(lon - vSeed * 20.0) * 1.6, (o.y + 0.32) * 4.5);
        float storm = smoothstep(0.55, 0.0, length(q));
        float swirl = fbm(vec3(q * 3.0, uTime * 0.05));
        surf = mix(surf, mix(vec3(0.62, 0.3, 0.18), vec3(0.9, 0.62, 0.44), swirl), storm * 0.85);
      }
    } else {
      // Rocky: deep and shallow seas, lowlands, highlands, snow on the peaks, ice at the poles.
      float sea = 1.0 - smoothstep(0.47, 0.5, h0);
      vec3 deep = mix(base * 0.08, vec3(0.008, 0.035, 0.1), 0.82);
      vec3 shallow = mix(base * 0.2, vec3(0.03, 0.19, 0.26), 0.78);
      vec3 water = mix(deep, shallow, smoothstep(0.38, 0.49, h0));
      vec3 low = mix(base * 0.55, vec3(0.3, 0.32, 0.18), 0.45);
      vec3 high = mix(base * 0.5, vec3(0.42, 0.34, 0.26), 0.6);
      vec3 ground = mix(low, high, smoothstep(0.52, 0.66, h0));
      ground = mix(ground, vec3(0.86, 0.87, 0.9), smoothstep(0.72, 0.8, h0));
      surf = mix(ground, water, sea);
      wet = sea;
      float cap = smoothstep(0.74, 0.84, abs(o.y) + (fbm(o * 6.0 + vSeed) - 0.5) * 0.18);
      surf = mix(surf, vec3(0.9, 0.93, 0.96), cap);
      wet *= 1.0 - cap;
    }

    float ndl = dot(N, L);
    float ndlGeo = dot(Ng, L);
    float day = smoothstep(-0.12, 0.45, ndl) * smoothstep(-0.25, 0.05, ndlGeo);
    float nearSun = clamp(24.0 / length(vSun - vP), 0.65, 1.1);
    vec3 col = surf * vSunColor * day * nearSun + surf * 0.012;

    if (!moon && !gas) {
      // Weather, with the clouds' shadows cast a little away from the sun onto the ground below.
      vec3 drift = vec3(uTime * 0.018, vSeed * 9.0, 0.0);
      float cloud = smoothstep(0.55, 0.8, fbm(o * 3.4 + drift));
      vec3 Lo = normalize(transpose(vToWorld) * L);
      float shade = smoothstep(0.55, 0.8, fbm(normalize(o - Lo * 0.025) * 3.4 + drift));
      col *= 1.0 - shade * 0.45 * day;
      col = mix(col, vec3(0.9, 0.9, 0.88) * vSunColor * (day * nearSun + 0.02), cloud * 0.6);
      wet *= 1.0 - cloud;
      // Sunlight glinting off open water.
      vec3 H = normalize(L + V);
      col += vSunColor * pow(max(dot(normalize(Ng + (N - Ng) * 0.3), H), 0.0), 90.0) * wet * day * 1.4;
    }

    float fres = pow(1.0 - max(dot(Ng, V), 0.0), 2.6);
    float lit = 0.1 + 0.9 * smoothstep(-0.35, 0.45, ndlGeo);
    if (!moon) {
      // Atmosphere: blue-white on rocky worlds, the planet's own tint on gas giants, and a band of
      // sunset orange right at the terminator.
      vec3 air = gas ? mix(base, vSunColor, 0.5) : mix(vec3(0.45, 0.65, 1.0), vSunColor, 0.35);
      float dusk = smoothstep(-0.25, 0.05, ndlGeo) * smoothstep(0.35, 0.0, ndlGeo);
      col += air * fres * lit * 0.8;
      col += vec3(1.0, 0.45, 0.2) * vSunColor * fres * dusk * 0.9;
    }

    if (vKind > 1.5 && vKind < 2.5) {
      // Tangled: the crust cracks and glows, hotter the further it has fallen.
      float beat = 0.6 + 0.4 * sin(uTime * 2.1 + vSeed * 40.0);
      float c = fbm(o * 4.2 + vSeed * 17.0);
      float crack = smoothstep(0.05, 0.0, abs(c - 0.5));
      col = mix(col, col * vec3(1.15, 0.4, 0.3), 0.3 + vHeat * 0.5);
      col += vec3(1.0, 0.2, 0.1) * crack * (0.8 + vHeat * 2.2) * beat;
      col += vec3(1.0, 0.28, 0.2) * fres * 0.9 * beat;
    } else if (vKind > 0.5 && vKind < 1.5) {
      // Asking: a gold aurora breathing around the rim.
      float beat = 0.5 + 0.5 * sin(uTime * 3.3 + vSeed * 40.0);
      col += vec3(1.0, 0.7, 0.32) * fres * (1.0 + beat * 1.2);
    }

    col *= min(vGlow, 1.0);
    col += vec3(0.95, 0.92, 0.85) * fres * max(vGlow - 1.0, 0.0) * 0.6;
    col += vec3(1.0, 0.94, 0.82) * vFlash * 3.0;
    gl_FragColor = vec4(col, 1.0);
  }`

const ringVertex = /* glsl */ `
  attribute vec3 aColor;
  attribute vec3 aSun;
  attribute vec3 aSunColor;
  attribute float aGlow;
  attribute float aSeed;
  varying vec3 vObj;
  varying vec3 vP;
  varying vec3 vNW;
  varying vec3 vColor;
  varying vec3 vSun;
  varying vec3 vSunColor;
  varying float vGlow;
  varying float vSeed;
  void main() {
    vObj = position;
    vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
    vP = wp.xyz;
    vNW = normalize(mat3(modelMatrix * instanceMatrix) * vec3(0.0, 1.0, 0.0));
    vColor = aColor;
    vSun = aSun;
    vSunColor = aSunColor;
    vGlow = aGlow;
    vSeed = aSeed;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }`

const ringFragment = /* glsl */ `
  varying vec3 vObj;
  varying vec3 vP;
  varying vec3 vNW;
  varying vec3 vColor;
  varying vec3 vSun;
  varying vec3 vSunColor;
  varying float vGlow;
  varying float vSeed;
  ${NOISE}
  void main() {
    float r = length(vObj.xz);
    float bands = noise3(vec3(r * 22.0, vSeed * 50.0, 0.0)) * 0.7 + noise3(vec3(r * 70.0, vSeed * 10.0, 3.0)) * 0.3;
    float edge = smoothstep(1.45, 1.6, r) * smoothstep(2.4, 2.2, r);
    float gap = smoothstep(0.02, 0.05, abs(r - 1.95));
    float a = edge * gap * (0.25 + bands * 0.65) * min(vGlow, 1.0);
    if (a < 0.01) discard;
    vec3 L = normalize(vSun - vP);
    float light = 0.25 + 0.75 * abs(dot(normalize(vNW), L));
    vec3 col = mix(vColor, vec3(0.86, 0.8, 0.7), 0.5) * vSunColor * light;
    gl_FragColor = vec4(col, a * 0.85);
  }`

const pointVertex = /* glsl */ `
  attribute vec3 color;
  attribute float size;
  attribute float glow;
  uniform float uPixelRatio;
  varying vec3 vColor;
  varying float vGlow;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = size * uPixelRatio * (300.0 / max(-mv.z, 1.0));
    vColor = color;
    vGlow = glow;
    gl_Position = projectionMatrix * mv;
  }`

const pointFragment = /* glsl */ `
  varying vec3 vColor;
  varying float vGlow;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    if (d > 1.0) discard;
    float a = (smoothstep(0.3, 0.0, d) * 1.4 + exp(-d * 3.5) * 0.7) * vGlow;
    if (a < 0.003) discard;
    gl_FragColor = vec4(vColor * a, 1.0);
  }`

const beaconVertex = /* glsl */ `
  attribute vec3 color;
  attribute float size;
  attribute float glow;
  uniform float uPixelRatio;
  varying vec3 vColor;
  varying float vPhase;
  varying float vGlow;
  void main() {
    vColor = color;
    vPhase = size;
    vGlow = glow;
    gl_PointSize = 50.0 * uPixelRatio;
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
      float r = fract(uTime * 0.42 + vPhase + float(i) * 0.5);
      a += smoothstep(0.08, 0.0, abs(d - r)) * (1.0 - r);
    }
    a *= 0.5 * vGlow;
    if (a < 0.003) discard;
    gl_FragColor = vec4(vColor * a, 1.0);
  }`

/** The dust each sun gathers in its plane. Orbits entirely on the GPU. */
const dustVertex = /* glsl */ `
  attribute vec3 aCenter;
  attribute vec4 aOrbit;   // radius, start angle, height, speed
  attribute vec3 color;
  attribute float glow;
  uniform float uTime;
  uniform float uPixelRatio;
  varying vec3 vColor;
  varying float vGlow;
  void main() {
    float a = aOrbit.y + uTime * aOrbit.w;
    vec3 p = aCenter + vec3(cos(a) * aOrbit.x, aOrbit.z, sin(a) * aOrbit.x);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_PointSize = clamp(1.6 * uPixelRatio * (300.0 / max(-mv.z, 1.0)), 1.0, 5.0);
    vColor = color;
    vGlow = glow;
    gl_Position = projectionMatrix * mv;
  }`

const dustFragment = /* glsl */ `
  varying vec3 vColor;
  varying float vGlow;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float a = smoothstep(1.0, 0.0, d) * 0.22 * vGlow;
    if (a < 0.003) discard;
    gl_FragColor = vec4(vColor * a, 1.0);
  }`

/**
 * Dust streaming along a link between two suns. Every particle's position is worked out on the GPU
 * from the two ends, so the stream costs nothing per frame beyond moving those ends.
 */
const streamVertex = /* glsl */ `
  attribute vec3 aStart;
  attribute vec3 aEnd;
  attribute vec3 aSpread;   // offset from the centre line, before tapering
  attribute vec4 aFlow;     // start u, speed, lift, size
  attribute vec3 aColorA;
  attribute vec3 aColorB;
  attribute float aGlow;
  uniform float uTime;
  uniform float uPixelRatio;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    float u = fract(aFlow.x + uTime * aFlow.y);
    vec3 mid = (aStart + aEnd) * 0.5 + vec3(0.0, aFlow.z, 0.0);
    float v = 1.0 - u;
    vec3 p = v * v * aStart + 2.0 * v * u * mid + u * u * aEnd;
    // Wide where it leaves each system, pinched to a thread in the middle: connected, still separate.
    float waist = 0.28 + 0.72 * pow(abs(u - 0.5) * 2.0, 1.6);
    p += aSpread * waist;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_PointSize = clamp(aFlow.w * uPixelRatio * (300.0 / max(-mv.z, 1.0)), 1.0, 4.5);
    vColor = mix(aColorA, aColorB, u);
    // Fade in and out at the ends so the loop is seamless, and dim in the middle.
    float ends = smoothstep(0.0, 0.08, u) * smoothstep(1.0, 0.92, u);
    vAlpha = ends * (0.45 + 0.55 * waist) * aGlow;
    gl_Position = projectionMatrix * mv;
  }`

const streamFragment = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float a = smoothstep(1.0, 0.0, d) * vAlpha * 0.32;
    if (a < 0.003) discard;
    gl_FragColor = vec4(vColor * a, 1.0);
  }`

// ── helpers ─────────────────────────────────────────────────────────────────────────
function instanced(geometry, material, capacity, attrs) {
  const g = geometry.clone()
  for (const [name, size] of Object.entries(attrs)) {
    g.setAttribute(name, new THREE.InstancedBufferAttribute(new Float32Array(capacity * size), size).setUsage(THREE.DynamicDrawUsage))
  }
  const mesh = new THREE.InstancedMesh(g, material, capacity)
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  mesh.frustumCulled = false
  mesh.count = 0
  return mesh
}

function pointGeometry(capacity, attrs) {
  const g = new THREE.BufferGeometry()
  for (const [name, size] of Object.entries(attrs)) {
    g.setAttribute(name, new THREE.BufferAttribute(new Float32Array(capacity * size), size).setUsage(THREE.DynamicDrawUsage))
  }
  g.setDrawRange(0, 0)
  return g
}

/** A slot that holds an instanced mesh and quietly swaps in a bigger one when it overflows. */
function pool(scene, make, order = 0) {
  let cap = 0
  let mesh = null
  return {
    ensure(n) {
      if (mesh && n <= cap) return mesh
      cap = Math.ceil(n * 1.5) + 8
      if (mesh) {
        scene.remove(mesh)
        mesh.geometry.dispose()
      }
      mesh = make(cap)
      mesh.renderOrder = order
      scene.add(mesh)
      return mesh
    },
    get mesh() {
      return mesh
    },
  }
}

const mulberry = (seed) => () => {
  seed = (seed + 0x6d2b79f5) >>> 0
  let t = seed
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

// ── the systems ─────────────────────────────────────────────────────────────────────
export function createWeb(stage) {
  const { scene, camera, uniforms, reducedMotion } = stage

  const nodes = new Map()
  const thoughts = new Map()
  let tagLinks = []
  let filaments = []

  let hovered = null
  let selected = null
  let focusNode = null
  let filter = null
  let dropTarget = null

  const sunMaterial = new THREE.ShaderMaterial({ uniforms, vertexShader: sunVertex, fragmentShader: sunFragment })
  const coronaMaterial = new THREE.ShaderMaterial({
    uniforms, vertexShader: coronaVertex, fragmentShader: coronaFragment,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  })
  const planetMaterial = new THREE.ShaderMaterial({ uniforms, vertexShader: planetVertex, fragmentShader: planetFragment })
  const ringMaterial = new THREE.ShaderMaterial({
    uniforms, vertexShader: ringVertex, fragmentShader: ringFragment,
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
  })
  const pointMaterial = new THREE.ShaderMaterial({
    uniforms, vertexShader: pointVertex, fragmentShader: pointFragment,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  })
  const beaconMaterial = new THREE.ShaderMaterial({
    uniforms, vertexShader: beaconVertex, fragmentShader: beaconFragment,
    transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
  })
  const lineMaterial = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })
  const dustMaterial = new THREE.ShaderMaterial({
    uniforms, vertexShader: dustVertex, fragmentShader: dustFragment,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  })

  const sphereHi = new THREE.SphereGeometry(1, 64, 40)
  const sphereMid = new THREE.SphereGeometry(1, 96, 64)
  const sphereLo = new THREE.SphereGeometry(1, 32, 20)
  const quad = new THREE.PlaneGeometry(2, 2)
  const ringGeo = new THREE.RingGeometry(1.4, 2.45, 96, 1).rotateX(-Math.PI / 2)

  const bodyAttrs = { aColor: 3, aSun: 3, aSunColor: 3, aSeed: 1, aKind: 1, aGlow: 1, aHeat: 1, aFlash: 1 }
  const suns = pool(scene, (cap) => instanced(sphereHi, sunMaterial, cap, { aColor: 3, aGlow: 1, aSeed: 1 }))
  const coronas = pool(scene, (cap) => instanced(quad, coronaMaterial, cap, { aColor: 3, aGlow: 1, aSeed: 1, aScale: 1 }), 2)
  const planets = pool(scene, (cap) => instanced(sphereMid, planetMaterial, cap, bodyAttrs))
  const moons = pool(scene, (cap) => instanced(sphereLo, planetMaterial, cap, bodyAttrs))
  const rings = pool(scene, (cap) => instanced(ringGeo, ringMaterial, cap, { aColor: 3, aSun: 3, aSunColor: 3, aGlow: 1, aSeed: 1 }), 3)

  const pointsPool = (material, attrs, order) => {
    let cap = 0
    const obj = new THREE.Points(new THREE.BufferGeometry(), material)
    obj.frustumCulled = false
    obj.renderOrder = order
    scene.add(obj)
    return {
      obj,
      ensure(n) {
        if (n > cap) {
          cap = Math.ceil(n * 1.5) + 16
          obj.geometry.dispose()
          obj.geometry = pointGeometry(cap, attrs)
        }
        return obj.geometry.attributes
      },
    }
  }
  const glints = pointsPool(pointMaterial, { position: 3, color: 3, size: 1, glow: 1 }, 4)
  const sparkPoints = pointsPool(pointMaterial, { position: 3, color: 3, size: 1, glow: 1 }, 5)
  const beacons = pointsPool(beaconMaterial, { position: 3, color: 3, size: 1, glow: 1 }, 10)

  let lineCap = 0
  const lines = new THREE.LineSegments(new THREE.BufferGeometry(), lineMaterial)
  lines.frustumCulled = false
  lines.renderOrder = 1
  scene.add(lines)
  function ensureLines(segments) {
    if (segments <= lineCap) return lines.geometry.attributes
    lineCap = Math.ceil(segments * 1.4) + 64
    lines.geometry.dispose()
    lines.geometry = pointGeometry(lineCap * 2, { position: 3, color: 3 })
    return lines.geometry.attributes
  }

  const dust = new THREE.Points(new THREE.BufferGeometry(), dustMaterial)
  dust.frustumCulled = false
  scene.add(dust)
  let dustSig = ''

  const streamMaterial = new THREE.ShaderMaterial({
    uniforms, vertexShader: streamVertex, fragmentShader: streamFragment,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  })
  const streams = new THREE.Points(new THREE.BufferGeometry(), streamMaterial)
  streams.frustumCulled = false
  scene.add(streams)
  let streamSig = ''
  let streamRanges = []

  /** Rebuild the particles only when the set of links changes; their ends are refreshed every frame. */
  function rebuildStreams() {
    const sig = filaments.map((f) => `${f.a}>${f.b}:${f.shared}`).join('|')
    if (sig === streamSig) return
    streamSig = sig
    const per = filaments.map((f) => 900 + Math.min(4, f.shared) * 350)
    const total = per.reduce((a, b) => a + b, 0)
    const g = pointGeometry(total, { aStart: 3, aEnd: 3, aSpread: 3, aFlow: 4, aColorA: 3, aColorB: 3, aGlow: 1 })
    const at = g.attributes
    let i = 0
    streamRanges = []
    filaments.forEach((f, k) => {
      const rand = mulberry(Math.floor(f.seed * 4294967296) + k)
      const start = i
      for (let j = 0; j < per[k]; j++, i++) {
        // A soft, round cross-section: most dust near the centre line, a little wandering wide.
        const r = Math.sqrt(-2 * Math.log(Math.max(1e-6, rand()))) * 5.5
        const th = rand() * Math.PI * 2
        at.aSpread.array.set([Math.cos(th) * r, Math.sin(th) * r * 0.45, (rand() - 0.5) * r], i * 3)
        // Half flows each way, so neither system reads as feeding the other.
        const dir = j % 2 ? 1 : -1
        at.aFlow.array.set([rand(), (reducedMotion ? 0 : 0.006 + rand() * 0.01) * dir, 0, 0.9 + rand() ** 3 * 2.2], i * 4)
      }
      streamRanges.push({ f, start, end: i })
    })
    g.setDrawRange(0, total)
    streams.geometry.dispose()
    streams.geometry = g
  }

  function updateStreams() {
    rebuildStreams()
    const at = streams.geometry.attributes
    if (!at.aStart) return
    for (const { f, start, end } of streamRanges) {
      const a = nodes.get(f.a)
      const b = nodes.get(f.b)
      const glow = a && b ? Math.min(a.glow, b.glow, 1) * Math.min(a.arrive, b.arrive) * (0.8 + Math.min(4, f.shared) * 0.12) : 0
      const lift = a && b ? a.pos.distanceTo(b.pos) * 0.1 : 0
      for (let i = start; i < end; i++) {
        if (a && b) {
          at.aStart.array.set([a.pos.x, a.pos.y, a.pos.z], i * 3)
          at.aEnd.array.set([b.pos.x, b.pos.y, b.pos.z], i * 3)
          at.aColorA.array.set([a.color.r, a.color.g, a.color.b], i * 3)
          at.aColorB.array.set([b.color.r, b.color.g, b.color.b], i * 3)
          at.aFlow.array[i * 4 + 2] = lift
        }
        at.aGlow.array[i] = glow
      }
    }
    for (const name of ['aStart', 'aEnd', 'aColorA', 'aColorB', 'aFlow', 'aGlow']) at[name].needsUpdate = true
  }
  let dustRanges = []

  /** Rebuild the dust only when the set of systems or their sizes change — its motion is on the GPU. */
  function rebuildDust() {
    const list = [...nodes.values()]
    const sig = list.map((n) => `${n.name}:${n.count}`).join('|')
    if (sig === dustSig) return
    dustSig = sig
    const counts = list.map((n) => Math.min(1400, 380 + n.count * 60))
    const total = counts.reduce((a, b) => a + b, 0)
    const g = pointGeometry(total, { aCenter: 3, aOrbit: 4, color: 3, glow: 1 })
    const at = g.attributes
    const c = new THREE.Color()
    let i = 0
    dustRanges = []
    list.forEach((n, k) => {
      const rand = mulberry(n.seed * 4294967296)
      const start = i
      const inner = n.radius * 1.3
      for (let j = 0; j < counts[k]; j++, i++) {
        const radius = inner + rand() ** 1.6 * 58
        at.aOrbit.array.set([radius, rand() * Math.PI * 2, (rand() - 0.5) * (1 + radius * 0.06), (reducedMotion ? 0 : 3.2) * radius ** -1.5], i * 4)
        c.copy(n.color).lerp(STARLIGHT, 0.35 + rand() * 0.4).multiplyScalar(0.5 + rand() * 0.8)
        at.color.array.set([c.r, c.g, c.b], i * 3)
      }
      dustRanges.push({ name: n.name, start, end: i })
    })
    g.setDrawRange(0, total)
    dust.geometry.dispose()
    dust.geometry = g
  }

  // ── sparks: the burst when a task is resolved ───────────────────────────────────────
  const sparkPool = []
  function burst(at, color, count = 60, speed = 16) {
    for (let i = 0; i < count; i++) {
      const dir = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize()
      sparkPool.push({
        pos: at.clone(),
        vel: dir.multiplyScalar(3 + Math.random() * speed),
        life: 0,
        max: 1 + Math.random() * 1.2,
        color: color.clone().lerp(STARLIGHT, Math.random() * 0.6),
      })
    }
    if (sparkPool.length > 1600) sparkPool.splice(0, sparkPool.length - 1600)
  }

  // ── data in ─────────────────────────────────────────────────────────────────────────
  function setData({ nodeList, thoughtList }) {
    const counts = new Map()
    for (const t of thoughtList) counts.set(t.node, (counts.get(t.node) || 0) + 1)

    const seenNodes = new Set()
    for (const n of nodeList) {
      seenNodes.add(n.name)
      const existing = nodes.get(n.name)
      const count = counts.get(n.name) || 0
      if (existing) {
        if (!existing.dragging) existing.pos.fromArray(n.pos)
        existing.color.set(n.hue)
        existing.count = count
        existing.targetRadius = sunRadiusOf(count)
        existing.leaving = false
      } else {
        nodes.set(n.name, {
          name: n.name,
          pos: new THREE.Vector3().fromArray(n.pos),
          color: new THREE.Color(n.hue),
          count,
          radius: sunRadiusOf(count),
          targetRadius: sunRadiusOf(count),
          seed: mulberry([...n.name].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7))(),
          glow: 0,
          arrive: 0,
          leaving: false,
          dragging: false,
        })
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
        const rand = mulberry(Math.floor(t.phase * 4294967296))
        thoughts.set(t.id, {
          id: t.id,
          thread: t.thread,
          node: t.node,
          state,
          offset: new THREE.Vector3().fromArray(t.offset),
          phase: t.phase,
          ascending: rand() * Math.PI * 2,
          tilt: (rand() - 0.5) * 0.9,
          spin: 0.15 + rand() * 0.5,
          palette: rand(),
          world: new THREE.Vector3().fromArray(nodes.get(t.node)?.pos.toArray() || [0, 0, 0]),
          angle: 0,
          radius: 1,
          heat: 0,
          glow: 0,
          arrive: 0,
          dissolving: null,
          leaving: false,
          dragging: false,
        })
      }
    }
    for (const [id, t] of thoughts) if (!seen.has(id) && t.dissolving === null) t.leaving = true

    // The tangle: link tasks that share a tag but live in different lists. Chained per tag
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
        if (list[i].node !== list[i - 1].node) tagLinks.push({ a: list[i - 1].id, b: list[i].id, tag, seed: (i * 0.37 + tag.length * 0.13) % 1 })
      }
    }
    buildFilaments()
  }

  /**
   * Everything is connected: a minimum spanning tree ties every sun into one web, each sun also
   * reaches for its two nearest neighbours so the web has loops rather than a single chain, and any
   * two systems whose tasks share tags get a filament too — brighter the more they share.
   */
  function buildFilaments() {
    const list = [...nodes.values()].filter((n) => !n.leaving)
    const shared = new Map()
    const key = (a, b) => (a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`)
    for (const l of tagLinks) {
      const a = thoughts.get(l.a)?.node
      const b = thoughts.get(l.b)?.node
      if (a && b && a !== b) shared.set(key(a, b), (shared.get(key(a, b)) || 0) + 1)
    }
    const edges = new Map()
    if (list.length > 1) {
      const inTree = new Set([list[0].name])
      while (inTree.size < list.length) {
        let best = null
        for (const a of list) {
          if (!inTree.has(a.name)) continue
          for (const b of list) {
            if (inTree.has(b.name)) continue
            const d = a.pos.distanceTo(b.pos)
            if (!best || d < best.d) best = { a: a.name, b: b.name, d }
          }
        }
        inTree.add(best.b)
        edges.set(key(best.a, best.b), { a: best.a, b: best.b })
      }
    }
    for (const a of list) {
      const near = list.filter((b) => b !== a).sort((x, y) => a.pos.distanceTo(x.pos) - a.pos.distanceTo(y.pos)).slice(0, 2)
      for (const b of near) edges.set(key(a.name, b.name), { a: a.name, b: b.name })
    }
    for (const k of shared.keys()) {
      const [a, b] = k.split('\u0000')
      edges.set(k, { a, b })
    }
    filaments = [...edges.entries()].map(([k, e], i) => ({ ...e, shared: shared.get(k) || 0, seed: (i * 0.618) % 1 }))
  }

  // ── orbits ──────────────────────────────────────────────────────────────────────────
  const tmp = new THREE.Vector3()
  const tmp2 = new THREE.Vector3()
  const col = new THREE.Color()
  const col2 = new THREE.Color()
  const quat = new THREE.Quaternion()
  const quat2 = new THREE.Quaternion()
  const mat = new THREE.Matrix4()
  const scl = new THREE.Vector3()
  const UP = new THREE.Vector3(0, 1, 0)
  const X = new THREE.Vector3(1, 0, 0)
  const Z = new THREE.Vector3(0, 0, 1)

  const orbitRadiusOf = (t, node) => node.radius * 1.5 + Math.max(2, Math.hypot(t.offset.x, t.offset.z))
  const inclinationOf = (t) => Math.max(-0.35, Math.min(0.35, t.offset.y || 0))
  /** Inner planets run faster, as they should. Based on the undecayed orbit so a fall never jolts the angle. */
  const speedOf = (r) => (reducedMotion ? 0 : 4.2 * r ** -1.5)
  const decayed = (r, node, sink) => {
    const floor = Math.min(r, node.radius * 1.9)
    return floor + (r - floor) * (1 - sink)
  }

  /** A point on a tilted orbit, relative to the sun. */
  function orbitPoint(r, angle, incl, asc, out) {
    const x = r * Math.cos(angle)
    const zf = r * Math.sin(angle)
    const y = -zf * Math.sin(incl)
    const z = zf * Math.cos(incl)
    const c = Math.cos(asc)
    const s = Math.sin(asc)
    return out.set(x * c + z * s, y, -x * s + z * c)
  }

  function glowTargetOf(t) {
    let g = 1
    if (focusNode && t.node !== focusNode) g = 0.12
    if (filter && !filter(t)) g = Math.min(g, 0.12)
    if (selected === t.id) g = 2
    else if (hovered?.kind === 'thought' && hovered.id === t.id) g = Math.max(g, 1.6)
    else if (hovered?.kind === 'node' && hovered.id === t.node) g = Math.max(g, 1.25)
    return g
  }

  const sizeOf = (t) => 0.95 + (Number(t.thread.urgency) || 0) * 1.5 + (t.state === 'drifting' ? 0 : 0.15)

  function planetColor(t, node, out) {
    const tones = ['#b98a5e', '#6f8fa8', '#9c6b54', '#7d9b8a', '#a89a7c', '#8a7aa6']
    out.set(tones[Math.floor(t.palette * tones.length)])
    return out.lerp(node.color, 0.28)
  }

  // ── per frame ───────────────────────────────────────────────────────────────────────
  function update(dt, time) {
    const k = 1 - Math.exp(-dt * 6)

    for (const [name, n] of nodes) {
      n.arrive = Math.min(1, n.arrive + dt / 1.8)
      n.radius += (n.targetRadius - n.radius) * (1 - Math.exp(-dt * 2))
      let target = focusNode && focusNode !== name ? 0.3 : 1
      if (hovered?.kind === 'node' && hovered.id === name) target = 1.35
      if (dropTarget === name) target = 1.9
      if (n.leaving) target = 0
      n.glow += (target - n.glow) * k
      if (n.leaving && n.glow < 0.01) {
        nodes.delete(name)
        buildFilaments()
      }
    }
    rebuildDust()
    updateStreams()

    // Suns and coronas
    const sunMesh = suns.ensure(nodes.size)
    const coronaMesh = coronas.ensure(nodes.size)
    let ni = 0
    for (const n of nodes.values()) {
      const ease = 1 - (1 - n.arrive) ** 3
      const g = n.glow * ease
      const r = n.radius * (0.3 + 0.7 * ease)
      mat.compose(n.pos, quat.setFromAxisAngle(UP, reducedMotion ? 0 : time * 0.02 + n.seed * 6), scl.setScalar(r))
      sunMesh.setMatrixAt(ni, mat)
      const sa = sunMesh.geometry.attributes
      col.copy(n.color)
      sa.aColor.array.set([col.r, col.g, col.b], ni * 3)
      sa.aGlow.array[ni] = g
      sa.aSeed.array[ni] = n.seed

      mat.makeTranslation(n.pos.x, n.pos.y, n.pos.z)
      coronaMesh.setMatrixAt(ni, mat)
      const ca = coronaMesh.geometry.attributes
      ca.aColor.array.set([col.r, col.g, col.b], ni * 3)
      ca.aGlow.array[ni] = g
      ca.aSeed.array[ni] = n.seed
      ca.aScale.array[ni] = r * 7
      ni++
    }
    sunMesh.count = ni
    coronaMesh.count = ni
    for (const m of [sunMesh, coronaMesh]) {
      m.instanceMatrix.needsUpdate = true
      for (const a of Object.values(m.geometry.attributes)) if (a.isInstancedBufferAttribute) a.needsUpdate = true
    }

    // Planets, moons, rings, orbits, glints, beacons
    let moonCount = 0
    let ringCount = 0
    for (const t of thoughts.values()) {
      moonCount += t.thread.items?.length || 0
      if ((Number(t.thread.urgency) || 0) >= 0.8) ringCount++
    }
    const planetMesh = planets.ensure(thoughts.size)
    const moonMesh = moons.ensure(moonCount)
    const ringMesh = rings.ensure(ringCount)
    const gl = glints.ensure(thoughts.size + nodes.size + 2)
    const bl = beacons.ensure(thoughts.size + 2)
    const ll = ensureLines(thoughts.size * ORBIT_SEGMENTS + tagLinks.length * THREAD_SEGMENTS + filaments.length * FILAMENT_SEGMENTS)
    const pa = planetMesh.geometry.attributes
    const ma = moonMesh.geometry.attributes
    const ra = ringMesh.geometry.attributes

    let pi = 0
    let mi = 0
    let ri = 0
    let gi = 0
    // Suns keep a steady point of light from far away, where the sphere itself is only a few pixels.
    for (const n of nodes.values()) {
      const depth = camera.position.distanceTo(n.pos)
      const far = Math.min(1, Math.max(0, (depth - 120) / 400))
      if (far < 0.01) continue
      col.copy(n.color).lerp(STARLIGHT, 0.5)
      gl.position.array.set([n.pos.x, n.pos.y, n.pos.z], gi * 3)
      gl.color.array.set([col.r, col.g, col.b], gi * 3)
      gl.size.array[gi] = 10 + n.radius * 3
      gl.glow.array[gi] = n.glow * n.arrive * far * 0.8
      gi++
    }
    let bi = 0
    let li = 0

    const writeLine = (a, b, ca, cb) => {
      ll.position.array.set([a.x, a.y, a.z, b.x, b.y, b.z], li * 6)
      ll.color.array.set([ca.r, ca.g, ca.b, cb.r, cb.g, cb.b], li * 6)
      li++
    }

    const writeBody = (attrs, i, color, node, seed, kind, glow, heat, flash) => {
      attrs.aColor.array.set([color.r, color.g, color.b], i * 3)
      attrs.aSun.array.set([node.pos.x, node.pos.y, node.pos.z], i * 3)
      col2.copy(node.color).lerp(STARLIGHT, 0.45).multiplyScalar(Math.min(1.2, node.glow * 1.1 + 0.05))
      attrs.aSunColor.array.set([col2.r, col2.g, col2.b], i * 3)
      attrs.aSeed.array[i] = seed
      attrs.aKind.array[i] = kind
      attrs.aGlow.array[i] = glow
      attrs.aHeat.array[i] = heat
      attrs.aFlash.array[i] = flash
    }

    const orbitA = new THREE.Vector3()
    const orbitB = new THREE.Vector3()
    const cA = new THREE.Color()
    const cB = new THREE.Color()

    for (const [id, t] of thoughts) {
      const node = nodes.get(t.node)
      if (!node) continue

      if (t.dissolving !== null) {
        t.dissolving += dt
        if (t.dissolving > 1.1) {
          thoughts.delete(id)
          continue
        }
      }
      t.arrive = Math.min(1, t.arrive + dt / 1.8)
      const arriveEase = 1 - (1 - t.arrive) ** 3

      let target = glowTargetOf(t)
      if (t.leaving) target = 0
      t.glow += (target - t.glow) * k
      if (t.leaving && t.glow < 0.01) {
        thoughts.delete(id)
        continue
      }

      const baseR = orbitRadiusOf(t, node)
      const incl = inclinationOf(t)
      const sink = sinkOf(t) * arriveEase
      t.heat += (sink / MAX_SINK - t.heat) * k
      const r = decayed(baseR, node, sink) * (0.4 + 0.6 * arriveEase)
      t.radius = r
      t.angle = Math.atan2(t.offset.z, t.offset.x) + time * speedOf(baseR)

      if (!t.dragging) {
        orbitPoint(r, t.angle, incl, t.ascending, tmp)
        if (t.state === 'tangled' && !reducedMotion) {
          const shake = 0.05 + t.heat * 0.12
          tmp.x += Math.sin(time * 7 + t.phase * 40) * shake
          tmp.y += Math.cos(time * 6 + t.phase * 30) * shake
        }
        t.world.copy(node.pos).add(tmp)
      }
      // Struck by an attack: a hard shudder that settles.
      if (t.hit > 0.001) {
        t.hit *= Math.exp(-dt * 3)
        const quake = t.hit * (t.size || 1) * 0.18
        t.world.x += (Math.random() - 0.5) * quake
        t.world.y += (Math.random() - 0.5) * quake
        t.world.z += (Math.random() - 0.5) * quake
      }

      let size = sizeOf(t) * (0.2 + 0.8 * arriveEase)
      let flash = Math.min(0.45, (t.hit || 0) * 0.35)
      if (t.dissolving !== null) {
        const p = t.dissolving / 1.1
        flash = p < 0.25 ? p / 0.25 : Math.max(0, 1 - (p - 0.25) / 0.5)
        size *= p < 0.25 ? 1 + p * 1.6 : Math.max(0, 1.4 * (1 - (p - 0.25) / 0.75))
      }
      const glow = t.glow * arriveEase
      const kind = KIND[t.state]
      t.size = size

      // The planet
      quat.setFromAxisAngle(Z, t.tilt)
      quat2.setFromAxisAngle(UP, reducedMotion ? t.phase * 6 : time * t.spin + t.phase * 6)
      mat.compose(t.world, quat.multiply(quat2), scl.setScalar(Math.max(0.001, size)))
      planetMesh.setMatrixAt(pi, mat)
      planetColor(t, node, col)
      writeBody(pa, pi, col, node, t.palette, kind, glow, t.heat, flash)
      pi++

      // Rings on the heaviest worlds
      if ((Number(t.thread.urgency) || 0) >= 0.8 && t.dissolving === null) {
        quat.setFromAxisAngle(Z, t.tilt).multiply(quat2.setFromAxisAngle(X, 0.35))
        mat.compose(t.world, quat, scl.setScalar(size))
        ringMesh.setMatrixAt(ri, mat)
        ra.aColor.array.set([col.r, col.g, col.b], ri * 3)
        ra.aSun.array.set([node.pos.x, node.pos.y, node.pos.z], ri * 3)
        col2.copy(node.color).lerp(STARLIGHT, 0.45)
        ra.aSunColor.array.set([col2.r, col2.g, col2.b], ri * 3)
        ra.aGlow.array[ri] = glow
        ra.aSeed.array[ri] = t.palette
        ri++
      }

      // Moons: one per checklist step
      const items = t.thread.items || []
      if (items.length && t.dissolving === null) {
        for (let i = 0; i < items.length; i++) {
          const mr = size * 2.1 + 0.9 + i * 0.55
          const a = (reducedMotion ? 0 : time * (1.3 / Math.sqrt(mr))) + t.phase * 6.283 + (i / items.length) * 6.283
          tmp2.set(t.world.x + Math.cos(a) * mr, t.world.y + Math.sin(a) * mr * 0.18, t.world.z + Math.sin(a) * mr)
          mat.compose(tmp2, quat.identity(), scl.setScalar(0.2 + size * 0.07))
          moonMesh.setMatrixAt(mi, mat)
          col.setScalar(items[i].done ? 0.35 : 1)
          writeBody(ma, mi, col, node, (t.palette + i * 0.13) % 1, 3, glow, 0, 0)
          mi++
        }
      }

      // A glint so every world can be found from far away. Fades as you get close enough to see the planet itself.
      const depth = camera.position.distanceTo(t.world)
      const far = Math.min(1, Math.max(0, (depth - 40) / 160))
      if (far > 0.01) {
        const tone = t.state === 'tangled' ? TANGLED : t.state === 'asking' ? ASKING : planetColor(t, node, col).lerp(STARLIGHT, 0.5)
        gl.position.array.set([t.world.x, t.world.y, t.world.z], gi * 3)
        gl.color.array.set([tone.r, tone.g, tone.b], gi * 3)
        gl.size.array[gi] = 3.5 + size * 1.6
        gl.glow.array[gi] = glow * far * (t.dissolving === null ? 0.9 : 0)
        gi++
      }

      if (t.state !== 'drifting' && t.dissolving === null) {
        const tone = t.state === 'tangled' ? TANGLED : ASKING
        bl.position.array.set([t.world.x, t.world.y, t.world.z], bi * 3)
        bl.color.array.set([tone.r, tone.g, tone.b], bi * 3)
        bl.size.array[bi] = t.phase
        bl.glow.array[bi] = Math.min(1, glow)
        bi++
      }

      // The orbit: a faint full path with a bright tail behind the planet.
      if (t.dissolving === null) {
        const tone = t.state === 'tangled' ? TANGLED : t.state === 'asking' ? ASKING : col.copy(node.color).lerp(STARLIGHT, 0.4)
        const lit = selected === t.id || (hovered?.kind === 'thought' && hovered.id === t.id) ? 2.6 : 1
        const strength = Math.min(glow, 1.2) * lit * Math.min(1, node.glow)
        for (let i = 0; i < ORBIT_SEGMENTS; i++) {
          const u0 = i / ORBIT_SEGMENTS
          const u1 = (i + 1) / ORBIT_SEGMENTS
          orbitPoint(r, t.angle - u0 * Math.PI * 2, incl, t.ascending, orbitA).add(node.pos)
          orbitPoint(r, t.angle - u1 * Math.PI * 2, incl, t.ascending, orbitB).add(node.pos)
          const i0 = (0.035 + 0.26 * Math.exp(-u0 * 6)) * strength
          const i1 = (0.035 + 0.26 * Math.exp(-u1 * 6)) * strength
          writeLine(orbitA, orbitB, cA.copy(tone).multiplyScalar(i0), cB.copy(tone).multiplyScalar(i1))
        }
      }
    }

    // Threads between tasks that share a tag: an arc with light running along it.
    const bezier = (a, b, lift, u, out) => {
      const mx = (a.x + b.x) / 2
      const my = (a.y + b.y) / 2 + lift
      const mz = (a.z + b.z) / 2
      const v = 1 - u
      return out.set(v * v * a.x + 2 * v * u * mx + u * u * b.x, v * v * a.y + 2 * v * u * my + u * u * b.y, v * v * a.z + 2 * v * u * mz + u * u * b.z)
    }
    for (const link of tagLinks) {
      const a = thoughts.get(link.a)
      const b = thoughts.get(link.b)
      if (!a || !b || a.dissolving !== null || b.dissolving !== null) continue
      const lit = [a.id, b.id].includes(selected) || (hovered?.kind === 'thought' && [a.id, b.id].includes(hovered.id))
      const strength = (lit ? 0.6 : 0.16) * Math.min(a.glow, b.glow, 1.2)
      const lift = a.world.distanceTo(b.world) * 0.22
      const p = reducedMotion ? -1 : (time * 0.16 + link.seed) % 1
      for (let i = 0; i < THREAD_SEGMENTS; i++) {
        const u0 = i / THREAD_SEGMENTS
        const u1 = (i + 1) / THREAD_SEGMENTS
        const i0 = strength * (1 + 3 * Math.exp(-(((u0 - p) * 12) ** 2)))
        const i1 = strength * (1 + 3 * Math.exp(-(((u1 - p) * 12) ** 2)))
        writeLine(bezier(a.world, b.world, lift, u0, orbitA), bezier(a.world, b.world, lift, u1, orbitB), cA.setRGB(i0 * 0.9, i0 * 0.93, i0), cB.setRGB(i1 * 0.9, i1 * 0.93, i1))
      }
    }

    // Filaments between suns.
    for (const f of filaments) {
      const a = nodes.get(f.a)
      const b = nodes.get(f.b)
      if (!a || !b) continue
      const dim = Math.min(a.glow, b.glow, 1) * Math.min(a.arrive, b.arrive)
      const base = (0.08 + Math.min(4, f.shared) * 0.04) * dim
      const lift = a.pos.distanceTo(b.pos) * 0.1
      const p = reducedMotion ? -1 : (time * 0.05 + f.seed) % 1
      for (let i = 0; i < FILAMENT_SEGMENTS; i++) {
        const u0 = i / FILAMENT_SEGMENTS
        const u1 = (i + 1) / FILAMENT_SEGMENTS
        // Fade near each sun so the filament seems to come out of the corona, not pierce it.
        const ends = (u) => Math.min(1, Math.min(u, 1 - u) * 12)
        const i0 = base * ends(u0) * (1 + 5 * Math.exp(-(((u0 - p) * 18) ** 2)))
        const i1 = base * ends(u1) * (1 + 5 * Math.exp(-(((u1 - p) * 18) ** 2)))
        col.copy(a.color).lerp(b.color, u0)
        col2.copy(a.color).lerp(b.color, u1)
        writeLine(bezier(a.pos, b.pos, lift, u0, orbitA), bezier(a.pos, b.pos, lift, u1, orbitB), cA.copy(col).multiplyScalar(i0), cB.copy(col2).multiplyScalar(i1))
      }
    }

    // Dust follows its sun and dims with it.
    const da = dust.geometry.attributes
    if (da.aCenter) {
      for (const range of dustRanges) {
        const n = nodes.get(range.name)
        if (!n) continue
        const g = n.glow * n.arrive
        for (let i = range.start; i < range.end; i++) {
          da.aCenter.array[i * 3] = n.pos.x
          da.aCenter.array[i * 3 + 1] = n.pos.y
          da.aCenter.array[i * 3 + 2] = n.pos.z
          da.glow.array[i] = g
        }
      }
      da.aCenter.needsUpdate = true
      da.glow.needsUpdate = true
    }

    // Sparks
    let si = 0
    const sl = sparkPoints.ensure(sparkPool.length + 1)
    for (let i = sparkPool.length - 1; i >= 0; i--) {
      const s = sparkPool[i]
      s.life += dt
      if (s.life >= s.max) {
        sparkPool.splice(i, 1)
        continue
      }
      s.vel.multiplyScalar(1 - dt * 1.6)
      s.pos.addScaledVector(s.vel, dt)
      const fade = 1 - s.life / s.max
      sl.position.array.set([s.pos.x, s.pos.y, s.pos.z], si * 3)
      sl.color.array.set([s.color.r, s.color.g, s.color.b], si * 3)
      sl.size.array[si] = 1.4 * fade + 0.3
      sl.glow.array[si] = fade * 1.5
      si++
    }

    for (const [mesh, count] of [[planetMesh, pi], [moonMesh, mi], [ringMesh, ri]]) {
      mesh.count = count
      mesh.instanceMatrix.needsUpdate = true
      for (const a of Object.values(mesh.geometry.attributes)) if (a.isInstancedBufferAttribute) a.needsUpdate = true
    }
    for (const [pts, count] of [[glints.obj, gi], [beacons.obj, bi], [sparkPoints.obj, si], [lines, li * 2]]) {
      for (const a of Object.values(pts.geometry.attributes)) a.needsUpdate = true
      pts.geometry.setDrawRange(0, count)
    }
  }

  // ── looking things up ───────────────────────────────────────────────────────────────
  const projected = new THREE.Vector3()

  function screenOf(world) {
    projected.copy(world).project(camera)
    const depth = camera.position.distanceTo(world)
    return {
      x: (projected.x * 0.5 + 0.5) * innerWidth,
      y: (-projected.y * 0.5 + 0.5) * innerHeight,
      visible: projected.z < 1 && projected.z > -1,
      depth,
      /** Screen pixels per world unit at that distance. */
      ppu: innerHeight / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * Math.max(depth, 0.001)),
    }
  }

  /** Nearest thing under a screen point — planets first, since they sit in front of their suns. */
  function pick(x, y) {
    let best = null
    let bestD = Infinity
    for (const t of thoughts.values()) {
      if (t.dissolving !== null || t.glow < 0.3) continue
      const s = screenOf(t.world)
      if (!s.visible) continue
      const d = Math.hypot(s.x - x, s.y - y)
      const reach = Math.max(13, sizeOf(t) * s.ppu + 8)
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
      const reach = Math.max(24, n.radius * s.ppu * 1.4 + 10)
      if (d < reach && d < bestD) {
        best = { kind: 'node', id: n.name }
        bestD = d
      }
    }
    return best
  }

  /** The middle of everything, and how far out it reaches — for framing the whole sky. */
  function center() {
    const list = [...nodes.values()].filter((n) => !n.leaving)
    const c = new THREE.Vector3()
    if (!list.length) return { point: c, extent: 120 }
    for (const n of list) c.add(n.pos)
    c.divideScalar(list.length)
    const extent = Math.max(90, ...list.map((n) => n.pos.distanceTo(c) + 50))
    return { point: c, extent }
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

    // Hovering over a different sun while dragging = offering to move it into that list.
    dropTarget = null
    let bestD = Infinity
    for (const n of nodes.values()) {
      if (n.name === t.node) continue
      const s = screenOf(n.pos)
      const d = Math.hypot(s.x - x, s.y - y)
      if (s.visible && d < Math.max(80, n.radius * s.ppu * 1.6) && d < bestD) {
        bestD = d
        dropTarget = n.name
      }
    }

    // Wherever it's let go becomes its new orbit: undo the rotation, the tilt and any decay.
    const incl = inclinationOf(t)
    tmp.copy(hit).sub(node.pos)
    const c = Math.cos(-t.ascending)
    const s = Math.sin(-t.ascending)
    const lx = tmp.x * c + tmp.z * s
    const lz = -tmp.x * s + tmp.z * c
    const zf = lz / Math.max(0.2, Math.cos(incl))
    const r = Math.hypot(lx, zf)
    const sink = sinkOf(t)
    const floor = node.radius * 1.9
    const baseR = r > floor ? floor + (r - floor) / (1 - sink) : r
    const extra = Math.max(2, baseR - node.radius * 1.5)
    const start = Math.atan2(zf, lx) - time * speedOf(node.radius * 1.5 + extra)
    t.offset.set(Math.cos(start) * extra, incl, Math.sin(start) * extra)
    return t.offset.toArray()
  }

  function endDrag(kind, id) {
    const obj = kind === 'thought' ? thoughts.get(id) : nodes.get(id)
    if (obj) obj.dragging = false
    if (kind === 'node') buildFilaments()
    const target = kind === 'thought' ? dropTarget : null
    dropTarget = null
    return target
  }

  function reassign(id, nodeName, offset) {
    const t = thoughts.get(id)
    if (!t || !nodes.has(nodeName)) return
    t.node = nodeName
    t.offset.fromArray(offset)
    t.arrive = 0.35
  }

  /** A new world forming: a flare off its sun before the real task arrives. */
  function birth(nodeName) {
    const n = nodes.get(nodeName)
    burst(n ? n.pos : center().point, n ? n.color.clone().lerp(STARLIGHT, 0.5) : STARLIGHT, 80, 22)
  }

  return {
    setData,
    update,
    pick,
    screenOf,
    center,
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
    /** A resolved task goes out in a burst. `big` is the ending of an ultimate attack. */
    dissolve(id, { big = false } = {}) {
      const t = thoughts.get(id)
      if (!t) return
      t.dissolving = 0
      const tone = t.state === 'tangled' ? TANGLED : t.state === 'asking' ? ASKING : STARLIGHT
      if (big) {
        const size = t.size || 1
        burst(t.world, tone, 520, 10 + size * 14)
        burst(t.world, new THREE.Color('#ffd27a'), 360, 6 + size * 8)
        t.hit = 2
      } else burst(t.world, tone)
    },
    /** An attack landing on a world without ending it: flash and shudder. */
    impact(id, strength = 1) {
      const t = thoughts.get(id)
      if (!t || t.dissolving !== null) return
      t.hit = Math.max(t.hit || 0, strength)
      burst(t.world, new THREE.Color('#cfe2ff'), Math.round(90 * strength), 8 + (t.size || 1) * 5)
    },
    restore(id, thread) {
      if (thoughts.has(id)) {
        const t = thoughts.get(id)
        t.dissolving = null
        t.arrive = 0
      }
      return thread
    },
  }
}
