# How steady-graph works

## The problem

A force-directed layout treats nodes like magnets that push apart and links like springs that pull together, then lets the system settle. It starts from random positions, and the forces only care about *distances*, so the physics has no preferred direction. The same graph settles into the same shape, but:

- **rotated** by any angle,
- **mirrored** (a flipped copy is just as stable),
- **shifted** anywhere.

Add a few nodes and it can also **reshuffle** clusters. Play daily layouts back-to-back and the whole thing spins and jumps.

## Step 1: rigid alignment (Procrustes)

Procrustes is a 1930s–60s statistics technique for comparing shapes: find the rotation and shift that make shape B sit on top of shape A as closely as possible. (The name is from Greek myth: an innkeeper who stretched or cut his guests to fit his bed.)

We only use nodes present in both layouts, the anchors.

1. **Remove the shift.** Subtract each layout's centroid (average position) from its anchors. Now both are centred on the origin, and only rotation is left to find.
2. **Find the rotation.** For each centred pair `a`, `b` add up
   - `cross += b.x·a.y − b.y·a.x` (how much `b` needs to turn counter-clockwise to reach `a`)
   - `dot += b.x·a.x + b.y·a.y` (how much they already agree)

   The best angle is `atan2(cross, dot)`. In 2D that's the exact least-squares answer, so there's no matrix decomposition, just one pass over the points.
3. **Try the mirror.** Negate every `b.x` and repeat. Keep whichever fit leaves less error.
4. **Apply.** Move *every* node in the new layout, anchors and newcomers, by the same mirror, rotation and shift.

No scaling: layouts of the same graph come out at the same scale, and allowing scale would let a fit shrink everything to cut its error.

This never changes the shape: distances between nodes are preserved exactly. It removes the spinning, flipping and sliding, but not reshuffles.

## Step 2: damping (`steady`)

After alignment, a node that the layout moved across the graph still jumps. So:

- **Existing nodes** move only `1 − amount` of the way from where they're drawn now toward their aligned position. With `amount = 0.7`, 30% per frame. Over several frames they still arrive; they just don't teleport.
- **New nodes** have no "drawn now" position. Rather than appear wherever the layout dropped them (which might be far from a damped neighbour), each one keeps the same offset from its linked old neighbours that it has in the aligned layout, but measured from where those neighbours are actually drawn. A new note linked to `projects.md` pops up next to `projects.md`.

Because the output is fed back in as the next `prev`, the damping accumulates: the drawn layout is always a calm, lagging follower of what the force layout wants.

## Choosing `amount`

| `amount` | Feel |
|---|---|
| 0 | Pure alignment. Shape is exactly the layout's. Reshuffles show as jumps. |
| 0.5 | Quick but smooth. |
| 0.7 | Default. Growth reads clearly; settles over 3–5 frames. |
| 0.9+ | Very calm; the graph can look "stuck" relative to the real structure. |

## Where this came from

Built for [Graph Timelapse](https://github.com/mabbott2011/Graph_Timelapse), which snapshots Obsidian's graph view every day. Obsidian re-randomises the layout every time the graph opens, so without this the timelapse was mostly spinning.
