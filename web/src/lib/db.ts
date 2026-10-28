import pg from 'pg';

// Keep DATE columns as 'YYYY-MM-DD' strings; JS Date would shift them by the container's time zone.
pg.types.setTypeParser(1082, (v) => v);

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 5 });

export async function q<T = any>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (await pool.query(sql, params)).rows;
}
