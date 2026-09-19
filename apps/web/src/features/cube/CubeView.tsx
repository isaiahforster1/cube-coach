import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactElement,
} from 'react';
import { FACES, isSolved, type CubeState, type Face, type Move } from '@cube-coach/shared';
import { FACE_COLOURS, FACE_NAMES } from './colours.js';
import { faceOf, isInLayer, layerTransform, PIECES, positionKey, type Piece } from './geometry.js';

/** A move caught part-way through, for animating a turn. */
export interface PartialTurn {
  readonly move: Move;
  /** Degrees turned so far. Signed, so a prime turn winds the other way. */
  readonly angle: number;
}

export interface CubeViewProps {
  readonly state: CubeState;
  /** Pixel size of one edge of the cube. */
  readonly size?: number;
  readonly label?: string;
  /**
   * A turn in progress. The cube draws `state` with this layer rotated, so at the
   * move's full angle it looks exactly like the position after the move.
   */
  readonly turn?: PartialTurn | null;
}

/** How each face of a small cube is rotated into place. */
const FACE_TRANSFORMS: Record<Face, string> = {
  U: 'rotateX(90deg)',
  D: 'rotateX(-90deg)',
  F: '',
  B: 'rotateY(180deg)',
  R: 'rotateY(90deg)',
  L: 'rotateY(-90deg)',
};

const ROTATION_STEP = 15;

/** The dark plastic between the stickers, and the inside of the cube. */
const BODY = '#0f172a';

/**
 * A cube drawn with CSS 3D transforms, as 26 small cubes rather than six flat faces.
 *
 * Six faces would be less code and would render a position perfectly well — which is
 * what this was originally. It cannot animate a turn, though: turning R moves nine
 * *pieces* together, and those nine pieces own stickers on five different faces of the
 * engine's array. There is no transform you can apply to a flat face that does the
 * right thing to a third of it.
 *
 * Built from pieces, a turn becomes trivial: put the nine pieces of the layer into a
 * wrapper and rotate the wrapper. Everything else is untouched and the browser
 * composites it.
 *
 * The join at the end of a turn is the part worth understanding. While a turn animates,
 * this draws the position *before* the move with one layer rotated part-way. At the full
 * angle that is identical to drawing the position *after* the move with nothing rotated,
 * because the stickers in the layer have landed exactly where the engine says they go.
 * So when the animation finishes the parent swaps in the new state and drops the
 * rotation, and nothing visibly changes. The animation is decoration; the engine remains
 * the only authority on where stickers actually are.
 */
export function CubeView({ state, size = 180, label, turn = null }: CubeViewProps): ReactElement {
  const [rotation, setRotation] = useState({ x: -25, y: -35 });
  const [isDragging, setIsDragging] = useState(false);
  const dragOrigin = useRef<{ x: number; y: number; rotX: number; rotY: number } | null>(null);

  /**
   * Drag handling lives on `window`, not on the element.
   *
   * Attaching pointermove and pointerup to the cube itself looks fine until someone
   * drags quickly: the pointer outruns the element, capture can be lost, and the release
   * never reaches the handler. The drag then never ends and the cube follows the cursor
   * around as though it were glued to it.
   *
   * Listening on the window means the release is caught wherever it happens — including
   * outside the browser entirely, which `pointercancel` and losing focus both cover.
   */
  useEffect(() => {
    if (!isDragging) return;

    function handleMove(event: PointerEvent): void {
      const origin = dragOrigin.current;
      if (origin === null) return;

      setRotation({
        // Dragging down tips the top towards you, which is why this is subtracted.
        x: origin.rotX - (event.clientY - origin.y) * 0.5,
        y: origin.rotY + (event.clientX - origin.x) * 0.5,
      });
    }

    function stop(): void {
      dragOrigin.current = null;
      setIsDragging(false);
    }

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
    window.addEventListener('blur', stop);

    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
      window.removeEventListener('blur', stop);
    };
  }, [isDragging]);

  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    // Arrow keys rotate. Without this the cube is reachable by keyboard but not usable,
    // which is the more insidious kind of inaccessible.
    const deltas: Record<string, { x: number; y: number }> = {
      ArrowUp: { x: -ROTATION_STEP, y: 0 },
      ArrowDown: { x: ROTATION_STEP, y: 0 },
      ArrowLeft: { x: 0, y: -ROTATION_STEP },
      ArrowRight: { x: 0, y: ROTATION_STEP },
    };

    const delta = deltas[event.key];
    if (delta === undefined) return;

    event.preventDefault();
    setRotation((current) => ({ x: current.x + delta.x, y: current.y + delta.y }));
  }, []);

  // Splitting the pieces on every frame of a turn would be wasted work; the split only
  // changes when the move does.
  const turningFace = turn === null ? null : faceOf(turn.move);
  const { still, turning } = useMemo(() => {
    if (turningFace === null) return { still: PIECES, turning: [] as readonly Piece[] };
    return {
      still: PIECES.filter((piece) => !isInLayer(piece.position, turningFace)),
      turning: PIECES.filter((piece) => isInLayer(piece.position, turningFace)),
    };
  }, [turningFace]);

  const describedState = label ?? (isSolved(state) ? 'Solved cube' : 'Scrambled cube');

  return (
    <div
      role="img"
      aria-label={`${describedState}. Use the arrow keys to rotate.`}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onPointerDown={(event) => {
        // Stops the browser starting a text selection or an image drag mid-rotation,
        // which is the other way a drag ends up feeling sticky. Preventing the
        // default also suppresses focus, so focus is taken explicitly — otherwise
        // clicking the cube would leave the arrow keys doing nothing.
        event.currentTarget.focus();
        event.preventDefault();
        dragOrigin.current = {
          x: event.clientX,
          y: event.clientY,
          rotX: rotation.x,
          rotY: rotation.y,
        };
        setIsDragging(true);
      }}
      className="inline-block cursor-grab touch-none rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-sky-400 active:cursor-grabbing"
      style={{ perspective: `${size * 4}px`, padding: size * 0.35 }}
    >
      <div
        data-testid="cube-scene"
        style={{
          width: size,
          height: size,
          position: 'relative',
          transformStyle: 'preserve-3d',
          transform: `rotateX(${rotation.x}deg) rotateY(${rotation.y}deg)`,
          // No easing while dragging, or the cube lags behind the cursor.
          transition: isDragging ? 'none' : 'transform 120ms ease-out',
        }}
      >
        {still.map((piece) => (
          <Cubie key={positionKey(piece.position)} piece={piece} state={state} size={size} />
        ))}

        {turn !== null && (
          <div
            data-testid="turning-layer"
            data-move={turn.move}
            style={{
              position: 'absolute',
              inset: 0,
              transformStyle: 'preserve-3d',
              transform: layerTransform(turn.move, turn.angle),
            }}
          >
            {turning.map((piece) => (
              <Cubie key={positionKey(piece.position)} piece={piece} state={state} size={size} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * One of the 26 small cubes.
 *
 * Memoised because a turn re-renders the cube on every animation frame while only the
 * wrapper's transform actually changes. Without this, sixty times a second React would
 * walk 26 pieces and 156 faces to conclude that none of them had changed.
 */
const Cubie = memo(function Cubie({
  piece,
  state,
  size,
}: {
  piece: Piece;
  state: CubeState;
  size: number;
}): ReactElement {
  const unit = size / 3;
  // A little smaller than its cell, which leaves the dark gaps a real cube has — and
  // means the sides of the pieces show properly once a layer starts to turn.
  const body = unit * 0.94;
  const { x, y, z } = piece.position;

  function stickerOn(face: Face): Face | null {
    const placement = piece.stickers.find((candidate) => candidate.face === face);
    if (placement === undefined) return null;
    return (state[placement.facelet] ?? null) as Face | null;
  }

  const style: CSSProperties = {
    position: 'absolute',
    width: body,
    height: body,
    left: (size - body) / 2,
    top: (size - body) / 2,
    transformStyle: 'preserve-3d',
    // Screen y points down and the cube's points up, hence the negation.
    transform: `translate3d(${x * unit}px, ${-y * unit}px, ${z * unit}px)`,
  };

  return (
    <div style={style} data-piece={positionKey(piece.position)}>
      {FACES.map((face) => {
        const sticker = stickerOn(face);
        return (
          <div
            key={face}
            {...(sticker === null ? {} : { 'data-sticker': sticker, 'data-face': face })}
            style={{
              position: 'absolute',
              inset: 0,
              background: sticker === null ? BODY : FACE_COLOURS[sticker],
              // The sticker sits inside a dark border, which is what gives a real cube
              // its outlined look.
              border: sticker === null ? 'none' : `${Math.max(1, body * 0.06)}px solid ${BODY}`,
              borderRadius: body * 0.16,
              transform: `${FACE_TRANSFORMS[face]} translateZ(${body / 2}px)`,
              // Without this you see the inside of the far pieces through the near ones.
              backfaceVisibility: 'hidden',
            }}
          />
        );
      })}
    </div>
  );
});

/** A text description of the cube, for assistive technology and for tests. */
export function describeCube(state: CubeState): string {
  const counts = FACES.map(
    (face) => `${state.filter((sticker) => sticker === face).length} ${FACE_NAMES[face]}`,
  );
  return counts.join(', ');
}
