/**
 * Optional SMTP delivery for the super-admin sign-in code.
 * When SMTP_HOST and SMTP_FROM are unset, callers use the local on-screen code instead.
 */

export function isEmailDeliveryConfigured(): boolean {
  return Boolean(process.env.SMTP_HOST?.trim() && process.env.SMTP_FROM?.trim());
}

export async function sendEmail(to: string, subject: string, text: string): Promise<boolean> {
  if (!isEmailDeliveryConfigured()) return false;
  try {
    const loader = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<any>;
    const nodemailer = await loader('nodemailer');
    const transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: String(process.env.SMTP_SECURE || '').toLowerCase() === 'true' || process.env.SMTP_PORT === '465',
      auth: process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD || '' }
        : undefined,
    });
    await transport.sendMail({
      from: process.env.SMTP_FROM,
      to,
      subject,
      text,
    });
    return true;
  } catch (error) {
    console.error('sendEmail failed:', (error as Error).message);
    return false;
  }
}
