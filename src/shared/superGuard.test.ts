import { test } from "node:test";
import assert from "node:assert/strict";
import { SUPER_GUARD_AFK_MS as AFK, SUPER_GUARD_HUNT_MS as HUNT, tickSuperGuard, type SuperGuardState } from "./superGuard";

const player = () => ({ id: "afk", level: 0, x: 0, y: 1.7, z: 0, dead: false });
const state = (): SuperGuardState => ({ lastActivity: 0, lastTick: 0 });

test("LIFE/SUDO blocks death but preserves pursuit after contact and level changes", () => {
  const s = state(), p = player(), start = AFK + 1;
  tickSuperGuard(s, p, start);
  assert.equal(tickSuperGuard(s, p, start + HUNT, true), false);
  assert.ok(s.frame);
  p.x += 20;
  p.level = 6;
  assert.equal(tickSuperGuard(s, p, start + HUNT + 1000, true), false);
  assert.equal(s.frame?.level, p.level);
  assert.equal(s.frame?.x, p.x);
  assert.equal(s.spawnedAt, start);
  // Protection may be enabled after the hunt started; it does not reset it.
  assert.equal(tickSuperGuard(s, p, start + HUNT + 2000, false), true);
});

test("spawns only after strictly more than eight minutes, on any level", () => {
  for (const level of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 13]) {
    const s = state(), p = { ...player(), level };
    assert.equal(tickSuperGuard(s, p, AFK), false);
    assert.equal(s.frame, undefined);
    tickSuperGuard(s, p, AFK + 1);
    assert.equal(s.frame?.level, level);
    assert.equal(s.frame?.targetId, p.id);
  }
});

test("recent activity postpones spawning; dead players never spawn a guard", () => {
  const s = state(), p = player();
  s.lastActivity = AFK - 1;
  tickSuperGuard(s, p, AFK + 1);
  assert.equal(s.frame, undefined);
  tickSuperGuard(s, { ...p, dead: true }, AFK * 3);
  assert.equal(s.frame, undefined);
});

test("running, resuming activity and changing levels cannot escape an active hunt", () => {
  const s = state(), p = player(), start = AFK + 1;
  tickSuperGuard(s, p, start);
  s.lastActivity = start + 100;
  for (let elapsed = 50; elapsed <= HUNT; elapsed += 50) {
    p.x += 100;
    p.y += 20;
    p.level = elapsed % 3;
    const caught = tickSuperGuard(s, p, start + elapsed);
    assert.equal(s.frame?.level, p.level);
    if (elapsed === HUNT) assert.equal(caught, true);
  }
});

test("stationary target dies on contact, and death resets the AFK period", () => {
  const s = state(), p = player(), start = AFK + 1;
  tickSuperGuard(s, p, start);
  let elapsed = 0;
  while (elapsed <= HUNT && !tickSuperGuard(s, p, start + elapsed)) elapsed += 50;
  assert.ok(elapsed <= HUNT);
  p.dead = true;
  tickSuperGuard(s, p, start + elapsed);
  assert.equal(s.frame, undefined);
  p.dead = false;
  tickSuperGuard(s, p, start + elapsed + AFK);
  assert.equal(s.frame, undefined);
});

test("a stalled tick catches up using server time and targets remain independent", () => {
  const a = state(), b = state(), p = player();
  tickSuperGuard(a, p, AFK + 1);
  b.lastActivity = AFK;
  assert.equal(tickSuperGuard(a, p, AFK + HUNT + 1000), true);
  tickSuperGuard(b, { ...p, id: "active" }, AFK + HUNT + 1000);
  assert.equal(b.frame, undefined);
});
