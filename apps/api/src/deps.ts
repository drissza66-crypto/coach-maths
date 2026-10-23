import type { Env } from './config/env.js';
import type { Db } from './db/client.js';
import type { User } from './db/schema.js';
import type { Mailer } from './mail/mailer.js';

export interface AppDeps {
  db: Db;
  env: Env;
  mailer: Mailer;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: User;
      sessionId?: string;
    }
  }
}
