const winston = require('winston');
const config = require('../config');

const logger = winston.createLogger({
  level: config.logLevel,
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.printf(({ timestamp, level, message }) => {
      return `[${timestamp}] ${level.toUpperCase()}: ${message}`;
    })
  ),
  transports: [
    // Console 만 사용 — PM2가 stdout/stderr를 받아서 logs/pm2-out.log, pm2-error.log 에 저장
    // PM2 logrotate가 자동 회전 처리하므로 winston 파일 transport는 중복이라 제거
    new winston.transports.Console(),
  ],
});

module.exports = logger;
