import type { FastifyInstance } from 'fastify';
import { ZodError } from 'zod';

/**
 * One error shape for the entire API:
 *
 * ```json
 * { "error": { "code": "VALIDATION_FAILED", "message": "...", "details": [...] } }
 * ```
 *
 * `code` is a stable machine-readable string. Clients branch on it; they must never
 * branch on `message`, which is for humans and may be reworded at any time.
 */
export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

/** An error with an HTTP status and a stable code, thrown deliberately by our own code. */
export class ApiError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function registerErrorHandler(app: FastifyInstance, isProduction: boolean): void {
  app.setNotFoundHandler((request, reply) => {
    void reply.status(404).send({
      error: {
        code: 'NOT_FOUND',
        message: `Route ${request.method} ${request.url} not found`,
      },
    } satisfies ApiErrorBody);
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ApiError) {
      request.log.info({ err: error }, 'Request failed');
      void reply.status(error.statusCode).send({
        error: {
          code: error.code,
          message: error.message,
          ...(error.details === undefined ? {} : { details: error.details }),
        },
      } satisfies ApiErrorBody);
      return;
    }

    if (error instanceof ZodError) {
      void reply.status(400).send({
        error: {
          code: 'VALIDATION_FAILED',
          message: 'The request body or parameters are invalid',
          details: error.issues,
        },
      } satisfies ApiErrorBody);
      return;
    }

    // Anything else arrives as `unknown`, so it is narrowed explicitly rather than
    // assumed to be an Error. A thrown string or object is unusual but legal, and
    // asserting otherwise is how error handlers themselves end up throwing.
    const statusCode = numericProperty(error, 'statusCode') ?? 500;

    if (statusCode < 500) {
      // Fastify's own errors land here: malformed JSON, payload too large, and so on.
      void reply.status(statusCode).send({
        error: {
          code: stringProperty(error, 'code') ?? 'BAD_REQUEST',
          message: messageOf(error),
        },
      } satisfies ApiErrorBody);
      return;
    }

    // A 500 is a bug. Log it in full, but never send the details to the client in
    // production: stack traces and driver messages leak table names, file paths and
    // library versions that are useful to an attacker.
    request.log.error({ err: error }, 'Unhandled error');

    void reply.status(500).send({
      error: {
        code: 'INTERNAL_ERROR',
        message: isProduction ? 'Something went wrong' : messageOf(error),
      },
    } satisfies ApiErrorBody);
  });
}

function numericProperty(value: unknown, key: string): number | undefined {
  if (typeof value !== 'object' || value === null || !(key in value)) return undefined;
  const property = (value as Record<string, unknown>)[key];
  return typeof property === 'number' ? property : undefined;
}

function stringProperty(value: unknown, key: string): string | undefined {
  if (typeof value !== 'object' || value === null || !(key in value)) return undefined;
  const property = (value as Record<string, unknown>)[key];
  return typeof property === 'string' ? property : undefined;
}

function messageOf(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}
