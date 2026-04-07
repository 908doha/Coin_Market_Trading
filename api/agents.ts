/**
 * GET /api/agents
 * bot/src/strategies/ 에 있는 실제 에이전트 정의 목록
 * 봇 서버(Railway) 없이도 항상 응답 (정적 정의)
 *
 * 새 전략 추가 시 이 파일과 bot/src/strategies/ 를 함께 업데이트한다.
 */

const AGENTS = [
  {
    id:          'ict-strategy-1-indicators',
    name:        'ICT 전략 — 지표',
    description: 'HTF(4h)/MTF(1h)/LTF(15m) 멀티 타임프레임 분석 + 스윙 고저 지표 기반 ICT 자동매매',
    version:     '1.0',
  },
  {
    id:          'ict-strategy-2-sessions-liquidity',
    name:        'ICT 전략 — 세션/유동성',
    description: '런던·뉴욕 킬존 + 유동성 스윕(BSL/SSL) 중심의 ICT 진입 전략',
    version:     '1.0',
  },
  {
    id:          'ict-strategy-3-entry-sltp',
    name:        'ICT 전략 — OTE 진입/SL·TP',
    description: 'OTE 구간(0.62–0.79) 정밀 진입 + MSS 기반 손절·익절 자동 설정',
    version:     '1.0',
  },
];

export default function handler(req: any, res: any) {
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  res.setHeader('Cache-Control', 's-maxage=60');
  res.status(200).json(AGENTS);
}
