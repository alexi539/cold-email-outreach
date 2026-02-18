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
  const transporter = nodemailer.createTransport({
    host: smtpHost,
    port: 465,
    secure: true,
    auth: {
      user: account.email,
      pass: password,
    },
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

  const info = await transporter.sendMail(mailOptions);

  const messageId = info.messageId ?? undefined;
  logger.info("Zoho sent", { to, messageId });
  return { messageId };
}
