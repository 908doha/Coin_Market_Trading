// PM2 배포 설정
module.exports = {
  apps: [
    {
      name: 'ict-trading-bot',
      script: 'src/bot.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '256M',
      env: {
        NODE_ENV: 'production',
      },
      // 로그 설정
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      error_file: 'logs/pm2-error.log',
      out_file: 'logs/pm2-out.log',
      merge_logs: true,
      // 크래시 시 재시작 딜레이
      restart_delay: 5000,
      // 비정상 종료 시 최대 재시작 횟수 (10분 내 15회)
      max_restarts: 15,
      min_uptime: '10s',
    },
  ],
};
