import nodemailer from 'nodemailer';

let transporter;
let warnedMissingConfig = false;

// Lazily built so a missing SMTP config doesn't crash the app at startup —
// it just means sendMail() falls back to logging instead of sending, the
// same graceful-degradation pattern used for the DB and ML service elsewhere
// in this backend.
function getTransporter() {
  if (transporter !== undefined) return transporter;

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

  try {
    await t.sendMail({
      from: process.env.EMAIL_FROM || process.env.SMTP_USER,
      to: recipients.join(','),
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
