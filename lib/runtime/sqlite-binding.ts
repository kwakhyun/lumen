import { createClient, type Client, type InValue, type ResultSet } from '@libsql/client/http';

/** Prepared SQLite statements shared by Drizzle and the raw SQL call sites. */
export type SqliteDatabase = Pick<D1Database, 'prepare' | 'batch' | 'exec'>;
function argument(value: unknown): InValue {
  // Hosted libSQL may truncate NUL-bearing TEXT on read. Reject it before a
  // write rather than returning silently shortened records. JSON-escaped text is safe.
  if (typeof value === 'string' && value.includes('\0')) throw new TypeError('SQLite text cannot contain NUL characters.');
  if (value === null || typeof value === 'string' || typeof value === 'bigint') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'boolean') return Number(value);
  if (value instanceof ArrayBuffer || value instanceof Uint8Array) return value;
  throw new TypeError('Unsupported SQLite bound value.');
}
function result<T>(value: ResultSet): D1Result<T> {
  return { success: true, results: value.rows.map(row => Object.fromEntries(value.columns.map((column, i) => [column, row[i]]))) as T[], meta: { changes: value.rowsAffected, last_row_id: Number(value.lastInsertRowid ?? 0), changed_db: value.rowsAffected > 0, duration: 0, size_after: 0, rows_read: value.rows.length, rows_written: value.rowsAffected } };
}
class Statement implements D1PreparedStatement {
  readonly client: Client;
  readonly sql: string;
  readonly args: InValue[];
  constructor(client: Client, sql: string, args: InValue[] = []) { this.client = client; this.sql = sql; this.args = args; }
  bind(...values: unknown[]): Statement { return new Statement(this.client, this.sql, values.map(argument)); }
  async all<T = Record<string, unknown>>(): Promise<D1Result<T>> { return result<T>(await this.client.execute({ sql: this.sql, args: this.args })); }
  run<T = Record<string, unknown>>(): Promise<D1Result<T>> { return this.all<T>(); }
  async first<T = Record<string, unknown>>(column?: string): Promise<T | null> {
    const row = (await this.all<Record<string, unknown>>()).results[0];
    if (!row) return null;
    if (column !== undefined && !(column in row)) throw new Error('Unknown result column.');
    return (column !== undefined ? row[column] : row) as T;
  }
  raw<T = unknown[]>(options: { columnNames: true }): Promise<[string[], ...T[]]>;
  raw<T = unknown[]>(options?: { columnNames?: false }): Promise<T[]>;
  async raw<T = unknown[]>(options?: { columnNames?: boolean }): Promise<T[] | [string[], ...T[]]> {
    const value = await this.client.execute({ sql: this.sql, args: this.args });
    const rows = value.rows.map(row => value.columns.map((_, i) => row[i])) as T[];
    return options?.columnNames ? [value.columns, ...rows] : rows;
  }
}
export function createSqliteBinding(client: Client): SqliteDatabase {
  return {
    prepare(sql) { return new Statement(client, sql); },
    async batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
      const queries = statements.map(statement => {
        if (!(statement instanceof Statement) || statement.client !== client) throw new Error('A transaction must use statements from the same database.');
        return { sql: statement.sql, args: statement.args };
      });
      // BEGIN IMMEDIATE preserves the existing atomic budget/lease semantics.
      return (await client.batch(queries, 'write')).map(value => result<T>(value));
    },
    async exec(sql) { const start = performance.now(); await client.executeMultiple(sql); return { count: 1, duration: performance.now() - start }; },
  };
}
let binding: SqliteDatabase | undefined;
export function getSqliteBinding(): SqliteDatabase | undefined {
  if (binding) return binding;
  const url = process.env.TURSO_DATABASE_URL;
  if (!url) return undefined;
  if (url.startsWith('file:')) throw new Error('Use turso dev and an HTTP URL for local development to preserve all SQLite text values.');
  if (process.env.VERCEL && (!/^(libsql|https):\/\//.test(url) || !process.env.TURSO_AUTH_TOKEN)) throw new Error('A remote Turso database and authentication token are required on Vercel.');
  binding = createSqliteBinding(createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN, intMode: 'number' }));
  return binding;
}
