/**
 * GitHub Service — 에이전트 정의
 * 에이전트 목록은 코드에 직접 내장 (네트워크/파일 의존성 제거)
 */

export interface AgentDefinition {
  id:              string;
  name:            string;
  description:     string;
  isDashboardOnly: boolean;
  version?:        string;
  fileName:        string;
}

// 에이전트 목록 인라인 (claude/gateio-trading-bot-SDKao 브랜치 docs/ 기준)
const AGENTS: AgentDefinition[] = [
  {
    id:              'ict-strategy-1-indicators',
    name:            'ICT 전략 시리즈 1: 기술적 지표',
    description:     'Swing High/Low, MSS, BOS, FVG 등 ICT 핵심 기술 지표 정의 및 판별 로직',
    isDashboardOnly: false,
    version:         '2.0.0',
    fileName:        'ICT_STRATEGY_1_INDICATORS.md',
  },
  {
    id:              'ict-strategy-2-sessions-liquidity',
    name:            'ICT 전략 시리즈 2: 세션 시스템 & 유동성 레벨',
    description:     '아시안/런던/뉴욕 세션 시스템과 PDH/PDL 유동성 레벨 분석',
    isDashboardOnly: false,
    version:         '2.0.0',
    fileName:        'ICT_STRATEGY_2_SESSIONS_LIQUIDITY.md',
  },
  {
    id:              'ict-strategy-3-entry-sltp',
    name:            'ICT 전략 시리즈 3: 진입 조건 & SL/TP 계산',
    description:     'HTF(4h)/MTF(15m)/LTF(5m) 3단계 멀티 타임프레임 진입·청산 전략',
    isDashboardOnly: false,
    version:         '2.0.0',
    fileName:        'ICT_STRATEGY_3_ENTRY_SLTP.md',
  },
  {
    id:              'spec',
    name:            'Gate.io ICT 자동매매 봇 - 통합 명세서',
    description:     '트레이딩 봇 전체 시스템 아키텍처 및 구동 방식 통합 명세',
    isDashboardOnly: true,
    version:         '2.0.0',
    fileName:        'SPEC.md',
  },
];

export const githubService = {
  getAgentDefinitions(): Promise<AgentDefinition[]> {
    return Promise.resolve(AGENTS);
  },
  clearCache() {},
};
