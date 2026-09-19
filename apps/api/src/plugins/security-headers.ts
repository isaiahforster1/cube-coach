import helmet from '@fastify/helmet';
import type { FastifyInstance } from 'fastify';

/**
 * The headers that tell a browser what this site is allowed to do.
 *
 * Most of them are uncontroversial defaults — no MIME sniffing, no framing, a referrer
 * policy that does not leak paths to other sites. The content security policy is the one
 * worth reading, because a policy that is too strict breaks the page silently and a
 * policy that is too loose is decoration.
 */
export async function registerSecurityHeaders(
  app: FastifyInstance,
  { isProduction }: { isProduction: boolean },
): Promise<void> {
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],

        /**
         * `wasm-unsafe-eval` is required, and is narrower than it sounds.
         *
         * Competition-quality scrambles come from a solver compiled to WebAssembly
         * (ADR-0004), and instantiating a WebAssembly module counts as compiling code.
         * This directive permits exactly that and still forbids `eval` and friends —
         * the blanket alternative, `unsafe-eval`, would allow both.
         */
        scriptSrc: ["'self'", "'wasm-unsafe-eval'"],

        /**
         * The cube is drawn with inline `style` attributes — a transform per piece,
         * recalculated as it turns — and there is no way to express that in a
         * stylesheet. Inline styles cannot execute anything, so the exposure is
         * defacement rather than code execution.
         */
        styleSrc: ["'self'", "'unsafe-inline'"],

        /**
         * The scramble solver runs in a worker, and the library starts it from a `data:`
         * URL with a `blob:` fallback rather than from a file on disk.
         *
         * Without this the worker is blocked, scrambles never arrive, and the timer sits
         * on "Generating scramble…" forever — a failure that appears only in production,
         * because the development server sends no policy at all. It was found by
         * building the client and running it behind this policy before deploying, which
         * is the only way it could have been found. `worker-src` falls back to
         * `script-src` when unset, which is why the default blocked it.
         *
         * Allowing `data:` here is a real loosening and worth being clear about. A
         * `data:` worker can be built from a string, so it is a way to run code — but
         * reaching it already requires script execution on the page, which `script-src
         * 'self'` (no `unsafe-inline`) is what actually prevents. The alternative is
         * dropping to move-based scrambles, which are not competition quality
         * (ADR-0004), and that is a worse trade for this application.
         */
        workerSrc: ["'self'", 'blob:', 'data:'],

        imgSrc: ["'self'", 'data:'],
        // The client talks to its own origin and nowhere else. Google sign-in happens by
        // redirecting the browser, not by the page calling Google.
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        // Only meaningful over HTTPS, and harmless in development where there is none.
        ...(isProduction ? { upgradeInsecureRequests: [] } : {}),
      },
    },

    /**
     * Tell browsers to refuse plain HTTP for this host in future.
     *
     * Production only: sending this from a development server would poison the
     * browser's HSTS list for `localhost` and break every other project served from
     * there over HTTP.
     */
    hsts: isProduction ? { maxAge: 31_536_000, includeSubDomains: true, preload: false } : false,

    // The API is served from the same origin as the client, so the stricter
    // cross-origin isolation headers buy nothing and complicate OAuth redirects.
    crossOriginEmbedderPolicy: false,
  });
}
