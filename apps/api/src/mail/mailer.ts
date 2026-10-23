import type { Env } from '../config/env.js';

export interface Mail {
  to: string;
  subject: string;
  text: string;
}

export interface Mailer {
  send(mail: Mail): Promise<void>;
}

/** Développement : le mail s'affiche dans le terminal de l'API. */
export class ConsoleMailer implements Mailer {
  public sent: Mail[] = [];
  constructor(private quiet = false) {}
  async send(mail: Mail) {
    this.sent.push(mail);
    if (!this.quiet) console.info(`\n[mail] À : ${mail.to}\n[mail] Objet : ${mail.subject}\n${mail.text}\n`);
  }
}

export async function createMailer(env: Env): Promise<Mailer> {
  if (env.MAIL_TRANSPORT === 'console') return new ConsoleMailer();
  const nodemailer = await import('nodemailer');
  const transport = nodemailer.createTransport(env.SMTP_URL!);
  return {
    async send(mail) {
      await transport.sendMail({ from: env.MAIL_FROM, ...mail });
    },
  };
}
