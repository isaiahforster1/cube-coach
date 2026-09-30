import { STANDARD_COLOUR_NAMES, type Face } from '@cube-coach/shared';

/**
 * The standard Western colour scheme.
 *
 * The engine labels stickers by face, not colour, precisely so that the mapping lives
 * in the interface. Someone using a Japanese-scheme cube, or a colour-blind user
 * needing a different palette, changes these tables and nothing in the engine.
 */
export const FACE_COLOURS: Record<Face, string> = {
  U: '#f8fafc',
  D: '#facc15',
  F: '#22c55e',
  B: '#3b82f6',
  R: '#ef4444',
  L: '#f97316',
};

/**
 * The names come from the shared contract, because the server writes solver explanations
 * ("the green–red pair") in them. One table means the sentence and the stickers beside it
 * cannot disagree. A different scheme changes it there.
 */
export const FACE_NAMES: Readonly<Record<Face, string>> = STANDARD_COLOUR_NAMES;
