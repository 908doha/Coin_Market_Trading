const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is required');
}

// URL 파싱 → 특수문자 포함 비밀번호도 안전하게 처리
function buildConfig(url) {
  try {
    const u = new URL(url);
    return {
      host:              u.hostname,
      port:              parseInt(u.port) || 5432,
      database:          u.pathname.replace(/^\//, '') || 'postgres',
      user:              decodeURIComponent(u.username),
      password:          decodeURIComponent(u.password),
      ssl:               { rejectUnauthorized: false },
      max:               10,
      idleTimeoutMillis: 30000,
    };
  } catch {
    return { connectionString: url, ssl: { rejectUnauthorized: false } };
  }
}

const pool = new Pool(buildConfig(process.env.DATABASE_URL));

pool.on('error', (err) => {
  console.error('PostgreSQL pool error:', err.message);
});

// SQLite ? 플레이스홀더 → PostgreSQL $1, $2, ... 변환
function toPostgresParams(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

// SQLite-호환 DB 인터페이스
const db = {
  async get(sql, ...params) {
    const { rows } = await pool.query(toPostgresParams(sql), params.flat());
    return rows[0];
  },
  async all(sql, ...params) {
    const { rows } = await pool.query(toPostgresParams(sql), params.flat());
    return rows;
  },
  async run(sql, ...params) {
    await pool.query(toPostgresParams(sql), params.flat());
  },
  async exec(sql) {
    await pool.query(sql);
  },
};

async function getDb() {
  return db;
}

module.exports = { getDb };
