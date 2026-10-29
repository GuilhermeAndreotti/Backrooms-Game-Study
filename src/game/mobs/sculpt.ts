import * as THREE from "three";

/** Continuous facial surface: orbital hollows, temporal wasting, cheekbones and a jaw.
 * This is the editable blockout for the offline remesher, not a substitute for a final artist sculpt.
 */
export function sculptedHead(radius: number, faceless = false): THREE.BufferGeometry {
  const geometry = new THREE.SphereGeometry(radius, 64, 48);
  const position = geometry.getAttribute("position");
  const bump = (x: number, y: number, cx: number, cy: number, sx: number, sy: number) => Math.exp(-(((x - cx) / sx) ** 2 + ((y - cy) / sy) ** 2));
  for (let i = 0; i < position.count; i++) {
    let x = position.getX(i) / radius, y = position.getY(i) / radius, z = position.getZ(i) / radius;
    // Mandible narrower than the cranium; asymmetry is fixed, never random per client.
    x *= 1 - Math.max(0, -y - 0.15) * 0.22;
    const front = THREE.MathUtils.smoothstep(z, 0.05, 0.7);
    let relief = 0;
    for (const side of [-1, 1]) {
      relief += bump(x, y, side * 0.52, -0.12, 0.22, 0.22) * 0.09;
      relief -= bump(x, y, side * 0.58, -0.38, 0.23, 0.24) * 0.11;
      if (!faceless) {
        relief -= bump(x, y, side * 0.36, 0.2, 0.23, 0.19) * 0.19;
        relief += bump(x, y, side * 0.32, 0.42, 0.28, 0.12) * 0.085;
      }
    }
    if (!faceless) {
      relief += bump(x, y, 0.015, 0.02, 0.12, 0.36) * 0.21;
      relief -= bump(x, y, 0, -0.48, 0.3, 0.08) * 0.07;
      relief += bump(x, y, 0, -0.68, 0.3, 0.16) * 0.07;
    }
    z += relief * front;
    position.setXYZ(i, x * radius, y * radius, z * radius);
  }
  geometry.computeVertexNormals();
  return geometry;
}
