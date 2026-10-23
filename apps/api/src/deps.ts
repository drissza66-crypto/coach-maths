import type { Env } from './config/env.js';
import type { Db } from './db/client.js';
import type { User } from './db/schema.js';
import type { ResilientProvider } from './llm/resilient.js';
import type { Mailer } from './mail/mailer.js';
import type { EncryptedStore } from './storage/encrypted-store.js';

export interface AppDeps {
  db: Db;
  env: Env;
  mailer: Mailer;
  llm: ResilientProvider;
  files: EncryptedStore;
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
