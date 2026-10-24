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

export async function createMailer(env: Env, options: { verify?: boolean } = {}): Promise<Mailer> {
  if (env.MAIL_TRANSPORT === 'console') return new ConsoleMailer();
  const nodemailer = await import('nodemailer');
  const transport = nodemailer.createTransport(env.SMTP_URL!);
  if (options.verify) {
    // Prévenir dès le démarrage plutôt qu'au premier formateur qui ne reçoit rien.
    await transport.verify().then(
      () => console.info('[mail] serveur SMTP joignable.'),
      (err: Error) => console.error(`[mail] ⚠️ serveur SMTP injoignable (${err.message}) : les formateurs ne recevront pas leur lien.`),
    );
  }
  return {
    async send(mail) {
      await transport.sendMail({ from: env.MAIL_FROM, ...mail });
    },
  };
}
