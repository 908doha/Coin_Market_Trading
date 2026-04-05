const { Pool } = require('pg');

// 개별 환경변수 우선, 없으면 DATABASE_URL 파싱
function buildConfig() {
  // 방법 1: 개별 파라미터 (특수문자 비밀번호에 안전)
  if (process.env.DB_HOST) {
    return {
      host:              process.env.DB_HOST,
      port:              parseInt(process.env.DB_PORT) || 5432,
      database:          process.env.DB_NAME || 'postgres',
      user:              process.env.DB_USER || 'postgres',
      password:          process.env.DB_PASSWORD,
      ssl:               { rejectUnauthorized: false },
      max:               10,
      idleTimeoutMillis: 30000,
    };
  }

  // 방법 2: DATABASE_URL
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DB_HOST 또는 DATABASE_URL 환경변수가 필요합니다.');

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

const pool = new Pool(buildConfig());

pool.on('error', (err) => {
  console.error('PostgreSQL pool error:', err.message);
});

// SQLite ? 플레이스홀더 → PostgreSQL $1, $2, ... 변환
function toPostgresParams(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

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
