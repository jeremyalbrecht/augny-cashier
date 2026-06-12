import nodemailer, { type Transporter } from "nodemailer";

const FROM_NAME = "Augny Badminton";

let cachedTransport: Transporter | null = null;

function getTransport(user: string, password: string): Transporter {
  // Cache the transporter so we don't reconnect for every email in a batch.
  // The runtime config is stable for the process lifetime, so caching by
  // process is safe.
  if (cachedTransport) return cachedTransport;
  cachedTransport = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: { user, pass: password },
  });
  return cachedTransport;
}

export interface MailerCreds {
  user: string;
  password: string;
}

export async function sendHtmlEmail(
  creds: MailerCreds,
  to: string,
  subject: string,
  html: string,
): Promise<void> {
  if (!creds.user || !creds.password) {
    throw new Error("SMTP not configured (set NUXT_SMTP_USER and NUXT_SMTP_PASSWORD)");
  }
  const transport = getTransport(creds.user, creds.password);
  await transport.sendMail({
    from: `"${FROM_NAME}" <${creds.user}>`,
    to,
    subject,
    html,
  });
}
