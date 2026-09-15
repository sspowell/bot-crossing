import * as THREE from 'three'
import { GROUND_SIZE, WATER_LEVEL } from './planet.js'

/**
 * The sea, for a planet that asks for one (`planet.beach`). One flat plane, sitting at
 * `WATER_LEVEL` — comfortably below the sand `createTerrain` draws near the colony and
 * above the seabed it draws everywhere past the coastline (see `shoreRadius` in
 * `planet.js`) — so ordinary depth-testing is what actually hides the water under the dry
 * sand. Nothing here needs to know where the coastline is *except* the foam line, which
 * reproduces `shoreRadius()` in GLSL so it agrees with where the ground really goes under.
 */

const SEGMENTS = { low: 48, medium: 84, high: 128 }

export function createWater(planet, detail = 'medium') {
  if (!planet.beach) return null

  const segments = SEGMENTS[detail] || SEGMENTS.medium
  const geo = new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE, segments, segments)
  geo.rotateX(-Math.PI / 2)

  const shallow = new THREE.Color(0x38d6c4)
  const deep = new THREE.Color(0x0a4468)
  const foam = new THREE.Color(0xf3fffb)

  const material = new THREE.ShaderMaterial({
    transparent: true,
    fog: true,
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uTime: { value: 0 },
        uShallow: { value: shallow },
        uDeep: { value: deep },
        uFoam: { value: foam },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uSunColor: { value: new THREE.Color(0xffffff) },
      },
    ]),
    vertexShader: /* glsl */ `
      #include <common>
      #include <fog_pars_vertex>
      uniform float uTime;
      varying vec3 vWorldPos;
      varying float vWave;

      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        // Three low, wide bands rather than one — a single sine reads as corduroy, three at
        // odd relative speeds and angles never quite repeat within the colony's view.
        float wave = sin(world.x * 0.16 + uTime * 1.1) * 0.05
                   + sin(world.z * 0.21 - uTime * 1.4) * 0.045
                   + sin((world.x + world.z) * 0.085 + uTime * 0.6) * 0.07;
        world.y += wave;
        vWave = wave;
        vWorldPos = world.xyz;
        vec4 mvPosition = viewMatrix * world;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <fog_pars_fragment>
      uniform vec3 uShallow;
      uniform vec3 uDeep;
      uniform vec3 uFoam;
      uniform vec3 uSunDir;
      uniform vec3 uSunColor;
      uniform float uTime;
      varying vec3 vWorldPos;
      varying float vWave;

      // Must track shoreRadius() in src/world/planet.js — this is what lines the surf up
      // with the sand the terrain actually draws underwater.
      float shoreRadius(float angle) {
        return 46.0 + 26.0 + sin(angle * 3.0 + 1.7) * 4.0 + sin(angle * 7.0 + 0.4) * 2.0 + sin(angle * 1.4) * 6.0;
      }

      void main() {
        float dist = length(vWorldPos.xz);
        float angle = atan(vWorldPos.z, vWorldPos.x);
        float past = dist - shoreRadius(angle); // negative = under the sand, hidden by it anyway

        vec3 viewDir = normalize(cameraPosition - vWorldPos);
        vec3 normal = normalize(vec3(-0.6, 3.2, -0.6) * vWave + vec3(0.0, 1.0, 0.0));

        float depthT = clamp(past / 55.0, 0.0, 1.0);
        vec3 color = mix(uShallow, uDeep, depthT);

        // Sun glint: a tight specular lobe that breaks up across the wave field instead of
        // sitting as one static hotspot.
        vec3 halfDir = normalize(uSunDir + viewDir);
        float spec = pow(max(dot(normal, halfDir), 0.0), 70.0);
        color += uSunColor * spec * 1.4;

        float fres = pow(1.0 - clamp(dot(normal, viewDir), 0.0, 1.0), 4.0);
        color += fres * 0.22;

        // Surf: a band that hugs the coastline, animated so it reads as water arriving
        // rather than a painted line.
        float lap = sin(angle * 26.0 + uTime * 1.8) * 0.5 + 0.5;
        float band = smoothstep(9.0, 0.0, abs(past - 2.0 - lap * 3.0));
        color = mix(color, uFoam, band * 0.85);

        float alpha = mix(0.65, 0.94, smoothstep(-4.0, 20.0, past));
        gl_FragColor = vec4(color, alpha);
        #include <fog_fragment>
      }
    `,
  })

  const mesh = new THREE.Mesh(geo, material)
  mesh.name = 'water'
  mesh.position.y = WATER_LEVEL
  mesh.renderOrder = 2
  return mesh
}

export function updateWater(mesh, dt, elapsed, sunDir, sunColor) {
  if (!mesh) return
  const u = mesh.material.uniforms
  u.uTime.value = elapsed
  if (sunDir) u.uSunDir.value.copy(sunDir)
  if (sunColor) u.uSunColor.value.copy(sunColor)
}
