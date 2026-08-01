import nodemailer from 'nodemailer';

let transporter;
let warnedMissingConfig = false;

// Lazily built so a missing SMTP config doesn't crash the app at startup —
// it just means sendMail() falls back to logging instead of sending, the
// same graceful-degradation pattern used for the DB and ML service elsewhere
// in this backend.
function getTransporter() {
  if (transporter !== undefined) return transporter;

  // Never open a real SMTP connection from any test context. A developer's
  // .env usually holds working credentials, so without this every test that
  // nudges an item into low stock — or, now, every password-reset test,
  // which sends mail on every single run — would attempt an actual send:
  // slow, and it delivers real mail to whoever is in the fixture.
  //
  // Both values, not just 'test': playwright.config.ts runs the E2E backend
  // under NODE_ENV=test-e2e specifically so it's distinguishable from the
  // unit-test backend (different in-memory store lifecycle), but it is still
  // a test context and must be guarded here the same way.
  if (process.env.NODE_ENV === 'test' || process.env.NODE_ENV === 'test-e2e') {
    transporter = null;
    return transporter;
  }

  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    if (!warnedMissingConfig) {
      console.warn('Email not configured (SMTP_HOST/SMTP_USER/SMTP_PASS missing) — notifications will be logged only.');
      warnedMissingConfig = true;
    }
    transporter = null;
    return transporter;
  }

  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT) || 587,
    secure: Number(SMTP_PORT) === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
  return transporter;
}

/**
 * Decides who a message is addressed to, and who is merely copied.
 *
 * Broadcast mail (stock alerts) BCCs its recipients: joining a household's
 * members into a visible `to` header disclosed every member's address to
 * everyone else on the team, including members an Admin added who never
 * consented to sharing it.
 *
 * That form is wrong for one-recipient, sensitive mail, because it sets
 * `to: from` to keep a valid To header — which made the sending account a
 * real envelope recipient. The app's own mailbox therefore received a copy
 * of every password-reset email, each carrying a working reset link for
 * somebody else's account. `direct` addresses the recipient properly and
 * copies nobody.
 *
 * Exported so both shapes are pinned by tests rather than only reachable
 * through a live SMTP connection.
 */
export function buildEnvelope({ from, recipients, direct = false }) {
  return direct ? { from, to: recipients } : { from, to: from, bcc: recipients };
}

// Never throws — a bad SMTP config or a transient send failure should log,
// not take down the inventory action (consume/update/create) that triggered
// the notification.
/**
 * @param {object} options
 * @param {string|string[]} options.to      Recipient(s).
 * @param {boolean} [options.direct=false]  Address the recipient in `to`
 *   rather than BCC-ing them. Required for anything only one person may
 *   ever see — see buildEnvelope.
 */
export async function sendMail({ to, subject, text, html, direct = false }) {
  const recipients = Array.isArray(to) ? to.filter(Boolean) : [to].filter(Boolean);
  if (recipients.length === 0) return;

  const t = getTransporter();
  if (!t) {
    console.log(`[email:dev] Would send "${subject}" to ${recipients.join(', ')}`);
    return;
  }

  const from = process.env.EMAIL_FROM || process.env.SMTP_USER;
  const envelope = buildEnvelope({ from, recipients, direct });

  try {
    await t.sendMail({ ...envelope, subject, text, html });
  } catch (error) {
    console.error('Failed to send email:', error.message);
  }
}

export async function sendStockAlert(recipients, item, status) {
  const emails = (recipients || []).map((r) => r.email).filter(Boolean);
  if (emails.length === 0) return;

  const label = status === 'out' ? 'is now OUT OF STOCK' : 'is running LOW on stock';
  const subject = `HappyShelf: ${item.name} ${label}`;
  const lines = [
    `${item.name} (${item.category}) ${label}.`,
    '',
    `Current quantity: ${item.quantity} ${item.unit}`,
  ];
  if (item.min_stock_level != null) {
    lines.push(`Minimum stock level: ${item.min_stock_level} ${item.unit}`);
  }
  lines.push('', 'Reorder it from your HappyShelf dashboard.');

  await sendMail({ to: emails, subject, text: lines.join('\n') });
}

/** Minimal HTML escape for values interpolated into the email body. */
function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * The password reset link.
 *
 * The raw token appears here and nowhere else — it is not logged, not
 * persisted, and not echoed in any API response. Sent `direct` so the
 * recipient is addressed in `to` and nobody is copied: the default BCC form
 * sets `to: from`, which made the sending account an envelope recipient of
 * every reset email — a working link for someone else's account landing in
 * the app owner's inbox.
 *
 * An HTML body is included because the link is long (base URL + a 64-char
 * token). Quoted-printable wraps plain text at 76 columns, so the URL gets a
 * soft line break inserted mid-token; correct clients rejoin it, but ones
 * that auto-linkify the raw text often truncate the link at the wrap and
 * produce a dead or partial URL. A real anchor sidesteps that entirely, and
 * the plain-text part stays as the fallback.
 */
export function buildPasswordResetMessage(recipient, rawToken) {
  const base = (process.env.APP_URL || 'http://localhost:5173').replace(/\/+$/, '');
  const link = `${base}/#/reset-password?token=${encodeURIComponent(rawToken)}`;
  const minutes = Number(process.env.PASSWORD_RESET_TTL_MINUTES) || 30;
  const greeting = `Hi${recipient.name ? ' ' + recipient.name : ''},`;

  const text = [
    greeting,
    '',
    'Someone asked to reset the password for your HappyShelf account.',
    'Open the link below to choose a new one:',
    '',
    link,
    '',
    `The link expires in ${minutes} minutes and can only be used once.`,
    "If this wasn't you, ignore this email — your password stays as it is.",
  ].join('\n');

  const safeLink = escapeHtml(link);
  const html = [
    `<p>${escapeHtml(greeting)}</p>`,
    '<p>Someone asked to reset the password for your HappyShelf account.</p>',
    `<p><a href="${safeLink}">Choose a new password</a></p>`,
    `<p>If the link above doesn't work, copy this address:<br>`,
    `<span style="word-break:break-all">${safeLink}</span></p>`,
    `<p>The link expires in ${minutes} minutes and can only be used once.<br>`,
    "If this wasn't you, ignore this email — your password stays as it is.</p>",
  ].join('\n');

  return { link, subject: 'Reset your HappyShelf password', text, html };
}

export async function sendPasswordResetEmail(recipient, rawToken) {
  if (!recipient?.email) return;

  const { subject, text, html } = buildPasswordResetMessage(recipient, rawToken);

  await sendMail({ to: recipient.email, subject, text, html, direct: true });
}
