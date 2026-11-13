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

test("cards chain until energy runs out; invalid actions are atomic", () => {
  const g = new PowerChessGame(() => .5);
  g.hands.w = ["almond", "tape", "tape", "smiler"];
  const before = g.netState("w");
  assert.equal(g.playCard("w", 3, { targets: [4] }), false);
  assert.deepEqual(g.netState("w"), before);
  assert.equal(g.playCard("w", 0, { targets: [] }), true);
  assert.equal(g.playCard("w", 0, { targets: [52] }), true);
  const frame = { ...EMPTY_POWER_CHESS, ...g.netState("w") };
  assert.ok(PowerChessGame.fromNet(frame, "w").cardPlays("w", 0).length);
  assert.equal(g.playCard("w", 0, { targets: [51] }), true);
  assert.equal(g.energy.w, 0);
  assert.equal(g.playCard("w", 0, { targets: [8] }), false);
  assert.equal(g.play("w", 52, 36), true);
  assert.deepEqual(g.log.map(e => e.ply), [0, 0, 0, 0]);
});

test("Adrenaline retains turn and rejects moving the same piece twice", () => {
  const g = new PowerChessGame(() => .5);
  g.energy.w = 6; g.hands.w = ["adrenaline", "almond", "almond"];
  assert.equal(g.playCard("w", 0, { targets: [] }), true);
  assert.equal(g.playCard("w", 0, { targets: [] }), true);
  assert.equal(g.play("w", 52, 36), true);
  assert.equal(g.turn, "w");
  assert.equal(g.playCard("w", 0, { targets: [] }), false);
  assert.equal(g.play("w", 36, 28), false);
  assert.equal(g.play("w", 51, 35), true);
  assert.equal(g.turn, "b");
  assert.deepEqual(g.log.map(e => e.ply), [0, 0, 0, 0]);
});

test("energy caps at 6 and drawing over 7 cards discards the excess", () => {
  const g = new PowerChessGame(() => .5);
  g.energy.w = 5;
  g.hands.w = ["almond", "sanity", "tape", "tape", "door", "door", "memory"];
  assert.equal(g.playCard("w", 0, { targets: [] }), true);
  assert.equal(g.energy.w, 6);
  assert.equal(g.lastCard?.energyGained, 1);
  g.decks.w = ["tape", "tape", "tape", "tape"];
  assert.equal(g.playCard("w", 0, { targets: [] }), true);
  assert.equal(g.hands.w.length, 7);
  g.hands.w[0] = "sanity";
  assert.equal(g.playCard("w", 0, { targets: [] }), true);
  assert.equal(g.hands.w.length, 7);
  assert.equal(g.lastCard?.cardsDrawn, 1);
  assert.ok(g.discard.w.includes("tape"));
});

test("multiple Noclip cards preserve both targets and turn-ending cards stop chains", () => {
  const g = new PowerChessGame(() => .5);
  g.energy.w = 6; g.hands.w = ["noclip", "noclip"];
  assert.equal(g.playCard("w", 0, { targets: [56] }), true);
  assert.equal(g.playCard("w", 0, { targets: [63] }), true);
  assert.ok(g.movesFrom(56).some(m => m.to === 40));
  assert.ok(g.movesFrom(63).some(m => m.to === 47));
  const h = new PowerChessGame(() => .5);
  h.energy.w = 6; h.hands.w = ["exit", "almond"];
  assert.equal(h.playCard("w", 0, { targets: [44] }), true);
  assert.equal(h.turn, "b");
  assert.equal(h.playCard("w", 0, { targets: [] }), false);
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
