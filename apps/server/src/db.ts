import pg from 'pg';
import type { QueryResultRow } from 'pg';

export interface DbResult<T> { rows: T[]; rowCount: number | null; }
export interface Queryable { query<T extends QueryResultRow = any>(sql: string, values?: any[]): Promise<DbResult<T>>; }
export interface DbClient extends Queryable { release(error?: Error | boolean): void; }
export interface Database extends Queryable { connect(): Promise<DbClient>; end?(): Promise<void>; }
export function makeDatabase(url: string, max = 12): Database {
  return new pg.Pool({ connectionString: url, max, connectionTimeoutMillis: 10_000, idleTimeoutMillis: 30_000 });
}
export async function transaction<T>(db: Database, action: (client: DbClient) => Promise<T>): Promise<T> {
  const client = await db.connect();
  let broken = false;
  try { await client.query('BEGIN'); const value = await action(client); await client.query('COMMIT'); return value; }
  catch (error) { try { await client.query('ROLLBACK'); } catch { broken = true; } throw error; }
  finally { client.release(broken); }
}
