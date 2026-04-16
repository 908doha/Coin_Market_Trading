// PM2 배포 설정
module.exports = {
  apps: [
    {
      name: 'ict-trading-bot',
      script: 'src/bot.js',
      instances: 1,
      // 명시적 fork 모드 — instances:1 이어도 exec_mode 미지정 시 cluster 기본값이
      // 적용되어 일부 Node SDK(net, http keep-alive 등)와 예기치 않은 상호작용 우려.
      // 거래봇은 단일 프로세스로 충분하므로 fork 가 안전.
      exec_mode: 'fork',
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
      // 크래시 시 재시작 딜레이 (10초) — API 일시 장애 시 rapid crash 방지
      restart_delay: 10000,
      // 비정상 종료 시 최대 재시작 횟수 — Gate.io/네트워크 간헐 장애 내성 확보
      max_restarts: 50,
      // 최소 안정 가동 시간 — 이 시간 미만 크래시는 restart 카운터에 누적
      min_uptime: '10s',
    },
  ],
};
