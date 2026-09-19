import type { Face } from '@cube-coach/shared';

/**
 * The standard Western colour scheme.
 *
 * The engine labels stickers by face, not colour, precisely so that the mapping lives
 * here in the interface. Someone using a Japanese-scheme cube, or a colour-blind user
 * needing a different palette, changes this file and nothing else.
 */
export const FACE_COLOURS: Record<Face, string> = {
  U: '#f8fafc',
  D: '#facc15',
  F: '#22c55e',
  B: '#3b82f6',
  R: '#ef4444',
  L: '#f97316',
};

export const FACE_NAMES: Record<Face, string> = {
  U: 'white',
  D: 'yellow',
  F: 'green',
  B: 'blue',
  R: 'red',
  L: 'orange',
};
