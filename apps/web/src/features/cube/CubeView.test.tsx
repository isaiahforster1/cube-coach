import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { applyMoves, createSolvedCube, parseAlgorithm, FACES } from '@cube-coach/shared';
import { CubeView } from './CubeView.js';

/** The rotation alone, ignoring properties like transition that change with drag state. */
function transformOf(container: HTMLElement): string {
  const style = container.querySelector('[data-testid="cube-scene"]')?.getAttribute('style') ?? '';
  return /transform: ([^;]+);/u.exec(style)?.[1] ?? '';
}

function stickers(container: HTMLElement) {
  return [...container.querySelectorAll('[data-sticker]')];
}

describe('CubeView', () => {
  it('draws all 54 stickers', () => {
    const { container } = render(<CubeView state={createSolvedCube()} />);
    expect(stickers(container)).toHaveLength(54);
  });

  it('draws nine stickers of each colour on a solved cube', () => {
    const { container } = render(<CubeView state={createSolvedCube()} />);

    for (const face of FACES) {
      const matching = stickers(container).filter(
        (sticker) => sticker.getAttribute('data-sticker') === face,
      );
      expect(matching).toHaveLength(9);
    }
  });

  /**
   * The check that the CSS layout agrees with the engine's facelet order. Each face
   * element must contain exactly its own nine stickers when the cube is solved — if a
   * face were wired to the wrong slice of the array, this fails immediately.
   */
  it.each(FACES)('puts the right nine stickers on face %s when solved', (face) => {
    const { container } = render(<CubeView state={createSolvedCube()} />);
    const element = container.querySelector(`[data-face="${face}"]`);

    const faceStickers = [...(element?.querySelectorAll('[data-sticker]') ?? [])];
    expect(faceStickers).toHaveLength(9);
    expect(faceStickers.every((s) => s.getAttribute('data-sticker') === face)).toBe(true);
  });

  it('reflects a move in the stickers it draws', () => {
    const scrambled = applyMoves(createSolvedCube(), parseAlgorithm('R'));
    const { container } = render(<CubeView state={scrambled} />);

    const front = container.querySelector('[data-face="F"]');
    const frontStickers = [...(front?.querySelectorAll('[data-sticker]') ?? [])].map((s) =>
      s.getAttribute('data-sticker'),
    );

    // R pulls the D colour up into the front-right column, so the front face is no
    // longer uniform.
    expect(new Set(frontStickers).size).toBeGreaterThan(1);
  });

  it('still shows nine of each colour after scrambling, because moves permute stickers', () => {
    const scrambled = applyMoves(createSolvedCube(), parseAlgorithm("R U R' U' F2 D B L2"));
    const { container } = render(<CubeView state={scrambled} />);

    for (const face of FACES) {
      const matching = stickers(container).filter(
        (sticker) => sticker.getAttribute('data-sticker') === face,
      );
      expect(matching).toHaveLength(9);
    }
  });

  it('describes itself for assistive technology', () => {
    render(<CubeView state={createSolvedCube()} />);
    expect(screen.getByRole('img', { name: /solved cube/iu })).toBeInTheDocument();
  });

  it('says when it is showing a scrambled position', () => {
    render(<CubeView state={applyMoves(createSolvedCube(), parseAlgorithm('R'))} />);
    expect(screen.getByRole('img', { name: /scrambled cube/iu })).toBeInTheDocument();
  });

  it('takes a caption when the context needs a better one', () => {
    render(<CubeView state={createSolvedCube()} label="T permutation case" />);
    expect(screen.getByRole('img', { name: /t permutation case/iu })).toBeInTheDocument();
  });

  /** Reachable by keyboard is not the same as usable by keyboard. */
  it('rotates with the arrow keys', async () => {
    const user = userEvent.setup();
    const { container } = render(<CubeView state={createSolvedCube()} />);

    const before = transformOf(container);

    await user.click(screen.getByRole('img'));
    await user.keyboard('{ArrowRight}');

    expect(transformOf(container)).not.toBe(before);
  });

  it('is focusable', () => {
    render(<CubeView state={createSolvedCube()} />);
    expect(screen.getByRole('img')).toHaveAttribute('tabindex', '0');
  });
});

describe('CubeView dragging', () => {
  /**
   * The bug this covers: pointermove and pointerup used to be bound to the element, so a
   * fast drag could outrun it and the release would never be seen. The drag then never
   * ended and the cube followed the cursor around as though glued to it.
   */
  it('stops rotating when the pointer is released anywhere on the page', () => {
    const { container } = render(<CubeView state={createSolvedCube()} />);
    const cube = screen.getByRole('img');

    fireEvent.pointerDown(cube, { clientX: 0, clientY: 0 });
    fireEvent.pointerMove(window, { clientX: 40, clientY: 0 });
    const whileDragging = transformOf(container);

    // Released far away from the cube, which is what happens on a fast drag.
    fireEvent.pointerUp(window, { clientX: 400, clientY: 400 });

    // Further movement must be ignored now the drag has ended.
    fireEvent.pointerMove(window, { clientX: 800, clientY: 800 });
    expect(transformOf(container)).toBe(whileDragging);
  });

  it('ends the drag if the browser cancels the gesture', () => {
    const { container } = render(<CubeView state={createSolvedCube()} />);

    fireEvent.pointerDown(screen.getByRole('img'), { clientX: 0, clientY: 0 });
    fireEvent.pointerMove(window, { clientX: 20, clientY: 0 });
    const before = transformOf(container);

    fireEvent.pointerCancel(window);
    fireEvent.pointerMove(window, { clientX: 300, clientY: 300 });

    expect(transformOf(container)).toBe(before);
  });

  it('ends the drag when the window loses focus', () => {
    const { container } = render(<CubeView state={createSolvedCube()} />);

    fireEvent.pointerDown(screen.getByRole('img'), { clientX: 0, clientY: 0 });
    fireEvent.pointerMove(window, { clientX: 20, clientY: 0 });
    const before = transformOf(container);

    fireEvent.blur(window);
    fireEvent.pointerMove(window, { clientX: 300, clientY: 300 });

    expect(transformOf(container)).toBe(before);
  });

  it('rotates while the pointer is down', () => {
    const { container } = render(<CubeView state={createSolvedCube()} />);
    const before = transformOf(container);

    fireEvent.pointerDown(screen.getByRole('img'), { clientX: 0, clientY: 0 });
    fireEvent.pointerMove(window, { clientX: 60, clientY: 30 });

    expect(transformOf(container)).not.toBe(before);
  });

  /** Clicking must still focus the cube, or the arrow keys do nothing afterwards. */
  it('takes focus when clicked, despite suppressing the default action', () => {
    render(<CubeView state={createSolvedCube()} />);
    const cube = screen.getByRole('img');

    fireEvent.pointerDown(cube, { clientX: 0, clientY: 0 });
    expect(document.activeElement).toBe(cube);
  });
});
