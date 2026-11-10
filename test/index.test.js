import { test } from "node:test";
import assert from "node:assert/strict";
import { procrustes, align, steady, steadySequence, drift } from "../dist/index.js";

// Deterministic pseudo-random numbers so failures are reproducible.
function rng(seed) {
	return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

function cloud(n, seed = 1) {
	const r = rng(seed);
	const m = new Map();
	for (let i = 0; i < n; i++) m.set("n" + i, { x: r() * 1000 - 500, y: r() * 1000 - 500 });
	return m;
}

/** Rotate by `deg`, optionally mirror, then shift: what a re-run force layout does. */
function transform(m, deg, mirror, dx, dy) {
	const t = (deg * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t);
	const out = new Map();
	for (const [id, p] of m) {
		const x = mirror ? -p.x : p.x;
		out.set(id, { x: x * c - p.y * s + dx, y: x * s + p.y * c + dy });
	}
	return out;
}

test("procrustes needs three pairs", () => {
	assert.equal(procrustes([]), null);
	assert.equal(procrustes([{ a: { x: 0, y: 0 }, b: { x: 1, y: 1 } }, { a: { x: 1, y: 0 }, b: { x: 2, y: 1 } }]), null);
});

test("procrustes recovers a pure rotation and shift", () => {
	const a = cloud(50);
	const b = transform(a, 73, false, 500, -200);
	const fit = procrustes([...a].map(([id, p]) => ({ a: p, b: b.get(id) })));
	assert.equal(fit.mirrored, false);
	assert.ok(fit.rms < 1e-6, `rms ${fit.rms}`);
	assert.ok(Math.abs(Math.abs(fit.rotation) - (73 * Math.PI) / 180) < 1e-9);
});

test("align undoes rotation + shift", () => {
	const a = cloud(150);
	assert.ok(drift(a, align(a, transform(a, 73, false, 500, -200))) < 1e-6);
});

test("align undoes a mirrored layout", () => {
	const a = cloud(150, 7);
	assert.ok(drift(a, align(a, transform(a, 200, true, -300, 40))) < 1e-6);
});

test("align ignores mirroring when told to", () => {
	const a = cloud(150, 7);
	const b = transform(a, 200, true, -300, 40);
	assert.ok(drift(a, align(a, b, { allowMirror: false })) > 10);
});

test("align copes with nodes added and removed", () => {
	const a = cloud(150, 3);
	const b = transform(a, 45, false, 100, 100);
	for (let i = 0; i < 10; i++) b.delete("n" + i);
	for (let i = 0; i < 20; i++) b.set("new" + i, { x: i * 13, y: i * -7 });
	const out = align(a, b);
	assert.equal(out.size, 160);
	assert.ok(drift(a, out) < 1e-6);
});

test("align never changes the shape", () => {
	const a = cloud(80, 11);
	const b = cloud(80, 12); // unrelated layout: big residual, but distances preserved
	const out = align(a, b);
	const d = (m, i, j) => Math.hypot(m.get(i).x - m.get(j).x, m.get(i).y - m.get(j).y);
	for (let i = 1; i < 80; i++) assert.ok(Math.abs(d(b, "n0", "n" + i) - d(out, "n0", "n" + i)) < 1e-6);
});

test("align centres the first layout", () => {
	const out = align(null, transform(cloud(50), 0, false, 5000, 5000));
	let cx = 0, cy = 0;
	for (const p of out.values()) { cx += p.x; cy += p.y; }
	assert.ok(Math.abs(cx / 50) < 1e-6 && Math.abs(cy / 50) < 1e-6);
});

test("plain-object positions work too", () => {
	const a = { a: { x: 0, y: 0 }, b: { x: 10, y: 0 }, c: { x: 0, y: 10 } };
	const b = { a: { x: 5, y: 5 }, b: { x: 5, y: 15 }, c: { x: -5, y: 5 } }; // rotated 90°, shifted
	assert.ok(drift(a, align(a, b)) < 1e-9);
});

test("steady with amount 0 equals align", () => {
	const a = cloud(60), b = transform(cloud(60, 2), 30, false, 9, 9);
	const s = steady(a, b, [], { amount: 0 }), r = align(a, b);
	for (const [id, p] of r) assert.ok(Math.hypot(p.x - s.get(id).x, p.y - s.get(id).y) < 1e-9);
});

test("steady moves existing nodes less than align", () => {
	const a = cloud(100, 4), b = cloud(100, 5); // a shuffled re-layout
	const loose = drift(a, align(a, b));
	const calm = drift(a, steady(a, b, [], { amount: 0.7 }));
	assert.ok(calm < loose * 0.31, `${calm} vs ${loose}`);
});

test("steady places a new node beside the node it links to", () => {
	const a = cloud(40, 8);
	const b = transform(cloud(40, 9), 10, false, 0, 0);
	const old = b.get("n3");
	b.set("leaf", { x: old.x + 20, y: old.y }); // 20 units from n3 in the new layout
	const out = steady(a, b, [["leaf", "n3"]], { amount: 0.9 });
	const d = Math.hypot(out.get("leaf").x - out.get("n3").x, out.get("leaf").y - out.get("n3").y);
	assert.ok(Math.abs(d - 20) < 1e-6, `distance ${d}`);
});

test("steady accepts {source, target} links", () => {
	const a = cloud(10), b = new Map(cloud(10));
	b.set("x", { x: 1, y: 1 });
	assert.equal(steady(a, b, [{ source: "x", target: "n0" }]).size, 11);
});

test("steadySequence chains frames", () => {
	const frames = [0, 1, 2, 3].map((i) => ({ positions: transform(cloud(30 + i * 5, 20 + i), i * 40, i % 2 === 1, i * 100, 0) }));
	const out = steadySequence(frames, { amount: 0.5 });
	assert.equal(out.length, 4);
	assert.equal(out[3].size, 45);
});
