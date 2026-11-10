# steady-graph

**Keep force-directed graph layouts from spinning, flipping and jumping between runs.**

Force layouts (Obsidian's graph view, d3-force, Gephi, Cytoscape…) start from random positions. Lay out the same graph twice and you get the same *shape*, but rotated, mirrored and somewhere else. Lay out tomorrow's slightly bigger graph and clusters also trade places. String those layouts into an animation and you get noise instead of growth.

`steady-graph` fixes that in about 150 lines with no dependencies:

| | What it does | Changes the shape? |
|---|---|---|
| `align(prev, cur)` | Rotates, mirrors and shifts `cur` as a whole so shared nodes land where they were (2D Procrustes). | No |
| `steady(prev, cur, links)` | Aligns, then lets existing nodes move only part of the way to their new spot, and places new nodes beside their linked neighbours. | A little, on purpose |

**Live demo:** https://shadyknolllabs.com/steady-graph

It was pulled out of [Graph Timelapse](https://github.com/mabbott2011/Graph_Timelapse), an Obsidian plugin that records your graph view daily and plays it back as a timelapse.

## Install

```bash
npm install steady-graph
```

ES module, works in browsers and Node 18+. TypeScript types included.

## Use

Positions are keyed by a stable id: a file path, a database key, anything that means "the same node" from one layout to the next.

```js
import { align, steady } from "steady-graph";

// Yesterday's layout (already on screen) and today's fresh force layout.
const prev = new Map([["a.md", { x: 0, y: 0 }], ["b.md", { x: 100, y: 0 }], ["c.md", { x: 0, y: 100 }]]);
const cur  = { "a.md": { x: 50, y: 50 }, "b.md": { x: 50, y: 150 }, "c.md": { x: -50, y: 50 }, "d.md": { x: 60, y: 160 } };

// Same shape, same orientation as yesterday:
const aligned = align(prev, cur);

// Or calmer still, for animation. Feed each result back in as `prev`.
const links = [["d.md", "b.md"]];
const calm = steady(prev, cur, links, { amount: 0.7 });
```

Both return a `Map<string, {x, y}>` containing exactly the ids in `cur`.

### With d3-force

```js
import { forceSimulation, forceLink, forceManyBody } from "d3-force";
import { steady } from "steady-graph";

let shown = null; // what's on screen now

function relayout(nodes, links) {
  forceSimulation(nodes).force("link", forceLink(links).id((d) => d.id)).force("charge", forceManyBody()).stop().tick(300);
  const raw = new Map(nodes.map((n) => [n.id, { x: n.x, y: n.y }]));
  shown = steady(shown, raw, links.map((l) => [l.source.id, l.target.id]));
  draw(shown); // tween from the old positions to these
}
```

### A whole sequence at once

```js
import { steadySequence } from "steady-graph";

const frames = steadySequence(days.map((d) => ({ positions: d.positions, links: d.links })), { amount: 0.7 });
```

## API

### `align(prev, cur, options?) → Map<string, Pt>`
Rigidly fits `cur` onto `prev` using the ids both contain. Ids only in `cur` move with the fit; ids only in `prev` are ignored. If `prev` is null or they share fewer than three ids, `cur` is centred on the origin instead.

### `steady(prev, cur, links?, options?) → Map<string, Pt>`
`align`, then:
1. each id that was in `prev` moves `1 - amount` of the way from its old position toward its aligned new one;
2. each new id keeps its offset from the centre of the old ids it links to, measured from where those are *drawn*, so it appears beside them;
3. new ids with no old neighbour use their aligned position.

Pass the result back in as the next `prev`; that's what makes the damping accumulate into smooth motion.

### `steadySequence(frames, options?) → Map<string, Pt>[]`
Runs `steady` across `[{ positions, links? }, …]`, chaining each output into the next.

### `procrustes(pairs, options?) → Fit | null`
The core math, exposed. `pairs` is `[{ a, b }, …]`; finds the rotation (optionally mirrored) and shift that best moves every `b` onto its `a`. Returns `{ rotation, mirrored, from, to, rms, apply(p) }`, or `null` with fewer than three pairs.

### `drift(prev, cur) → number`
Mean distance moved by shared ids. Useful for tests and tuning `amount`.

### Types and options
- `Pt` = `{ x: number, y: number }`
- `Positions` = `Map<string, Pt>` or `Record<string, Pt>`
- `Link` = `[idA, idB]` or `{ source, target }` (ids, not objects)
- `allowMirror` (default `true`): also try the flipped fit and keep whichever is closer
- `amount` (default `0.7`, clamped to 0–0.95): how much existing nodes resist moving

## How it works

See [docs/HOW-IT-WORKS.md](docs/HOW-IT-WORKS.md) for the math in plain terms. Short version: the best rotation between two 2D point sets has a closed form, the `atan2` of the summed cross and dot products of the centred pairs, so there's no SVD and it runs in O(n). It tries the mirrored fit too, because force layouts converge to a flipped copy about half the time.

## Limits

- **Rigid alignment can't undo cluster reshuffles.** If the layout puts a cluster on the other side of the graph, `align` leaves it there. `steady` slows that move to a crawl but doesn't forbid it.
- **Ids must be stable.** A renamed node looks like one deletion plus one new node.
- **It doesn't run the layout.** Bring your own force simulation; this only post-processes its output.

## Test

```bash
npm install
npm test
```

## License

MIT © Shady Knoll Labs
