/**
 * steady-graph: keep force-directed graph layouts from jumping around
 * between runs, so a sequence of them reads as growth instead of chaos.
 *
 * Force layouts (Obsidian's graph view, d3-force, Gephi's ForceAtlas…)
 * usually start from random positions. Run one twice on the same graph and
 * you get the same *shape*, spun, flipped and slid somewhere else. Run it on
 * tomorrow's slightly bigger graph and clusters also swap places.
 *
 * Two fixes, in order of strength:
 *
 * - `align`: rigid fit. Rotate, mirror and shift the new layout as a whole so
 *   the nodes both layouts share land as close as possible to where they
 *   were (2D orthogonal Procrustes). Never changes the shape.
 * - `steady`: align, then let each existing node move only part of the way
 *   to its new spot, and place new nodes beside the nodes they link to.
 *   Changes the shape a little in exchange for calm, readable motion.
 *
 * No dependencies. Works in the browser and Node.
 */

export interface Pt {
	x: number;
	y: number;
}

/** Node positions keyed by a stable id (a file path, a database key…). */
export type Positions = ReadonlyMap<string, Pt> | Readonly<Record<string, Pt>>;

/** An edge between two node ids. Direction doesn't matter. */
export type Link = readonly [string, string] | { readonly source: string; readonly target: string };

/** The rigid transform found by {@link procrustes}. */
export interface Fit {
	/** Rotation in radians, applied after mirroring. */
	rotation: number;
	/** True when the best match was a flipped layout (x negated before rotating). */
	mirrored: boolean;
	/** Centroid of the points being moved (`b`). */
	from: Pt;
	/** Centroid of the target points (`a`). */
	to: Pt;
	/** Root-mean-square distance left between matched pairs after fitting. */
	rms: number;
	/** Move any point from the `b` layout into the `a` layout's frame. */
	apply(p: Pt): Pt;
}

export interface ProcrustesOptions {
	/** Also try a mirrored fit and keep whichever is closer. Default true. */
	allowMirror?: boolean;
}

export interface SteadyOptions extends ProcrustesOptions {
	/**
	 * How much existing nodes resist moving, 0 to 0.95.
	 * 0 = the rigidly aligned layout as-is; 0.95 = nodes barely move.
	 * Default 0.7.
	 */
	amount?: number;
}

export const DEFAULT_AMOUNT = 0.7;
export const MAX_AMOUNT = 0.95;

function toMap(p: Positions): ReadonlyMap<string, Pt> {
	return p instanceof Map ? p : new Map(Object.entries(p as Record<string, Pt>));
}

function ends(l: Link): [string, string] {
	return Array.isArray(l) ? [l[0], l[1]] : [(l as { source: string }).source, (l as { target: string }).target];
}

/**
 * Best rotation (optionally mirrored) plus shift that moves each `b` onto its
 * `a`, in the least-squares sense: 2D orthogonal Procrustes. No scaling: force
 * layouts of the same graph come out at the same scale, and scaling would let
 * a shrinking graph "cheat" its way to a lower error.
 *
 * Closed form, O(n): in 2D the optimal angle is atan2 of the summed cross and
 * dot products of the centred pairs, so no SVD is needed.
 *
 * Returns null with fewer than three pairs (nothing meaningful to fit).
 */
export function procrustes(pairs: ReadonlyArray<{ a: Pt; b: Pt }>, opts: ProcrustesOptions = {}): Fit | null {
	const n = pairs.length;
	if (n < 3) return null;
	const to = { x: 0, y: 0 };
	const from = { x: 0, y: 0 };
	for (const { a, b } of pairs) {
		to.x += a.x;
		to.y += a.y;
		from.x += b.x;
		from.y += b.y;
	}
	to.x /= n;
	to.y /= n;
	from.x /= n;
	from.y /= n;

	const solve = (mirror: 1 | -1) => {
		let cross = 0;
		let dot = 0;
		for (const { a, b } of pairs) {
			const bx = (b.x - from.x) * mirror;
			const by = b.y - from.y;
			const ax = a.x - to.x;
			const ay = a.y - to.y;
			cross += bx * ay - by * ax;
			dot += bx * ax + by * ay;
		}
		const rotation = Math.atan2(cross, dot);
		const cos = Math.cos(rotation);
		const sin = Math.sin(rotation);
		let err = 0;
		for (const { a, b } of pairs) {
			const bx = (b.x - from.x) * mirror;
			const by = b.y - from.y;
			err += (bx * cos - by * sin + to.x - a.x) ** 2 + (bx * sin + by * cos + to.y - a.y) ** 2;
		}
		return { rotation, cos, sin, mirror, err };
	};

	const plain = solve(1);
	const best = opts.allowMirror === false ? plain : [plain, solve(-1)].reduce((p, q) => (q.err < p.err ? q : p));
	const { cos, sin, mirror } = best;
	return {
		rotation: best.rotation,
		mirrored: mirror === -1,
		from,
		to,
		rms: Math.sqrt(best.err / n),
		apply: (p) => {
			const bx = (p.x - from.x) * mirror;
			const by = p.y - from.y;
			return { x: bx * cos - by * sin + to.x, y: bx * sin + by * cos + to.y };
		},
	};
}

/** Pairs of (previous, current) positions for the ids both layouts share. */
function shared(prev: ReadonlyMap<string, Pt>, cur: ReadonlyMap<string, Pt>): { a: Pt; b: Pt }[] {
	const pairs: { a: Pt; b: Pt }[] = [];
	for (const [id, b] of cur) {
		const a = prev.get(id);
		if (a) pairs.push({ a, b });
	}
	return pairs;
}

function centred(cur: ReadonlyMap<string, Pt>): Map<string, Pt> {
	let cx = 0;
	let cy = 0;
	for (const p of cur.values()) {
		cx += p.x;
		cy += p.y;
	}
	const k = Math.max(cur.size, 1);
	cx /= k;
	cy /= k;
	const out = new Map<string, Pt>();
	for (const [id, p] of cur) out.set(id, { x: p.x - cx, y: p.y - cy });
	return out;
}

/**
 * Rigidly move `cur` to best match `prev`, using the nodes both share as
 * anchors. Nodes only in `cur` come along for the ride; nodes only in `prev`
 * are ignored. The shape of `cur` is never changed.
 *
 * With no `prev` (or fewer than three shared nodes) the layout is centred on
 * the origin instead, so a sequence always starts somewhere predictable.
 */
export function align(prev: Positions | null | undefined, cur: Positions, opts: ProcrustesOptions = {}): Map<string, Pt> {
	const c = toMap(cur);
	const fit = prev ? procrustes(shared(toMap(prev), c), opts) : null;
	if (!fit) return centred(c);
	const out = new Map<string, Pt>();
	for (const [id, p] of c) out.set(id, fit.apply(p));
	return out;
}

/**
 * Lay `cur` out to stay close to `prev`:
 *
 * 1. Rigidly align it (see {@link align}).
 * 2. Each node that existed before moves only `1 - amount` of the way from
 *    its old spot towards its aligned new spot. Over many frames it still
 *    drifts to where the layout wants it, just gently.
 * 3. Each new node keeps its offset from the nodes it links to that already
 *    existed, so it appears next to them rather than wherever the force
 *    layout happened to drop it. New nodes with no old neighbour use their
 *    aligned position.
 *
 * Feed the *output* back in as `prev` for the next frame; that's what makes
 * the damping accumulate. Nodes only in `prev` are dropped.
 */
export function steady(
	prev: Positions | null | undefined,
	cur: Positions,
	links: Iterable<Link> = [],
	opts: SteadyOptions = {},
): Map<string, Pt> {
	const amount = Math.min(Math.max(opts.amount ?? DEFAULT_AMOUNT, 0), MAX_AMOUNT);
	const c = toMap(cur);
	if (!prev) return align(null, c, opts);
	const p = toMap(prev);
	const fit = procrustes(shared(p, c), opts);
	if (!fit) return align(null, c, opts);

	const fitted = new Map<string, Pt>();
	for (const [id, q] of c) fitted.set(id, fit.apply(q));
	if (amount === 0) return fitted;

	const follow = 1 - amount;
	const out = new Map<string, Pt>();
	for (const [id, f] of fitted) {
		const old = p.get(id);
		if (old) out.set(id, { x: old.x + (f.x - old.x) * follow, y: old.y + (f.y - old.y) * follow });
	}

	// New node -> the existing nodes it links to.
	const anchors = new Map<string, string[]>();
	const add = (id: string, to: string) => {
		const l = anchors.get(id);
		if (l) l.push(to);
		else anchors.set(id, [to]);
	};
	for (const l of links) {
		const [a, b] = ends(l);
		if (!c.has(a) || !c.has(b)) continue;
		const aOld = out.has(a);
		const bOld = out.has(b);
		if (!aOld && bOld) add(a, b);
		if (!bOld && aOld) add(b, a);
	}

	for (const [id, f] of fitted) {
		if (out.has(id)) continue;
		const near = anchors.get(id);
		if (!near?.length) {
			out.set(id, f);
			continue;
		}
		// Same offset from the neighbours' centre as in the aligned layout,
		// but measured from where those neighbours are actually drawn.
		let sx = 0, sy = 0, fx = 0, fy = 0;
		for (const m of near) {
			const q = out.get(m)!;
			const g = fitted.get(m)!;
			sx += q.x;
			sy += q.y;
			fx += g.x;
			fy += g.y;
		}
		const k = near.length;
		out.set(id, { x: sx / k + (f.x - fx / k), y: sy / k + (f.y - fy / k) });
	}
	return out;
}

/**
 * Convenience: run {@link steady} (or {@link align} when `amount` is 0) over a
 * whole sequence of layouts, feeding each result into the next.
 */
export function steadySequence(
	frames: Iterable<{ positions: Positions; links?: Iterable<Link> }>,
	opts: SteadyOptions = {},
): Map<string, Pt>[] {
	const out: Map<string, Pt>[] = [];
	let prev: Map<string, Pt> | null = null;
	for (const f of frames) {
		prev = steady(prev, f.positions, f.links ?? [], opts);
		out.push(prev);
	}
	return out;
}

/** Mean distance moved by nodes present in both layouts. Handy for tests and tuning. */
export function drift(prev: Positions, cur: Positions): number {
	const pairs = shared(toMap(prev), toMap(cur));
	if (!pairs.length) return 0;
	let sum = 0;
	for (const { a, b } of pairs) sum += Math.hypot(a.x - b.x, a.y - b.y);
	return sum / pairs.length;
}
