const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is required');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 10,
  idleTimeoutMillis: 30000,
});

pool.on('error', (err) => {
  console.error('PostgreSQL pool error:', err.message);
});

// SQLite ? 플레이스홀더 → PostgreSQL $1, $2, ... 변환
function toPostgresParams(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

// SQLite-호환 DB 인터페이스 (기존 라우트 코드 무수정 유지)
const db = {
  // 단일 행 조회
  async get(sql, ...params) {
    const { rows } = await pool.query(toPostgresParams(sql), params.flat());
    return rows[0];
  },
  // 전체 행 조회
  async all(sql, ...params) {
    const { rows } = await pool.query(toPostgresParams(sql), params.flat());
    return rows;
  },
  // INSERT / UPDATE / DELETE
  async run(sql, ...params) {
    await pool.query(toPostgresParams(sql), params.flat());
  },
  // 스키마 등 raw SQL (테이블은 Supabase에서 이미 생성됨)
  async exec(sql) {
    await pool.query(sql);
  },
};

async function getDb() {
  return db;
}

module.exports = { getDb };
