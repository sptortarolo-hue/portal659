import { Pool, QueryResultRow } from "pg";

declare global {
  // eslint-disable-next-line no-var
  var __dbPool: Pool | undefined;
}

function getEnv() {
  return (process.env.DATABASE_URL || "").trim();
}

/**
 * Pool global de conexiones a Postgres.
 * Se cachea entre hot-reloads (Next dev) para no agotar conexiones.
 */
export function getPool(): Pool {
  const url = getEnv();
  if (!url) throw new Error("DATABASE_URL no está configurado");
  if (!global.__dbPool) {
    global.__dbPool = new Pool({
      connectionString: url,
      max: 10,
      // Cierra conexiones idle antes de que el NAT de docker las mate: sin esto
      // el pool reusaba sockets zombies y los requests quedaban colgados hasta
      // el timeout de TCP del kernel (causa del dashboard "tildado").
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 5000,
      keepAlive: true,
      keepAliveInitialDelayMillis: 10000,
    });
    // Las conexiones idle que fallan (ej. NAT murió) se descartan sin crashear.
    global.__dbPool.on("error", () => {});
  }
  return global.__dbPool;
}

/** Helper: query con un solo resultado. Devuelve undefined si no hay filas. */
export async function queryOne<T extends QueryResultRow>(
  sql: string,
  params: unknown[] = []
): Promise<T | undefined> {
  const { rows } = await getPool().query(sql, params);
  return rows[0] as T | undefined;
}

/** Helper: query con múltiples resultados. */
export async function queryMany<T extends QueryResultRow>(
  sql: string,
  params: unknown[] = []
): Promise<T[]> {
  const { rows } = await getPool().query(sql, params);
  return rows as T[];
}

/** Ejecuta un query sin esperar resultado (INSERT/UPDATE/DELETE). */
export async function query(sql: string, params: unknown[] = []): Promise<void> {
  await getPool().query(sql, params);
}

export type Tx = {
  query: <T extends QueryResultRow>(sql: string, params?: unknown[]) => Promise<T[]>;
  queryOne: <T extends QueryResultRow>(sql: string, params?: unknown[]) => Promise<T | undefined>;
  queryVoid: (sql: string, params?: unknown[]) => Promise<void>;
};

/** Transacción: ejecuta callback y hace rollback si falla. */
export async function withTransaction<T>(
  callback: (tx: Tx) => Promise<T>
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const tx: Tx = {
      async query<T extends QueryResultRow>(qs: string, params: unknown[] = []) {
        const r = await client.query<T>(qs, params as any[]);
        return r.rows;
      },
      async queryOne<T extends QueryResultRow>(qs: string, params: unknown[] = []) {
        const r = await client.query<T>(qs, params as any[]);
        return r.rows[0] as T | undefined;
      },
      async queryVoid(qs: string, params: unknown[] = []) {
        await client.query(qs, params);
      },
    };
    const result = await callback(tx);
    await client.query("COMMIT");
    return result;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}