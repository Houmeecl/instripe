import { readFileSync } from "node:fs";
import { Pool, type PoolClient, type PoolConfig, type QueryResultRow } from "pg";

export interface PostgresStoreConfig {
  connectionString: string;
  caCertificatePath: string;
  maxConnections?: number;
}

type QueryExecutor = Pick<Pool, "query"> | Pick<PoolClient, "query">;

export class PostgresPlatformStore {
  private readonly pool: Pool | undefined;

  private constructor(
    private readonly executor: QueryExecutor,
    pool?: Pool,
  ) {
    this.pool = pool;
  }

  static async connect(config: PostgresStoreConfig): Promise<PostgresPlatformStore> {
    if (!config.connectionString.trim()) throw new Error("DATABASE_URL must be configured");
    if (!config.caCertificatePath.trim()) throw new Error("DATABASE_TLS_CA_FILE must be configured");

    const ca = readFileSync(config.caCertificatePath, "utf8");
    const pool = new Pool({
      connectionString: config.connectionString,
      max: config.maxConnections ?? 10,
      ssl: { ca, rejectUnauthorized: true },
      application_name: "instripe",
    } satisfies PoolConfig);

    try {
      await pool.query("SELECT 1");
      return new PostgresPlatformStore(pool, pool);
    } catch (error) {
      await pool.end();
      throw error;
    }
  }

  async put(collection: string, id: string, body: unknown): Promise<void> {
    await this.executor.query(
      `INSERT INTO records (collection, id, body) VALUES ($1, $2, $3::jsonb)
       ON CONFLICT (collection, id) DO UPDATE SET body = EXCLUDED.body`,
      [collection, id, JSON.stringify(body)],
    );
  }

  async delete(collection: string, id: string): Promise<void> {
    await this.executor.query("DELETE FROM records WHERE collection = $1 AND id = $2", [collection, id]);
  }

  async get<T>(collection: string, id: string): Promise<T | undefined> {
    const result = await this.executor.query<QueryResultRow & { body: T }>(
      "SELECT body FROM records WHERE collection = $1 AND id = $2",
      [collection, id],
    );
    return result.rows[0]?.body;
  }

  async list<T>(collection: string): Promise<T[]> {
    const result = await this.executor.query<QueryResultRow & { body: T }>(
      "SELECT body FROM records WHERE collection = $1 ORDER BY position",
      [collection],
    );
    return result.rows.map((row) => row.body);
  }

  async transaction(run: (store: PostgresPlatformStore) => Promise<void>): Promise<void> {
    if (!this.pool) throw new Error("Nested PostgreSQL transactions are not supported");
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await run(new PostgresPlatformStore(client));
      await client.query("COMMIT");
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        throw new AggregateError([error, rollbackError], "PostgreSQL transaction and rollback both failed");
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    if (this.pool) await this.pool.end();
  }
}
