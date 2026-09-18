import type { ZodError } from 'zod';

/**
 * Flatten Zod issues into one message per field, for rendering next to inputs.
 *
 * Only the first issue per field is kept. Showing a user three simultaneous complaints
 * about one input is noise; they fix the first and the rest re-evaluate anyway.
 */
export function fieldErrors(error: ZodError): Record<string, string> {
  const errors: Record<string, string> = {};

  for (const issue of error.issues) {
    const field = issue.path[0];
    if (typeof field === 'string' && errors[field] === undefined) {
      errors[field] = issue.message;
    }
  }

  return errors;
}
