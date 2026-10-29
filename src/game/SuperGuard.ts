import * as THREE from "three";
import type { SuperGuardFrame } from "../shared/superGuard";

/** Pure rendering: this monster has no client AI, collision or damage hooks. */
export class SuperGuardRenderer {
  private guards = new Map<string, { group: THREE.Group; target: THREE.Vector3; level: number }>();
  private geometry = new THREE.BoxGeometry(1, 1, 1);
  private body = new THREE.MeshBasicMaterial({ color: 0x170b20 });
  private glow = new THREE.MeshBasicMaterial({ color: 0xff143c, toneMapped: false });

  apply(frames: SuperGuardFrame[]) {
    const ids = new Set(frames.map((f) => f.targetId));
    for (const [id, guard] of this.guards) {
      if (!ids.has(id)) { guard.group.removeFromParent(); this.guards.delete(id); }
    }
    for (const frame of frames) {
      let guard = this.guards.get(frame.targetId);
      if (!guard) {
        const group = new THREE.Group();
        const part = (x: number, y: number, z: number, w: number, h: number, d: number, glow = false) => {
          const mesh = new THREE.Mesh(this.geometry, glow ? this.glow : this.body);
          mesh.position.set(x, y, z);
          mesh.scale.set(w, h, d);
          group.add(mesh);
        };
        // Tall faceless uniform, oversized shoulders and a red visor / insignia.
        part(0, 0.1, 0, 1.1, 1.8, 0.6);
        part(0, 1.35, 0, 0.65, 0.7, 0.65);
        part(0, 1.4, 0.34, 0.55, 0.12, 0.04, true);
        part(0, 0.5, 0.32, 0.15, 0.4, 0.04, true);
        for (const side of [-1, 1]) {
          part(side * 0.75, -0.1, 0, 0.35, 2.3, 0.4);
          part(side * 0.3, -1.25, 0, 0.4, 1.1, 0.45);
        }
        group.position.set(frame.x, frame.y, frame.z);
        guard = { group, target: group.position.clone(), level: frame.level };
        this.guards.set(frame.targetId, guard);
      }
      if (guard.level !== frame.level) guard.group.position.set(frame.x, frame.y, frame.z);
      guard.level = frame.level;
      guard.target.set(frame.x, frame.y, frame.z);
    }
  }

  update(scene: THREE.Scene, level: number, delta: number) {
    for (const { group, target, level: guardLevel } of this.guards.values()) {
      if (group.parent !== scene) scene.add(group);
      group.visible = guardLevel === level;
      const dx = target.x - group.position.x, dz = target.z - group.position.z;
      if (dx * dx + dz * dz > 0.0001) group.rotation.y = Math.atan2(dx, dz);
      group.position.lerp(target, 1 - Math.exp(-20 * delta));
    }
  }

  dispose() {
    this.apply([]);
    this.geometry.dispose();
    this.body.dispose();
    this.glow.dispose();
  }
}
