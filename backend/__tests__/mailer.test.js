import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { buildEnvelope, buildPasswordResetMessage, sendViaResend } from '../src/utils/mailer.js';

/**
 * Two bugs in the password-reset email, both pinned here.
 *
 * Neither was reachable from the existing tests: `sendMail` short-circuits
 * to a console line whenever no SMTP transport exists, which is always the
 * case under NODE_ENV=test. Both bugs lived in what *would* have been handed
 * to a transport, so the two decisions are now pure exported functions and
 * asserted directly.
 */

describe('buildEnvelope', () => {
  const from = 'HappyShelf <app@example.com>';

  test('broadcast mail BCCs its recipients', () => {
    // Household stock alerts: members must not see each other's addresses.
    const envelope = buildEnvelope({ from, recipients: ['a@example.com', 'b@example.com'] });
    assert.deepEqual(envelope.bcc, ['a@example.com', 'b@example.com']);
    assert.equal(envelope.to, from);
  });

  test('direct mail addresses the recipient and copies nobody', () => {
    const envelope = buildEnvelope({ from, recipients: ['user@example.com'], direct: true });
    assert.deepEqual(envelope.to, ['user@example.com']);
    assert.equal(envelope.bcc, undefined);
  });

  test('direct mail never makes the sender a recipient', () => {
    // The regression. The BCC form sets `to: from` to keep a valid To
    // header, which made the sending account a real envelope recipient — so
    // the app's own mailbox received a copy of every password-reset email,
    // each carrying a working reset link for someone else's account.
    const envelope = buildEnvelope({ from, recipients: ['user@example.com'], direct: true });
    const everyRecipient = [envelope.to, envelope.bcc].flat().filter(Boolean);
    assert.ok(
      !everyRecipient.some((r) => String(r).includes('app@example.com')),
      'the sending address must not receive a copy of a direct message'
    );
  });
});

describe('sendViaResend', () => {
  // Render's free web services block outbound SMTP (25/465/587) as of
  // September 2025, so this HTTPS path is the delivery mechanism there.
  // fetch is stubbed rather than hitting the real API — same reasoning
  // getTransporter() uses to refuse a live SMTP connection under
  // NODE_ENV=test, just applied to this transport instead.
  let originalFetch;
  let calls;

  beforeEach(() => {
    originalFetch = global.fetch;
    calls = [];
  });

  afterEach(() => {
    global.fetch = originalFetch;
    delete process.env.RESEND_API_KEY;
  });

  function stubFetch(response) {
    global.fetch = async (url, init) => {
      calls.push({ url, init });
      return response;
    };
  }

  test('posts to the Resend API with the bearer token and JSON envelope', async () => {
    process.env.RESEND_API_KEY = 'test-resend-key';
    stubFetch({ ok: true });

    await sendViaResend({
      from: 'HappyShelf <onboarding@resend.dev>',
      to: ['user@example.com'],
      subject: 'Reset your HappyShelf password',
      text: 'body',
      html: '<p>body</p>',
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://api.resend.com/emails');
    assert.equal(calls[0].init.method, 'POST');
    assert.equal(calls[0].init.headers.Authorization, 'Bearer test-resend-key');
    assert.equal(calls[0].init.headers['Content-Type'], 'application/json');

    const body = JSON.parse(calls[0].init.body);
    assert.deepEqual(body.to, ['user@example.com']);
    assert.equal(body.from, 'HappyShelf <onboarding@resend.dev>');
    assert.equal(body.subject, 'Reset your HappyShelf password');
  });

  test('throws on a non-ok response, including the status and body', async () => {
    // Caught by sendMail's caller exactly like a failed SMTP send — this
    // only has to signal failure clearly, not handle it itself. A 403 here
    // is what Resend returns for a recipient other than the account's own
    // signup address when no domain is verified.
    process.env.RESEND_API_KEY = 'test-resend-key';
    stubFetch({
      ok: false,
      status: 403,
      text: async () => JSON.stringify({ message: 'not verified' }),
    });

    await assert.rejects(
      () => sendViaResend({ from: 'a@example.com', to: ['b@example.com'], subject: 'x' }),
      /403/
    );
  });

  test('does not swallow a network failure either', async () => {
    process.env.RESEND_API_KEY = 'test-resend-key';
    global.fetch = async () => {
      throw new Error('getaddrinfo ENOTFOUND api.resend.com');
    };

    await assert.rejects(
      () => sendViaResend({ from: 'a@example.com', to: ['b@example.com'], subject: 'x' }),
      /ENOTFOUND/
    );
  });
});

describe('buildPasswordResetMessage', () => {
  const recipient = { email: 'user@example.com', name: 'Jane' };
  const rawToken = 'a'.repeat(64);

  test('links to the reset route with the token in the query string', () => {
    const { link } = buildPasswordResetMessage(recipient, rawToken);
    assert.ok(link.includes('/#/reset-password?token='), `unexpected link: ${link}`);
    assert.ok(link.endsWith(rawToken));
  });

  test('honours APP_URL and strips a trailing slash', () => {
    const previous = process.env.APP_URL;
    process.env.APP_URL = 'https://shelf.example.com/';
    try {
      const { link } = buildPasswordResetMessage(recipient, rawToken);
      assert.ok(link.startsWith('https://shelf.example.com/#/reset-password?token='), link);
      assert.ok(!link.includes('//#/'), 'the trailing slash must not double up');
    } finally {
      if (previous === undefined) delete process.env.APP_URL;
      else process.env.APP_URL = previous;
    }
  });

  test('includes an HTML anchor carrying the whole link', () => {
    // The second regression. The URL is long (base + a 64-char token), and
    // quoted-printable soft-wraps plain text at 76 columns — putting a line
    // break mid-token. Correct clients rejoin it; ones that auto-linkify the
    // raw text often truncate at the wrap and produce a dead link. A real
    // anchor sidesteps that, so its href must be complete.
    const { html, link } = buildPasswordResetMessage(recipient, rawToken);
    const href = (html.match(/href="([^"]+)"/) || [])[1];
    assert.ok(href, 'expected an anchor in the HTML body');
    assert.equal(href, link);
    assert.ok(href.includes(rawToken), 'the href must carry the full token');
  });

  test('keeps the plain-text link as a fallback', () => {
    const { text, link } = buildPasswordResetMessage(recipient, rawToken);
    assert.ok(text.includes(link));
  });

  test('escapes interpolated values so a name cannot inject markup', () => {
    const { html } = buildPasswordResetMessage(
      { email: 'x@example.com', name: '<script>alert(1)</script>' },
      rawToken
    );
    assert.ok(!html.includes('<script>'), 'the name must be escaped');
    assert.ok(html.includes('&lt;script&gt;'));
  });

  test('works without a name', () => {
    const { text } = buildPasswordResetMessage({ email: 'x@example.com' }, rawToken);
    assert.ok(text.startsWith('Hi,'));
  });

  test('states the expiry window', () => {
    const { text } = buildPasswordResetMessage(recipient, rawToken);
    assert.match(text, /expires in 30 minutes/);
  });

  test('never contains a password or a hash of the token', () => {
    const { text, html } = buildPasswordResetMessage(recipient, rawToken);
    // The raw token is meant to be here — nothing else secret is.
    for (const body of [text, html]) {
      assert.ok(!/password_hash|token_hash/.test(body));
    }
  });
});
