import nodemailer, { type Transporter } from "nodemailer";
import { ImapFlow } from "imapflow";

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

// Gmail's SMTP server files a copy of every message it sends into that
// account's own Sent folder — this is server-side Gmail behaviour, nothing
// nodemailer or an SMTP header can turn off. The account here is a personal
// Gmail app-password login, not a dedicated transactional-mail service, so
// after every send we reach back over IMAP and move that copy out of Sent
// (into Trash, where Gmail auto-purges it after 30 days) so it doesn't pile
// up in the sender's own mailbox.
//
// Best-effort throughout: this is cleanup of a side effect, not the actual
// job of the function. A failure here must never surface as a failed send —
// the e-mail already went out.
let cachedImap: ImapFlow | null = null;

async function getImap(user: string, password: string): Promise<ImapFlow> {
  if (cachedImap?.usable) return cachedImap;
  const client = new ImapFlow({
    host: "imap.gmail.com",
    port: 993,
    secure: true,
    auth: { user, pass: password },
    logger: false,
  });
  await client.connect();
  cachedImap = client;
  return client;
}

async function deleteFromSent(creds: MailerCreds, messageId: string): Promise<void> {
  try {
    const client = await getImap(creds.user, creds.password);
    // Locate the Sent mailbox by its special-use flag rather than a hardcoded
    // name — Gmail localises "[Gmail]/Sent Mail" per the account's language.
    const mailboxes = await client.list();
    const sent = mailboxes.find((m) => m.specialUse === "\\Sent");
    if (!sent) return;

    const lock = await client.getMailboxLock(sent.path);
    try {
      const uid = await client.search({ header: { "message-id": messageId } }, { uid: true });
      if (!uid || uid.length === 0) return;
      const trash = mailboxes.find((m) => m.specialUse === "\\Trash");
      if (!trash) return;
      await client.messageMove(uid, trash.path, { uid: true });
    } finally {
      lock.release();
    }
  } catch (e) {
    console.error("[mailer] failed to remove sent copy from Sent folder:", e);
  }
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
  const info = await transport.sendMail({
    from: `"${FROM_NAME}" <${creds.user}>`,
    to,
    subject,
    html,
  });
  await deleteFromSent(creds, info.messageId);
}
