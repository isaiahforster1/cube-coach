import type { EmailMessage, EmailSender } from '../modules/email/email-sender.js';

export interface FakeEmailSender extends EmailSender {
  /** Every message sent, oldest first. */
  readonly sent: EmailMessage[];
  /** Make every later send fail, as a provider outage would. */
  failFromNowOn(): void;
}

/**
 * Stands in for the email provider in every test, so no test sends real mail or needs a
 * key, and each can read back exactly what would have been sent.
 */
export function createFakeEmailSender(): FakeEmailSender {
  const sent: EmailMessage[] = [];
  let failing = false;

  return {
    sent,
    failFromNowOn() {
      failing = true;
    },
    send(message: EmailMessage): Promise<void> {
      if (failing) return Promise.reject(new Error('The fake provider is down'));
      sent.push(message);
      return Promise.resolve();
    },
  };
}
