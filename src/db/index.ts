import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import dotenv from 'dotenv';
import * as schema from './schema.ts';

dotenv.config();

const { Pool } = pg;

declare global {
  var _postgresPool: pg.Pool | undefined;
}

export const isPostgresConfigured = (): boolean => {
  return Boolean(
    process.env.SQL_HOST &&
    process.env.SQL_HOST.trim().length > 0 &&
    process.env.SQL_USER &&
    process.env.SQL_USER.trim().length > 0
  );
};

export const createPool = (): pg.Pool | null => {
  if (!isPostgresConfigured()) {
    return null;
  }
  if (!global._postgresPool) {
    try {
      global._postgresPool = new Pool({
        host: process.env.SQL_HOST,
        user: process.env.SQL_USER,
        password: process.env.SQL_PASSWORD,
        database: process.env.SQL_DB_NAME,
        max: 10,
        connectionTimeoutMillis: 5000,
      });

      global._postgresPool.on('error', (err) => {
        console.warn('Unexpected error on idle SQL pool client:', err);
      });
    } catch (err) {
      console.warn('Failed to initialize PostgreSQL pool:', err);
      return null;
    }
  }
  return global._postgresPool;
};

const pool = createPool();

const noOp = {
  findMany: async () => [],
  findFirst: async () => null,
  findUnique: async () => null,
  create: async (d: any) => d?.data ?? {},
  update: async (d: any) => d?.data ?? {},
  delete: async () => ({}),
};

export const db: ReturnType<typeof drizzle> = (pool
  ? drizzle(pool, { schema })
  : new Proxy({} as any, {
      get: (_, prop) => {
        if (prop === 'query') {
          return new Proxy({}, { get: () => noOp });
        }
        return () => ({
          from: () => {
            const chain: any = {
              where: () => chain,
              limit: () => chain,
              orderBy: () => chain,
              then: (resolve: any) => resolve([]),
            };
            return chain;
          },
          values: () => ({
            onConflictDoNothing: () => Promise.resolve([]),
            onConflictDoUpdate: () => Promise.resolve([]),
            then: (resolve: any) => resolve([]),
          }),
          set: () => ({
            where: () => Promise.resolve([]),
            then: (resolve: any) => resolve([]),
          }),
          where: () => Promise.resolve([]),
          then: (resolve: any) => resolve([]),
        });
      },
    })) as any;

