import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import staticFiles from '@fastify/static';
import type { FastifyInstance } from 'fastify';

/**
 * Serve the built web client from the API process, so both live on one origin.
 *
 * This is a deployment decision as much as a code one, and the reason is the session
 * cookie. It is `sameSite: 'lax'`, which means a browser will not attach it to a
 * cross-site request — so a web client on `app.example.com` calling an API on
 * `api.example.com` would be silently signed out on every call. The usual fix is
 * `sameSite: 'none'`, which turns CSRF back on and buys nothing here.
 *
 * Serving both from one origin avoids the problem rather than working around it: the
 * cookie stays same-site, CORS stops being involved at all, and the OAuth callback comes
 * back to the same place the user started.
 *
 * In development the two still run on separate ports, which is what CORS is configured
 * for. This only engages when a build is actually present.
 */
export async function registerWebClient(app: FastifyInstance, root: string): Promise<boolean> {
  const directory = resolve(root);
  if (!existsSync(directory)) {
    app.log.warn({ directory }, 'No web build found; serving the API only');
    return false;
  }

  await app.register(staticFiles, { root: directory, wildcard: false });

  app.log.info({ directory }, 'Serving the web client');
  return true;
}

/**
 * Whether an unmatched request should be answered with the client's `index.html`.
 *
 * A single-page application owns its own URLs: `/stats` exists in the browser but not on
 * disk, so a refresh there has to be handed the app shell and left for the client's
 * router to work out.
 *
 * API paths are deliberately excluded. Answering an unknown `/api/v1/...` with a page of
 * HTML turns a typo into a parse error somewhere far away, rather than the 404 it is.
 */
export function wantsAppShell(request: {
  readonly method: string;
  readonly url: string;
  readonly headers: { readonly accept?: string | undefined };
}): boolean {
  if (request.method !== 'GET') return false;
  if (request.url.startsWith('/api') || request.url.startsWith('/health')) return false;

  return request.headers.accept?.includes('text/html') ?? false;
}
