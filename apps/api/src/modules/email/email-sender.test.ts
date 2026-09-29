import { describe, expect, it, vi } from 'vitest';
import { createResendEmailSender, type EmailMessage } from './email-sender.js';

const MESSAGE: EmailMessage = {
  to: 'cuber@example.com',
  subject: 'Confirm your email',
  text: 'Follow this link',
  html: '<p>Follow this link</p>',
};

const CONFIG = { apiKey: 're_test_key', from: 'CubeCoach <verify@mail.example.com>' };

function respondWith(status: number, body: unknown = {}) {
  return vi.fn<typeof fetch>().mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  );
}

describe('the Resend sender', () => {
  it('posts the message to Resend with the API key as a bearer token', async () => {
    const httpFetch = respondWith(200, { id: 'email-1' });

    await createResendEmailSender(CONFIG, httpFetch).send(MESSAGE);

    expect(httpFetch).toHaveBeenCalledOnce();
    const [url, init] = httpFetch.mock.calls[0]!;
    expect(url).toBe('https://api.resend.com/emails');
    expect(init?.method).toBe('POST');
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer re_test_key');
    expect(JSON.parse(init?.body as string)).toEqual({
      from: CONFIG.from,
      to: ['cuber@example.com'],
      subject: MESSAGE.subject,
      text: MESSAGE.text,
      html: MESSAGE.html,
    });
  });

  /** A hung provider must not hang the request that is waiting on it. */
  it('gives up rather than waiting forever', async () => {
    const httpFetch = respondWith(200);

    await createResendEmailSender(CONFIG, httpFetch).send(MESSAGE);

    expect(httpFetch.mock.calls[0]![1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it('fails when Resend refuses, without repeating the key or the recipient', async () => {
    const httpFetch = respondWith(403, { message: 'API key is invalid' });

    const sending = createResendEmailSender(CONFIG, httpFetch).send(MESSAGE);

    await expect(sending).rejects.toThrow(/403/u);
    await sending.catch((error: Error) => {
      expect(error.message).not.toContain('re_test_key');
      expect(error.message).not.toContain('cuber@example.com');
    });
  });
});
