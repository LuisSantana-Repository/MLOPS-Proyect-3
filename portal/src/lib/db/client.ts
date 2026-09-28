import { drizzle, type MySql2Database } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { env } from "@/lib/env";
import * as schema from "./schema";

/**
 * Cliente Drizzle sobre MariaDB (pool mysql2), inicializado una sola vez.
 * En dev, Next recarga módulos con HMR: cacheamos el pool en globalThis para
 * no abrir un pool nuevo en cada recompilación.
 */
type Db = MySql2Database<typeof schema>;

const globalForDb = globalThis as unknown as {
  __portalPool?: mysql.Pool;
  __portalDb?: Db;
};

function buildPool(): mysql.Pool {
  if (env.DATABASE_URL) {
    return mysql.createPool(env.DATABASE_URL);
  }
  return mysql.createPool({
    host: env.MYSQL_HOST,
    port: env.MYSQL_PORT,
    user: env.MYSQL_USER,
    password: env.MYSQL_PASSWORD,
    database: env.MYSQL_DATABASE,
    connectionLimit: 5,
    waitForConnections: true,
  });
}

export function getDb(): Db {
  if (!globalForDb.__portalDb) {
    globalForDb.__portalPool ??= buildPool();
    globalForDb.__portalDb = drizzle(globalForDb.__portalPool, {
      schema,
      mode: "default",
    });
  }
  return globalForDb.__portalDb;
}

export { schema };
