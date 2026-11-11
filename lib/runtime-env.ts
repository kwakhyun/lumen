import { getSqliteBinding } from './runtime/sqlite-binding';

/** Server-only settings and lazily initialized database transport. */
type RuntimeEnv = Omit<Cloudflare.Env, 'DB'> & {
  readonly DB: ReturnType<typeof getSqliteBinding>;
  CRON_SECRET?: string;
  VERCEL_ENV?: string;
  LUMEN_SCHEDULES_ENABLED?: string;
};
export const env: RuntimeEnv = { ...process.env, get DB() { return getSqliteBinding(); } };
