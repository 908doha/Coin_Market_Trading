const fs = require('fs');
const path = require('path');
const logger = require('./logger');

const DATA_DIR = path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'kelly-stats.json');
const BAK = FILE + '.bak';
const TMP = FILE + '.tmp';

/**
 * Kelly 통계 영구 저장 (JSON 파일)
 *
 * 안전장치:
 *  - 원자적 쓰기: .tmp에 쓰기 → 기존 .json → .bak → .tmp → .json rename
 *  - load 실패 시 .bak 시도, 둘 다 실패 시 기본값
 *  - save 실패 시 봇 크래시 안 함 (로그만)
 */
const kellyPersistence = {
  /**
   * 파일에서 통계 로드
   * @returns {{ pairs: Object, dailyPnl: { date: string, pnl: number } }}
   */
  load() {
    // data 디렉토리 없으면 생성
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }

    // 1차: 메인 파일
    const data = this._tryRead(FILE);
    if (data) {
      logger.info(`Kelly 통계 로드 완료: ${FILE} (${Object.keys(data.pairs || {}).length}개 페어)`);
      return data;
    }

    // 2차: 백업 파일
    const bakData = this._tryRead(BAK);
    if (bakData) {
      logger.warn(`Kelly 통계 백업에서 복구: ${BAK}`);
      return bakData;
    }

    // 둘 다 실패: 기본값
    logger.info('Kelly 통계 파일 없음 — 기본값으로 시작');
    return { version: 1, pairs: {}, dailyPnl: { date: new Date().toDateString(), pnl: 0 } };
  },

  /**
   * 통계를 파일에 저장 (원자적)
   * @param {Map} tradeStatsByPair  pair → { wins, losses, totalWinUsdt, totalLossUsdt }
   * @param {number} dailyPnl
   * @param {string} dailyPnlResetDate
   */
  save(tradeStatsByPair, dailyPnl, dailyPnlResetDate) {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }

      const data = {
        version: 1,
        updatedAt: new Date().toISOString(),
        dailyPnl: {
          date: dailyPnlResetDate || new Date().toDateString(),
          pnl: dailyPnl || 0,
        },
        pairs: {},
      };

      for (const [pair, stats] of tradeStatsByPair.entries()) {
        data.pairs[pair] = {
          wins: stats.wins,
          losses: stats.losses,
          totalWinUsdt: stats.totalWinUsdt,
          totalLossUsdt: stats.totalLossUsdt,
        };
      }

      const json = JSON.stringify(data, null, 2);

      // 원자적 쓰기: tmp → bak → rename
      fs.writeFileSync(TMP, json, 'utf8');

      // 기존 파일이 있으면 백업
      if (fs.existsSync(FILE)) {
        fs.renameSync(FILE, BAK);
      }

      // tmp → 메인
      fs.renameSync(TMP, FILE);
    } catch (err) {
      logger.error(`Kelly 통계 저장 실패 (봇은 계속 동작): ${err.message}`);
    }
  },

  /** 파일 읽기 시도 (실패 시 null) */
  _tryRead(filePath) {
    try {
      if (!fs.existsSync(filePath)) return null;
      const raw = fs.readFileSync(filePath, 'utf8');
      const data = JSON.parse(raw);
      if (!data || typeof data !== 'object') return null;
      return data;
    } catch (err) {
      logger.warn(`Kelly 파일 읽기 실패 (${filePath}): ${err.message}`);
      return null;
    }
  },
};

module.exports = kellyPersistence;
