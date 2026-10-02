import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';
import { env } from '../../config/env.js';
import * as schema from './schema.js';

const ssl = env.DB_SSL
  ? {
      ca: readFileSync(env.DB_SSL_CA_PATH, 'utf8'),
      rejectUnauthorized: true,
    }
  : undefined;

/**
 * Pool de conexiones a MariaDB. Se reutiliza en toda la app (data layer)
 * para evitar abrir una conexión nueva por query.
 */
export const pool = env.DATABASE_URL
  ? mysql.createPool({ uri: env.DATABASE_URL, connectionLimit: 10, ssl })
  : mysql.createPool({
      host: env.DB_HOST,
      port: env.DB_PORT,
      user: env.DB_USER,
      password: env.DB_PASSWORD,
      database: env.DB_NAME,
      connectionLimit: 10,
      ssl,
    });

/**
 * Instancia de Drizzle ORM, tipada con el schema del proyecto.
 * Este es el único punto de acceso a la base de datos: la capa `logic`
 * debe consumir repositorios/queries de `data`, nunca este cliente
 * directamente desde `ui`.
 */
export const db = drizzle(pool, { schema, mode: 'default' });
