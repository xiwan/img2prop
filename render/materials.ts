import * as THREE from 'three';

function makeGradient(steps: number[]): THREE.DataTexture {
  const data = new Uint8Array(steps.map((s) => Math.round(s * 255)));
  const tex = new THREE.DataTexture(data, steps.length, 1, THREE.RedFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

/** 三段明暗：暗面、过渡、亮面 */
const GRADIENT = makeGradient([0.22, 0.6, 1.0]);

export function toon(color: THREE.ColorRepresentation, extra: THREE.MeshToonMaterialParameters = {}): THREE.MeshToonMaterial {
  return new THREE.MeshToonMaterial({ color, gradientMap: GRADIENT, ...extra });
}

/** 自发光（灯笼、火绳头）：不受光照影响，亮度可超过 1 */
export function glow(color: THREE.ColorRepresentation, intensity = 1): THREE.MeshBasicMaterial {
  const c = new THREE.Color(color).multiplyScalar(intensity);
  return new THREE.MeshBasicMaterial({ color: c });
}
