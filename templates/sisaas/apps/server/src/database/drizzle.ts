import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

export type DrizzleDb = PostgresJsDatabase<typeof schema>;
export type PgClient = ReturnType<typeof postgres>;

export function createDatabase(connectionString: string): {
  db: DrizzleDb;
  client: PgClient;
} {
  const client = postgres(connectionString, { max: 10 });
  const db = drizzle(client, { schema });
  return { db, client };
}
