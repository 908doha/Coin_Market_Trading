const { Pool } = require('pg');
const dns = require('dns');

dns.setDefaultResultOrder('ipv4first');

function buildConfig() {
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
pool.on('error', (err) => console.error('PostgreSQL pool error:', err.message));

// 서버 시작 시 자동으로 테이블 생성
async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, password TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT to_char(NOW(), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    );
    CREATE TABLE IF NOT EXISTS refresh_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token TEXT UNIQUE NOT NULL, expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT to_char(NOW(), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    );
    CREATE TABLE IF NOT EXISTS verification_codes (
      id TEXT PRIMARY KEY, email TEXT NOT NULL, code TEXT NOT NULL,
      used INTEGER NOT NULL DEFAULT 0, expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT to_char(NOW(), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    );
    CREATE TABLE IF NOT EXISTS fund_transactions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type TEXT NOT NULL CHECK(type IN ('deposit','withdraw')),
      amount NUMERIC NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','done','rejected')),
      sender_name TEXT, bank TEXT, account_number TEXT, account_holder TEXT,
      requested_at TEXT NOT NULL DEFAULT to_char(NOW(), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      completed_at TEXT
    );
    CREATE TABLE IF NOT EXISTS notification_settings (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      trade INTEGER NOT NULL DEFAULT 1, big_profit INTEGER NOT NULL DEFAULT 1,
      big_loss INTEGER NOT NULL DEFAULT 1, weekly INTEGER NOT NULL DEFAULT 1,
      deposit INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS agent_settings (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'running' CHECK(status IN ('running','paused','waiting')),
      risk_level TEXT NOT NULL DEFAULT 'medium' CHECK(risk_level IN ('low','medium','high'))
    );
    CREATE TABLE IF NOT EXISTS chart_snapshots (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      date TEXT NOT NULL, value NUMERIC NOT NULL,
      UNIQUE(user_id, date)
    );
    CREATE TABLE IF NOT EXISTS agent_decisions (
      id TEXT PRIMARY KEY, contract TEXT NOT NULL, direction TEXT NOT NULL,
      entry_price NUMERIC NOT NULL, reason TEXT NOT NULL, plan TEXT NOT NULL,
      signals TEXT,
      created_at TEXT NOT NULL DEFAULT to_char(NOW(), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    );
  `);
  console.log('DB 테이블 초기화 완료');
}

initDb().catch((err) => console.error('DB 초기화 실패:', err.message));

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
