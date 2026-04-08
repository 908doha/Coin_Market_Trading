#!/bin/bash
# ============================================
# Gate.io ICT Trading Bot - 서버 초기 설정 스크립트
# Oracle Cloud Ubuntu VM 용
# ============================================

set -e

echo "=========================================="
echo " ICT Trading Bot 서버 설정 시작"
echo "=========================================="

# 1. 시스템 업데이트
echo "[1/5] 시스템 업데이트..."
sudo apt update && sudo apt upgrade -y

# 2. Node.js 20 LTS 설치
echo "[2/5] Node.js 설치..."
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

echo "Node.js 버전: $(node -v)"
echo "npm 버전: $(npm -v)"

# 3. PM2 설치
echo "[3/5] PM2 설치..."
sudo npm install -g pm2

# 4. 프로젝트 클론 및 설정
echo "[4/5] 프로젝트 설정..."
cd ~

if [ ! -d "Coin_Market_Trading" ]; then
  git clone https://github.com/openclaw4286-code/Coin_Market_Trading.git
fi

cd Coin_Market_Trading
git checkout claude/gateio-trading-bot-SDKao
npm install --production

# logs 디렉토리 생성
mkdir -p logs

# 5. .env 파일 생성 안내
echo "[5/5] 환경 설정..."
if [ ! -f ".env" ]; then
  cp .env.example .env
  echo ""
  echo "=========================================="
  echo " 중요: .env 파일을 편집해주세요!"
  echo "=========================================="
  echo ""
  echo "  nano .env"
  echo ""
  echo "  다음 항목을 입력하세요:"
  echo "  - GATEIO_API_KEY=실제_API_키"
  echo "  - GATEIO_API_SECRET=실제_시크릿_키"
  echo ""
fi

echo "=========================================="
echo " 설정 완료!"
echo ""
echo " 다음 단계:"
echo "  1. nano .env        → API 키 입력"
echo "  2. pm2 start ecosystem.config.js  → 봇 시작"
echo "  3. pm2 logs         → 로그 확인"
echo "  4. pm2 save && pm2 startup  → 서버 재부팅 시 자동 실행"
echo "=========================================="
