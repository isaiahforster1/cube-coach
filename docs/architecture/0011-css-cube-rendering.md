# ADR-0011: Render the cube with CSS 3D transforms

## Status

Accepted — 2026-09-18

## Context

The application needs to draw a cube position: in the playground, and from M11 onwards to
show algorithm cases. Later it will want to _animate_ a layer turning, and eventually to
replay a whole solve.

ADR-0001 chose CSS 3D transforms over Three.js for the first version, deferring the
decision until there was a concrete need.

## Decision

Six `div` elements, each a 3×3 grid of stickers, rotated into place and pushed outward
from a common centre with `translateZ`. The container carries `perspective`, and the scene
carries a `rotateX`/`rotateY` that the user can change by dragging or with the arrow keys.

No 3D library.

## The part worth recording

The CSS face transforms line up exactly with the engine's facelet order, so sticker _n_ of
a face goes straight into grid cell _n_ with nothing in between.

That is not quite luck. Both conventions describe a face as seen from outside the cube,
read left-to-right and top-to-bottom, and both resolve the ambiguous cases the same way —
after `rotateX(90deg)` the top edge of the U face element points towards the back of the
cube, which is precisely how the engine indexes U.

It would have been easy to assume this and be wrong, so there is a test per face asserting
that a solved cube puts exactly nine stickers of the right colour on each one. If someone
changes a transform, it fails immediately.

## Consequences

**Made easier.** About sixty lines, no dependency, and nothing to learn before reading it.
It renders any position perfectly well, is trivially themeable through one colour map, and
the whole thing is testable in jsdom because it is just elements with attributes — the
tests assert on stickers rather than on pixels.

Colour lives in the interface rather than the engine, which keeps the engine
colour-scheme-agnostic and makes an alternative palette a one-file change.

**Made harder — and this is the real limit.** The cube is drawn as six _faces_, but a
layer turn moves _pieces_, and the pieces in a turning layer belong to five different
faces. Animating one means splitting the model into 26 cubies and re-parenting them mid-
rotation, which is where this approach stops being sixty readable lines.

So this renders positions, and it does not animate turns. Switching a position is
instantaneous.

**When Three.js earns its place.** At solve replay, or whenever animated turns are wanted.
The component takes a `CubeState` and renders it, so the renderer can be replaced without
anything else noticing — which was the point of introducing `CubeView` as a seam rather
than drawing inline.

## Alternatives considered

**Three.js via react-three-fiber now.** The right tool for animation, and roughly 150 kB
of dependency plus a rendering model to learn, in exchange for a capability not yet
needed. Deferring it cost nothing, because the seam makes the switch cheap.

**A flat 2D net** — the unfolded-cross diagram used by most algorithm sites. Simpler
still, and genuinely clearer for showing a single last-layer case. It may yet be worth
adding _alongside_ the 3D view for the algorithm library, where the convention is a flat
diagram.

**Pre-rendered images per case.** What many algorithm sites do. Rejected because it cannot
show an arbitrary position, which is the whole point here.
