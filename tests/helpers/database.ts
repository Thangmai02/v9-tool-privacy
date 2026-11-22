import { PGlite } from '@electric-sql/pglite';
import type { Database, DbClient } from '../../apps/server/src/db.js';
import { schemaSql } from '../../apps/server/src/schema.js';

/** In-memory PostgreSQL for deterministic SQL tests, not a multi-process lock test. */
export async function testDatabase(): Promise<Database & { close(): Promise<void> }> {
  const pg = new PGlite();
  await pg.exec(schemaSql);
  const query = async (sql: string, params: any[] = []) => {
    const result = await pg.query(sql, params);
    return { rows: result.rows as any[], rowCount: result.affectedRows ?? result.rows.length };
  };
  const client: DbClient = { query, release() {} };
  return { query, async connect() { return client; }, async close() { await pg.close(); } };
}
