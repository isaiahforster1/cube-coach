import type { FastifyBaseLogger } from 'fastify';

export interface EmailMessage {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly html: string;
}

/**
 * Everything the application knows about sending email.
 *
 * An interface so the provider is a detail: Resend in production, a logger in
 * development, a fake that records messages in tests. Changing provider means writing one
 * more implementation of `send`, and nothing that sends mail has to change.
 */
export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}

export interface ResendConfig {
  readonly apiKey: string;
  /** A verified sender on a domain set up in Resend, such as `CubeCoach <verify@…>`. */
  readonly from: string;
}

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

/** Long enough for a slow provider, short enough that a hung one fails the request. */
const SEND_TIMEOUT_MS = 10_000;

/**
 * Send through Resend's HTTP API.
 *
 * One JSON POST, so it needs no SDK. `fetch` is injectable so it can be tested without a
 * network or a real key, the same way the Google exchange is.
 */
export function createResendEmailSender(
  config: ResendConfig,
  httpFetch: typeof fetch = fetch,
): EmailSender {
  return {
    async send(message: EmailMessage): Promise<void> {
      const response = await httpFetch(RESEND_ENDPOINT, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${config.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          from: config.from,
          to: [message.to],
          subject: message.subject,
          text: message.text,
          html: message.html,
        }),
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      });

      if (!response.ok) {
        // The status only. The error is logged, and logs should hold neither the key nor
        // who the message was for.
        throw new Error(`Resend refused the message (${response.status})`);
      }
    },
  };
}

/**
 * Development only: write the message to the log instead of sending it, so the link can
 * be copied from the terminal without an email account.
 *
 * Never used in production, where the log is shipped and kept, and a verification link
 * in it would be a credential sitting in plain text.
 */
export function createLogEmailSender(log: FastifyBaseLogger): EmailSender {
  return {
    send(message: EmailMessage): Promise<void> {
      log.info({ to: message.to, subject: message.subject }, `Email not sent:\n${message.text}`);
      return Promise.resolve();
    },
  };
}
