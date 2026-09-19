# ADR-0014: Animate turns by drawing pieces, not faces

## Status

Accepted — 2026-09-19. Supersedes [ADR-0011](0011-css-cube-rendering.md).

## Context

Scramble notation is a compressed language for people who already read it. `R U2 F'` tells
an experienced cuber exactly what to do and tells a beginner nothing at all — which
quietly makes the timer unusable for precisely the people most likely to want coaching.

So the scramble needs to be playable: a cube that performs the moves, at a speed the
viewer sets.

ADR-0011 chose CSS 3D transforms over Three.js and was explicit about the limit it
accepted: the cube was six flat faces, a layer turn moves nine _pieces_, and the nine
pieces of a layer own stickers on five different faces. It concluded that animating a turn
meant either splitting the model into cubies or bringing in Three.js, and predicted
Three.js would be the answer.

## Decision

Split the model into cubies. Keep CSS.

`CubeView` now draws 26 small cubes rather than six planes. Each carries its own stickers
and is translated out from the centre. A turn is then one wrapper element around the nine
pieces of the layer, with a single `rotateX`/`rotateY`/`rotateZ` on it.

Three.js was not needed after all, which is worth recording honestly: ADR-0011's
prediction was wrong, and it was wrong because it measured the difficulty of the
_rendering_ rather than the difficulty of the _coordinates_. Once every sticker knows
where it is in space, the animation is a transform on a wrapper and the browser does the
rest.

## The part worth understanding

While a turn is animating, the cube draws **the position before the move, with one layer
rotated part-way**. At the move's full angle that is identical to drawing **the position
after the move, with nothing rotated** — because the stickers in the layer have landed
exactly where the engine says they go.

So the handover at the end of a turn is invisible: the player advances the move count, the
engine produces the next position, the rotation is dropped, and no pixel changes.

That is the whole design. The animation never computes a cube position; it only
interpolates an angle. The engine remains the only authority on where stickers are, which
means an animation bug can make the cube look wrong for a moment but can never leave it in
a position that does not exist.

## Getting the coordinates right

`geometry.ts` holds the one piece of new hand-derived data: which point in space each of
the 54 facelet indices sits at, and which way it faces. Each face is read left-to-right
and top-to-bottom _as seen from outside_, so the row and column mean something different
on every face, and getting one wrong produces a cube that looks perfect when solved and
scrambles incorrectly.

The engine's move tables were derived one way — adjacent strips of facelet indices. These
coordinates were derived another — positions in space. If both are right they must produce
identical moves, so `geometry.test.ts` rebuilds all eighteen moves from the coordinates
alone and compares them against the engine, over random scrambled positions rather than a
solved cube (on a solved cube every sticker on a face is the same colour, so a mapping
that shuffles cells within one face would pass).

This is the same cross-check that previously caught three reversed tables in the engine
itself.

There is a second, separate trap: CSS measures y **downwards** while the cube measures it
upwards, so a clockwise turn seen from outside is a positive rotation for some faces and a
negative one for others. Get it wrong and half the moves spin backwards — and still end in
the correct position, because a backwards quarter turn followed by the engine's swap
lands somewhere obviously wrong only if you are watching. There is a test that derives
each face's CSS direction from the cube's own rotation and the screen's axis flip.

## Consequences

**Made easier.** Animated turns, in about a hundred lines and no dependency. The playback
controls, the speed slider and the notation highlight all fall out of a single number —
how many moves are done — because the position is derived from it rather than stored.

The same renderer still draws a static position: pass no turn and nothing rotates, so
every existing use is unchanged.

**Made harder.** 26 elements with 156 faces instead of 6 with 54, all re-rendered whenever
React re-renders the cube. Each piece is memoised, so during a turn only the wrapper's
transform actually changes, but the component is no longer something you take in at a
glance.

Depth sorting is now the browser's problem. `preserve-3d` handles it, but stacking bugs in
CSS 3D are debugged by looking, not by testing.

**Shared with the playground.** The timeline lives in `useTurnAnimation`, which owns only
the clock: which move, how far through it is, and when it lands. It has no idea what a
scramble or a move history is, which is exactly what lets the scramble player and the
move playground share it — they have completely different notions of "where the cube is"
and identical notions of "a layer is turning".

The caller keeps owning the position. When a turn lands, the hook hands back a payload and
the caller updates its own state; the hook never touches a cube. Starting a turn while one
is running replaces it rather than queueing or refusing, and the caller folds the
in-flight payload into its own state first, so nothing is lost when someone presses a
button faster than the cube can turn.

## Alternatives considered

**Three.js, as ADR-0011 predicted.** Still the right tool if this grows into solve replay
with smooth camera work, and still roughly 150 kB plus a rendering model to learn. It buys
nothing that is needed here.

**Stepping without animation** — snap from one position to the next at the slider's speed.
Much less code, and it fails the actual requirement: a beginner watching stickers teleport
cannot tell which layer moved, which is the one thing the feature exists to show.

**Animating with CSS transitions instead of a frame loop.** Fewer moving parts, but the
completion has to be caught with `transitionend`, which does not fire if the element is
re-parented or the tab is hidden mid-turn — and a missed completion strands the cube
mid-move. A frame loop that asks the clock how far along it is cannot get stuck.
