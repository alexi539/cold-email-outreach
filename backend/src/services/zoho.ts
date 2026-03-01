import nodemailer from "nodemailer";
import { getDecryptedPassword } from "../lib/accounts.js";
import { isHtml, stripHtml } from "../lib/emailBody.js";
import type { EmailAccount } from "@prisma/client";
import { logger } from "../lib/logger.js";

export async function sendZoho(
  account: EmailAccount,
  to: string,
  subject: string,
  body: string,
  opts?: { inReplyTo?: string; references?: string }
): Promise<{ messageId?: string }> {
  const password = getDecryptedPassword(account);
  if (!password) {
    throw new Error("No SMTP password for account " + account.email);
  }

  const smtpHost = account.zohoProServers ? "smtppro.zoho.com" : "smtp.zoho.com";
  // Port 587 (STARTTLS) often works better from cloud providers than 465 (SSL)
  const transporter = nodemailer.createTransport({
    host: smtpHost,
    port: 587,
    secure: false,
    auth: {
      user: account.email,
      pass: password,
    },
    connectionTimeout: 60_000,
    greetingTimeout: 20_000,
  });

  const mailOptions: nodemailer.SendMailOptions = {
    from: account.displayName ? `"${account.displayName}" <${account.email}>` : account.email,
    to,
    subject,
    text: isHtml(body) ? stripHtml(body) : body,
    html: isHtml(body) ? body : undefined,
  };
  if (opts?.inReplyTo) mailOptions.inReplyTo = opts.inReplyTo;
  if (opts?.references) mailOptions.references = opts.references;

  logger.info("Zoho SMTP send", { to, host: smtpHost, port: 587 });
  const info = await transporter.sendMail(mailOptions);

  const messageId = info.messageId ?? undefined;
  logger.info("Zoho sent", { to, messageId });
  return { messageId };
}
