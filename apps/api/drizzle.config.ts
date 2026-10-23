import { defineConfig } from 'drizzle-kit';

// Génère les migrations SQL à partir du schéma (aucune connexion nécessaire).
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
});
