import { pathToFileURL } from 'node:url';
import { loadConfig } from './config.js';
import { makeDatabase, transaction, type Database } from './db.js';
import { schemaSql } from './schema.js';
export async function migrate(db: Database): Promise<void> {
  await transaction(db, async client => {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('v9:migrations',0))");
    await client.query(schemaSql);
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const db = makeDatabase(loadConfig().DATABASE_URL);
  try { await migrate(db); console.log('Database migration completed.'); }
  finally { await db.end?.(); }
}
