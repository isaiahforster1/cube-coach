import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
} from 'react';
import { FACELETS_PER_FACE, FACES, isSolved, type CubeState, type Face } from '@cube-coach/shared';
import { FACE_COLOURS, FACE_NAMES } from './colours.js';

export interface CubeViewProps {
  readonly state: CubeState;
  /** Pixel size of one edge of the cube. */
  readonly size?: number;
  readonly label?: string;
}

/**
 * How each face is rotated into place.
 *
 * These happen to line up exactly with the engine's facelet order, which is a small piece
 * of luck worth stating: each CSS face reads left-to-right and top-to-bottom as seen from
 * outside the cube, and that is precisely the convention `CubeState` uses. So sticker `n`
 * of a face goes straight into cell `n` with no translation layer in between.
 *
 * The one to check if this ever looks wrong is U: after `rotateX(90deg)` the top of the
 * element points towards the back of the cube, which is exactly how the engine indexes
 * the U face.
 */
const FACE_TRANSFORMS: Record<Face, string> = {
  U: 'rotateX(90deg)',
  D: 'rotateX(-90deg)',
  F: '',
  B: 'rotateY(180deg)',
  R: 'rotateY(90deg)',
  L: 'rotateY(-90deg)',
};

const ROTATION_STEP = 15;

/**
 * A cube drawn with CSS 3D transforms: six planes pushed out from a common centre.
 *
 * No 3D library. ADR-0001 chose this deliberately — it is a few dozen lines, has no
 * dependency, and renders a position perfectly well. What it cannot do comfortably is
 * animate a single layer turning, which needs pieces rather than faces. That is the point
 * at which Three.js earns its place, and it is not needed to show a position.
 */
export function CubeView({ state, size = 180, label }: CubeViewProps): ReactElement {
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
        {FACES.map((face, faceIndex) => (
          <div
            key={face}
            data-face={face}
            style={{
              position: 'absolute',
              width: size,
              height: size,
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: size * 0.02,
              padding: size * 0.02,
              background: '#0f172a',
              borderRadius: size * 0.06,
              transform: `${FACE_TRANSFORMS[face]} translateZ(${size / 2}px)`,
              // Without this the far faces show through the near ones and the cube looks
              // like a wireframe.
              backfaceVisibility: 'hidden',
            }}
          >
            {Array.from({ length: FACELETS_PER_FACE }, (_, cell) => {
              const sticker = state[faceIndex * FACELETS_PER_FACE + cell] as Face | undefined;
              return (
                <div
                  key={cell}
                  data-sticker={sticker}
                  style={{
                    background: sticker === undefined ? '#1e293b' : FACE_COLOURS[sticker],
                    borderRadius: size * 0.04,
                  }}
                />
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

/** A text description of the cube, for assistive technology and for tests. */
export function describeCube(state: CubeState): string {
  const counts = FACES.map(
    (face) => `${state.filter((sticker) => sticker === face).length} ${FACE_NAMES[face]}`,
  );
  return counts.join(', ');
}
