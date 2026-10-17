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

/**
 * ¿Existe la tabla? Chequeo con to_regclass que nunca lanza: seguro de
 * correr DENTRO de una transacción (un SELECT sobre tabla inexistente
 * aborta la tx y toda query posterior falla con 25P02 — "transaction is
 * aborted"; el catch de JS se traga el error pero no des-envenena la tx).
 * Patrón correcto: preguntar primero, consultar después.
 * Acepta cualquier querier de solo lectura (Tx, PricingQuerier, pool).
 */
export async function hasTable(
  tx: { query: <T extends QueryResultRow>(sql: string, params?: unknown[]) => Promise<T[]> },
  name: string
): Promise<boolean> {
  const rows = await tx.query<{ ok: boolean }>(
    `SELECT to_regclass($1) IS NOT NULL AS ok`,
    [`public.${name}`]
  );
  return rows[0]?.ok === true;
}

/** ¿Existe la columna? information_schema nunca lanza; seguro dentro de tx. */
export async function hasColumn(
  tx: { query: <T extends QueryResultRow>(sql: string, params?: unknown[]) => Promise<T[]> },
  table: string,
  column: string
): Promise<boolean> {
  const rows = await tx.query<{ e: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2
     ) AS e`,
    [table, column]
  );
  return rows[0]?.e === true;
}

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