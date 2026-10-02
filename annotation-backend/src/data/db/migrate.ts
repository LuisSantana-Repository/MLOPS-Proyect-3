import { migrate } from 'drizzle-orm/mysql2/migrator';
import { db, pool } from './client.js';

try {
  await migrate(db, { migrationsFolder: './src/data/db/migrations' });
  console.log('[migrate] Migraciones aplicadas correctamente.');
} catch (error) {
  console.error('[migrate] No se pudieron aplicar las migraciones.', error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
