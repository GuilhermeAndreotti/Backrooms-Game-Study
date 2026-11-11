import { test } from "node:test";
import assert from "node:assert/strict";
import { PowerChessGame, EMPTY_POWER_CHESS } from "./powerChess";
import { fromFen } from "./chess";

test("server rejects wrong turns and illegal moves without changing state", () => {
  const g = new PowerChessGame(() => .5);
  const before = g.netState("w");
  assert.equal(g.play("b", 12, 28), false);
  assert.equal(g.play("w", 52, 20), false);
  assert.deepEqual(g.netState("w"), before);
});

test("stable identities, private hands and timed paired history survive serialization", () => {
  const g = new PowerChessGame(() => .5);
  const id = g.ids[52];
  assert.equal(g.play("w", 52, 36), true);
  assert.equal(g.play("b", 12, 28), true);
  assert.equal(g.ids[36], id);
  assert.deepEqual(g.log.map(e => [e.ply, e.c, e.san]), [[0, "w", "e4"], [1, "b", "e5"]]);
  assert.ok(g.log.every(e => e.elapsedMs >= 0));
  assert.deepEqual(g.netState(null).hand, []);
  const frame = { ...EMPTY_POWER_CHESS, ...g.netState("w") };
  assert.deepEqual(PowerChessGame.fromNet(frame, "w").moves(), g.moves());
});

test("one card per turn, invalid targets are atomic, card and move share a turn", () => {
  const g = new PowerChessGame(() => .5);
  g.hands.w = ["almond", "smiler"];
  const before = g.netState("w");
  assert.equal(g.playCard("w", 1, { targets: [4] }), false);
  assert.deepEqual(g.netState("w"), before);
  assert.equal(g.playCard("w", 0, { targets: [] }), true);
  assert.equal(g.playCard("w", 0, { targets: [8] }), false);
  assert.equal(g.play("w", 52, 36), true);
  assert.deepEqual(g.log.map(e => e.ply), [0, 0]);
});

test("Adrenaline retains turn and rejects moving the same piece twice", () => {
  const g = new PowerChessGame(() => .5);
  g.energy.w = 10; g.hands.w = ["adrenaline"];
  assert.equal(g.playCard("w", 0, { targets: [] }), true);
  assert.equal(g.play("w", 52, 36), true);
  assert.equal(g.turn, "w");
  assert.equal(g.play("w", 36, 28), false);
  assert.equal(g.play("w", 51, 35), true);
  assert.equal(g.turn, "b");
  assert.deepEqual(g.log.map(e => e.ply), [0, 0, 0]);
});

test("capturing a frozen piece does not suppress the capturer's check notation", () => {
  const g = new PowerChessGame();
  g.pos = fromFen("4k3/4p3/8/8/8/8/8/K3R3 w - - 0 1");
  g.ids = g.pos.board.map((p, sq) => p ? sq + 1 : 0);
  g.fx.set(g.ids[12], { frozen: 3, shield: -1, immune: -1, ghost: false });
  assert.equal(g.play("w", 60, 12), true);
  assert.equal(g.log[0].san, "Rxe7+");
});

test("revivable material prevents premature insufficient-material draws", () => {
  const g = new PowerChessGame();
  g.pos = fromFen("4k3/8/8/8/8/8/8/1N2K3 w - - 0 1");
  g.ids = g.pos.board.map((p, sq) => p ? sq + 1 : 0);
  g.lost.w = ["r"];
  assert.equal(g.play("w", 57, 40), true);
  assert.equal(g.over, false);
});

test("each action records only its own server-measured interval", t => {
  let now = 1000;
  t.mock.method(Date, "now", () => now);
  const g = new PowerChessGame(() => .5);
  g.hands.w = ["almond"];
  now = 4000;
  g.playCard("w", 0, { targets: [] });
  now = 5500;
  g.play("w", 52, 36);
  now = 7500;
  g.play("b", 12, 28);
  assert.deepEqual(g.log.map(e => e.elapsedMs), [3000, 1500, 2000]);
});
