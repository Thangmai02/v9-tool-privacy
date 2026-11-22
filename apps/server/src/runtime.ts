import type { SystemStatus } from '../../../packages/shared/src/index.js';
import type { Queryable } from './db.js';

export const REQUIRED_SCHEMA_VERSION = 2;
export const WORKER_HEARTBEAT_SECONDS = 15;
export const WORKER_ONLINE_SECONDS = 60;

const unavailable = (): SystemStatus => ({
  databaseReady: false, schemaVersion: null, workerOnline: false,
  workerInstances: 0, workerLastSeenAt: null
});

/** Public operational metadata only; never include connection strings, worker IDs, or tokens. */
export async function getSystemStatus(db: Queryable): Promise<SystemStatus> {
  try {
    const schema = (await db.query<{ version: number | null; complete: boolean }>(`SELECT
      (SELECT max(version)::integer FROM schema_migrations) AS version,
      (SELECT bool_and(to_regclass(table_name) IS NOT NULL) FROM unnest(ARRAY[
        'app_users','workspaces','sessions','oauth_states','pages','campaigns','jobs',
        'page_lanes','audit_events','deletion_receipts','worker_heartbeats'
      ]) AS required_tables(table_name)) AS complete`)).rows[0];
    if (!schema || !schema.complete || schema.version === null || schema.version < REQUIRED_SCHEMA_VERSION) {
      return { ...unavailable(), schemaVersion: schema?.version ?? null };
    }
    const workers = (await db.query<{ active: number; last_seen: Date | string | null }>(`SELECT
      count(*) FILTER (WHERE last_seen >= now()-($1*interval '1 second'))::integer AS active,
      max(last_seen) AS last_seen FROM worker_heartbeats`, [WORKER_ONLINE_SECONDS])).rows[0]!;
    return {
      databaseReady: true, schemaVersion: schema.version,
      workerOnline: workers.active > 0, workerInstances: workers.active,
      workerLastSeenAt: workers.last_seen ? new Date(workers.last_seen).toISOString() : null
    };
  } catch {
    // Health/status must remain safe to return before migrations or during DB outages.
    return unavailable();
  }
}

export async function recordWorkerHeartbeat(db: Queryable, workerId: string, concurrency: number): Promise<void> {
  await db.query(`INSERT INTO worker_heartbeats(worker_id,concurrency,started_at,last_seen)
    VALUES($1,$2,now(),now()) ON CONFLICT(worker_id) DO UPDATE
    SET concurrency=excluded.concurrency,last_seen=now()`, [workerId, concurrency]);
}

export async function pruneWorkerHeartbeats(db: Queryable): Promise<void> {
  await db.query("DELETE FROM worker_heartbeats WHERE last_seen<now()-interval '1 day'");
}

export async function removeWorkerHeartbeat(db: Queryable, workerId: string): Promise<void> {
  await db.query('DELETE FROM worker_heartbeats WHERE worker_id=$1', [workerId]);
}
