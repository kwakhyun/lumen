import { env } from "@/lib/runtime-env";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

export function getDb() {
  if (!env.DB) {
    throw new Error(
      "The database is unavailable. Configure TURSO_DATABASE_URL and TURSO_AUTH_TOKEN."
    );
  }

  // Drizzle uses only prepare and batch from the prepared SQLite contract.
  return drizzle(env.DB as D1Database, { schema });
}
