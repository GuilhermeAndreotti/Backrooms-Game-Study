import * as THREE from "three";
import type { SuperGuardFrame } from "../shared/superGuard";

type Position = { x: number; y: number; z: number };
type Guard = ReturnType<SuperGuardRenderer["createGuard"]>;
const damp = (a: number, b: number, rate: number, dt: number) => THREE.MathUtils.lerp(a, b, 1 - Math.exp(-rate * dt));
const angleDelta = (a: number, b: number) => Math.atan2(Math.sin(b - a), Math.cos(b - a));

/** Pure rendering: this monster has no client AI, collision or damage hooks. */
export class SuperGuardRenderer {
  private guards = new Map<string, Guard>();
  private geometry = new THREE.BoxGeometry(1, 1, 1);
  private body = new THREE.MeshBasicMaterial({ color: 0x170b20 });

  private createGuard(frame: SuperGuardFrame) {
    const group = new THREE.Group();
    const body = new THREE.Group();
    group.add(body);
    const glow = new THREE.MeshBasicMaterial({ color: 0xff143c, toneMapped: false });
    const joint = (parent: THREE.Group, x: number, y: number, z: number) => {
      const pivot = new THREE.Group();
      pivot.position.set(x, y, z);
      parent.add(pivot);
      return pivot;
    };
    const part = (parent: THREE.Group, x: number, y: number, z: number, w: number, h: number, d: number, lit = false) => {
      const mesh = new THREE.Mesh(this.geometry, lit ? glow : this.body);
      mesh.position.set(x, y, z);
      mesh.scale.set(w, h, d);
      parent.add(mesh);
    };
    // Feet rest at -1.8 relative to the server's player-height anchor.
    const spine = joint(body, 0, -0.65, 0);
    part(spine, 0, 0.75, 0, 1.1, 1.8, 0.6);
    part(spine, 0, 1.15, 0.32, 0.15, 0.4, 0.04, true);
    const head = joint(spine, 0, 1.7, 0);
    part(head, 0, 0.3, 0, 0.65, 0.7, 0.65);
    part(head, 0, 0.35, 0.34, 0.55, 0.12, 0.04, true);
    const limbs = [-1, 1].map(side => {
      const arm = joint(spine, side * 0.75, 1.6, 0);
      part(arm, 0, -0.55, 0, 0.35, 1.1, 0.4);
      const fore = joint(arm, 0, -1.1, 0);
      part(fore, 0, -0.6, 0, 0.32, 1.2, 0.36);
      const leg = joint(body, side * 0.3, -0.7, 0);
      part(leg, 0, -0.25, 0, 0.4, 0.5, 0.45);
      const shin = joint(leg, 0, -0.5, 0);
      part(shin, 0, -0.25, 0, 0.36, 0.5, 0.4);
      const foot = joint(shin, 0, -0.5, 0);
      part(foot, 0, -0.05, 0.1, 0.42, 0.1, 0.65);
      return { arm, fore, leg, shin, foot };
    });
    group.position.set(frame.x, frame.y, frame.z);
    return { group, body, spine, head, limbs, glow, target: group.position.clone(), level: frame.level,
      age: 0, phase: 0, speed: 0, move: 0, run: 0, reach: 0, look: 0, facing: false };
  }

  apply(frames: SuperGuardFrame[]) {
    const ids = new Set(frames.map(f => f.targetId));
    for (const [id, guard] of this.guards) {
      if (!ids.has(id)) {
        guard.group.removeFromParent();
        guard.glow.dispose();
        this.guards.delete(id);
      }
    }
    for (const frame of frames) {
      let guard = this.guards.get(frame.targetId);
      if (!guard) {
        guard = this.createGuard(frame);
        this.guards.set(frame.targetId, guard);
      }
      const jump = Math.hypot(frame.x - guard.target.x, frame.y - guard.target.y, frame.z - guard.target.z);
      if (guard.level !== frame.level || jump > 8) {
        guard.group.position.set(frame.x, frame.y, frame.z);
        guard.speed = guard.move = guard.run = guard.reach = guard.look = guard.phase = guard.age = 0;
        guard.facing = false;
      }
      guard.level = frame.level;
      guard.target.set(frame.x, frame.y, frame.z);
    }
  }

  update(scene: THREE.Scene, level: number, delta: number, targetPosition?: (id: string) => Position | undefined) {
    if (!Number.isFinite(delta) || delta <= 0) return;
    const dt = Math.min(delta, 0.05);
    for (const [id, g] of this.guards) {
      const { group, body, spine, head } = g;
      if (group.parent !== scene) scene.add(group);
      group.visible = g.level === level;
      if (!group.visible || delta > 0.25) {
        group.position.copy(g.target);
        g.speed = g.move = g.run = 0;
        g.facing = false;
        if (!group.visible) continue;
      }
      const oldX = group.position.x, oldZ = group.position.z;
      group.position.lerp(g.target, 1 - Math.exp(-20 * dt));
      const dx = group.position.x - oldX, dz = group.position.z - oldZ;
      const distance = Math.hypot(dx, dz);
      g.speed = damp(g.speed, distance / dt, 9, dt);
      g.move = damp(g.move, THREE.MathUtils.smoothstep(g.speed, 0.05, 0.7), 10, dt);
      g.run = damp(g.run, THREE.MathUtils.smoothstep(g.speed, 3, 7), 6, dt);
      // Distance-driven strides, capped for supernatural interception speeds.
      g.phase = (g.phase + Math.min(distance / (1.8 + g.run * 0.6), dt * 2.8) * Math.PI * 2) % (Math.PI * 2);
      g.age += dt;
      const target = targetPosition?.(id);
      const tx = target ? target.x - group.position.x : dx;
      const tz = target ? target.z - group.position.z : dz;
      const targetDistance = target ? Math.hypot(tx, tz) : Infinity;
      if (distance > 0.0001 || (target && targetDistance > 0.05)) {
        const yaw = Math.atan2(distance > 0.0001 ? dx : tx, distance > 0.0001 ? dz : tz);
        group.rotation.y += angleDelta(group.rotation.y, yaw) * (g.facing ? 1 - Math.exp(-10 * dt) : 1);
        g.facing = true;
      }
      g.reach = damp(g.reach, 1 - THREE.MathUtils.smoothstep(targetDistance, 0.8, 3.2), 8, dt);
      const look = target && targetDistance > 0.05 ? THREE.MathUtils.clamp(angleDelta(group.rotation.y, Math.atan2(tx, tz)), -0.6, 0.6) : 0;
      g.look = damp(g.look, look, 10, dt);
      const entry = THREE.MathUtils.smoothstep(g.age, 0, 0.35);
      const phase = g.phase, sin = Math.sin(phase), move = g.move;
      const lean = (0.09 + 0.23 * g.run) * move;
      const breath = Math.sin(g.age * 1.7) * 0.008 * (1 - move);
      body.position.y = -(1 - entry) * 0.15 + (1 - Math.cos(phase * 2)) * 0.018 * move;
      body.rotation.z = sin * 0.025 * move;
      spine.rotation.set(lean + breath + (1 - entry) * 0.12, sin * 0.065 * move, 0);
      head.rotation.set(-lean * 0.8, g.look - spine.rotation.y * 0.7, -body.rotation.z * 0.8);
      for (let i = 0; i < g.limbs.length; i++) {
        const { arm, fore, leg, shin, foot } = g.limbs[i];
        const p = phase + i * Math.PI;
        const swing = Math.sin(p);
        leg.rotation.x = -swing * (0.48 + 0.22 * g.run) * move;
        shin.rotation.x = Math.pow(Math.max(0, Math.cos(p)), 2) * (0.7 + 0.4 * g.run) * move;
        foot.rotation.x = -leg.rotation.x * 0.45 - shin.rotation.x * 0.5;
        const reach = g.reach * (i === 0 ? 1 : 0.35);
        arm.rotation.set(swing * (0.16 + 0.18 * g.run) * move * (1 - reach) - reach * 1.15 - lean * 0.4, 0, (i === 0 ? -1 : 1) * 0.08);
        fore.rotation.x = -0.12 - g.run * move * 0.45 - reach * 0.2;
      }
      g.glow.color.setRGB(1, 0.007, 0.045).multiplyScalar((0.65 + entry * 0.35) * (1 + Math.sin(g.age * 4) * 0.06 + g.reach * 0.2));
    }
  }

  dispose() {
    this.apply([]);
    this.geometry.dispose();
    this.body.dispose();
  }
}
