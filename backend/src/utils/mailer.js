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

// Never throws — a bad SMTP config or a transient send failure should log,
// not take down the inventory action (consume/update/create) that triggered
// the notification.
export async function sendMail({ to, subject, text, html }) {
  const recipients = Array.isArray(to) ? to.filter(Boolean) : [to].filter(Boolean);
  if (recipients.length === 0) return;

  const t = getTransporter();
  if (!t) {
    console.log(`[email:dev] Would send "${subject}" to ${recipients.join(', ')}`);
    return;
  }

  const from = process.env.EMAIL_FROM || process.env.SMTP_USER;

  try {
    // Recipients go in `bcc`, not `to`. Joining them into a visible `to`
    // header disclosed every household member's address to everyone else on
    // the team — including members who were only ever added by an Admin and
    // never consented to sharing it. `to` is set to the sending address so
    // the message still has a valid, non-empty To header.
    await t.sendMail({
      from,
      to: from,
      bcc: recipients,
      subject,
      text,
      html,
    });
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

/**
 * The password reset link.
 *
 * The raw token appears here and nowhere else — it is not logged, not
 * persisted, and not echoed in any API response. Sent to a single recipient
 * with no BCC, since only the account owner should ever see it.
 */
export async function sendPasswordResetEmail(recipient, rawToken) {
  if (!recipient?.email) return;

  const base = (process.env.APP_URL || 'http://localhost:5173').replace(/\/+$/, '');
  const link = `${base}/#/reset-password?token=${encodeURIComponent(rawToken)}`;
  const minutes = Number(process.env.PASSWORD_RESET_TTL_MINUTES) || 30;

  const lines = [
    `Hi${recipient.name ? ' ' + recipient.name : ''},`,
    '',
    'Someone asked to reset the password for your HappyShelf account.',
    'Open the link below to choose a new one:',
    '',
    link,
    '',
    `The link expires in ${minutes} minutes and can only be used once.`,
    "If this wasn't you, ignore this email — your password stays as it is.",
  ];

  await sendMail({
    to: recipient.email,
    subject: 'Reset your HappyShelf password',
    text: lines.join('\n'),
  });
}
