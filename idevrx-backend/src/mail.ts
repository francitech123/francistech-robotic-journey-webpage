import nodemailer from "nodemailer";
import { config } from "./config.js";

const transport = config.SMTP_URL ? nodemailer.createTransport(config.SMTP_URL) : null;

export async function sendMail(m: { to: string; subject: string; text: string }) {
  if (!transport) {
    // No SMTP configured (local development): print the email so links can be copied from the log.
    console.log(`\n[mail] To: ${m.to}\n[mail] Subject: ${m.subject}\n${m.text}\n`);
    return;
  }
  await transport.sendMail({ from: config.MAIL_FROM, ...m });
}
