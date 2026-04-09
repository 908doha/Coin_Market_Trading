// ─── 사용자 ───────────────────────────────────────────────────────────────────

export const mockUser = {
  id: 'u1',
  name: '홍길동',
  email: 'hong@example.com',
  joinedAt: '2024-01-15',
};

// ─── 잔액 ────────────────────────────────────────────────────────────────────

export const mockBalance = {
  total: 12_450_000,           // 총 자산 (KRW)
  invested: 10_000_000,        // 운용 중
  available: 2_450_000,        // 출금 가능
  profitTotal: 450_000,        // 누적 수익
  profitRate: 4.5,             // 누적 수익률 %
  profitToday: 82_000,         // 오늘 수익
  profitTodayRate: 0.67,
};

// ─── 수익률 그래프 데이터 ──────────────────────────────────────────────────────

export const mockChartData = {
  '1W': [
    { date: '03/30', value: 11_800_000 },
    { date: '03/31', value: 11_950_000 },
    { date: '04/01', value: 11_730_000 },
    { date: '04/02', value: 12_100_000 },
    { date: '04/03', value: 12_250_000 },
    { date: '04/04', value: 12_380_000 },
    { date: '04/05', value: 12_450_000 },
  ],
  '1M': [
    { date: '03/05', value: 10_200_000 },
    { date: '03/12', value: 10_800_000 },
    { date: '03/19', value: 11_200_000 },
    { date: '03/26', value: 11_600_000 },
    { date: '04/05', value: 12_450_000 },
  ],
  '3M': [
    { date: '01/05', value: 10_000_000 },
    { date: '02/05', value: 10_500_000 },
    { date: '03/05', value: 11_200_000 },
    { date: '04/05', value: 12_450_000 },
  ],
};

// ─── 현재 포지션 ──────────────────────────────────────────────────────────────

export type IctConfluence = {
  label:  string;
  detail: string;
  isKey:  boolean;
};

export type IctAnalysis = {
  session:          string;
  htfBias:          'BULLISH' | 'BEARISH';
  htfTimeframe:     string;
  confluences:      IctConfluence[];
  confluenceCount:  number;
};

export type Position = {
  id: string;
  coin: string;
  symbol: string;
  direction: 'Long' | 'Short';
  entryPrice: number;
  currentPrice: number;
  amount: number;          // 투자금 KRW
  currentValue: number;    // 현재 평가금
  profit: number;
  profitRate: number;
  weight: number;          // 비중 %
  entryAt: string;
  targetPrice: number;
  stopLoss: number;
  holdingPeriod: string;
  riskLevel: 1 | 2 | 3 | 4 | 5;
  agentReason: string;
  agentPlan: string;
  ictAnalysis?: IctAnalysis;
};

export const mockPositions: Position[] = [
  {
    id: 'p1',
    coin: '비트코인',
    symbol: 'BTC',
    direction: 'Long',
    entryPrice: 96_200_000,
    currentPrice: 98_450_000,
    amount: 4_000_000,
    currentValue: 4_493_000,
    profit: 493_000,
    profitRate: 5.84,
    weight: 40,
    entryAt: '2024-04-03 14:32',
    targetPrice: 102_000_000,
    stopLoss: 94_000_000,
    holdingPeriod: '2~5일',
    riskLevel: 3,
    agentReason:
      'BTC 4시간봉 기준 골든크로스 확인. RSI 54로 과매수 구간이 아니며 온체인 데이터에서 고래 지갑의 매집 패턴이 감지됐습니다. 거래량 증가와 함께 지지선 96,000,000원을 강하게 지지하고 있어 단기 상승 여력이 있다고 판단했습니다.',
    agentPlan:
      '목표가 도달 또는 3일 이상 횡보 시 청산 예정. 94,000,000원 이탈 시 즉시 손절합니다.',
    ictAnalysis: {
      session: 'London AM',
      htfBias: 'BULLISH',
      htfTimeframe: '4h',
      confluences: [
        { label: 'HTF OB 진입', detail: '[95,800,000-96,050,000]', isKey: true },
        { label: 'MTF OB', detail: '[95,600,000-96,200,000]', isKey: false },
        { label: 'HTF+MTF OB 겹침', detail: '[95,800,000-96,050,000]', isKey: true },
        { label: 'LTF FVG CE', detail: '@ 96,100,000 (진입가 96,200,000)', isKey: false },
        { label: 'EQL 스윕', detail: '95,500,000 유동성 확보', isKey: false },
      ],
      confluenceCount: 5,
    },
  },
  {
    id: 'p2',
    coin: '이더리움',
    symbol: 'ETH',
    direction: 'Long',
    entryPrice: 5_120_000,
    currentPrice: 5_340_000,
    amount: 3_000_000,
    currentValue: 3_129_000,
    profit: 129_000,
    profitRate: 4.29,
    weight: 30,
    entryAt: '2024-04-04 09:15',
    targetPrice: 5_600_000,
    stopLoss: 4_950_000,
    holdingPeriod: '3~7일',
    riskLevel: 2,
    agentReason:
      'ETH/BTC 비율이 역사적 저점 근처에서 반등 신호 포착. 이더리움 네트워크 수수료(가스비)가 상승세로 전환되며 온체인 활동이 증가하고 있습니다. BTC 강세장에서 ETH가 후행하는 패턴을 보이는 시기로 판단해 진입했습니다.',
    agentPlan:
      '5,600,000원 도달 시 50% 부분 청산 후 나머지 홀딩. 4,950,000원 이탈 시 전량 손절합니다.',
    ictAnalysis: {
      session: 'US AM',
      htfBias: 'BULLISH',
      htfTimeframe: '4h',
      confluences: [
        { label: 'HTF OB 진입', detail: '[5,080,000-5,100,000]', isKey: true },
        { label: 'MTF OB', detail: '[5,050,000-5,120,000]', isKey: false },
        { label: 'HTF+MTF OB 겹침', detail: '[5,080,000-5,100,000]', isKey: true },
        { label: 'LTF FVG CE', detail: '@ 5,110,000 (진입가 5,120,000)', isKey: false },
        { label: 'MSS 확인', detail: '5,090,000 돌파', isKey: false },
        { label: 'PMH 스윕', detail: '전일 고점 유동성 확보', isKey: true },
      ],
      confluenceCount: 6,
    },
  },
  {
    id: 'p3',
    coin: '솔라나',
    symbol: 'SOL',
    direction: 'Long',
    entryPrice: 198_000,
    currentPrice: 204_000,
    amount: 3_000_000,
    currentValue: 3_091_000,
    profit: 91_000,
    profitRate: 3.03,
    weight: 30,
    entryAt: '2024-04-04 16:48',
    targetPrice: 220_000,
    stopLoss: 188_000,
    holdingPeriod: '5~10일',
    riskLevel: 4,
    agentReason:
      'SOL 생태계 TVL(총 예치금)이 최근 3개월 최고치를 기록하며 펀더멘털이 강화되고 있습니다. 기술적으로는 200,000원 저항선을 돌파 시도 중이며 거래량이 평균 대비 2.3배 증가했습니다. 단기 모멘텀이 강한 구간으로 판단했습니다.',
    agentPlan:
      '220,000원 도달 시 전량 청산. 188,000원 이탈 시 즉시 손절합니다.',
    ictAnalysis: {
      session: 'London AM',
      htfBias: 'BULLISH',
      htfTimeframe: '4h',
      confluences: [
        { label: 'HTF OB 진입', detail: '[196,000-197,500]', isKey: true },
        { label: 'MTF OB', detail: '[195,000-198,000]', isKey: false },
        { label: 'LTF FVG CE', detail: '@ 197,800 (진입가 198,000)', isKey: false },
        { label: 'PDL 스윕', detail: '전일 저점 유동성 확보', isKey: true },
      ],
      confluenceCount: 4,
    },
  },
];

// ─── 거래 내역 ────────────────────────────────────────────────────────────────

export type Trade = {
  id: string;
  coin: string;
  symbol: string;
  direction: 'Long' | 'Short';
  type: 'close' | 'stop_loss';
  entryPrice: number;
  exitPrice: number;
  amount: number;
  profit: number;
  profitRate: number;
  entryAt: string;
  exitAt: string;
  holdingDays: number;
  agentEntryReason: string;
  agentExitReason: string;
};

export const mockTrades: Trade[] = [
  {
    id: 't1',
    coin: '비트코인',
    symbol: 'BTC',
    direction: 'Long',
    type: 'close',
    entryPrice: 90_500_000,
    exitPrice: 96_100_000,
    amount: 3_000_000,
    profit: 320_000,
    profitRate: 6.19,
    entryAt: '2024-03-28 10:20',
    exitAt: '2024-04-02 14:05',
    holdingDays: 5,
    agentEntryReason:
      '200일 이동평균선 위에서 지지 확인 후 진입. 공포탐욕지수 38로 공포 구간에서 매수 기회 포착.',
    agentExitReason:
      '목표가 96,100,000원 도달로 예정대로 청산했습니다. RSI가 72로 과매수 진입해 추가 상승보다 차익 실현이 적절하다고 판단했습니다.',
  },
  {
    id: 't2',
    coin: '리플',
    symbol: 'XRP',
    direction: 'Long',
    type: 'stop_loss',
    entryPrice: 870,
    exitPrice: 820,
    amount: 2_000_000,
    profit: -114_000,
    profitRate: -5.75,
    entryAt: '2024-03-30 09:00',
    exitAt: '2024-04-01 11:30',
    holdingDays: 2,
    agentEntryReason:
      'XRP SEC 소송 종결 기대감으로 단기 급등 모멘텀 포착. 850원 지지선 확인 후 진입했습니다.',
    agentExitReason:
      '예상과 달리 820원 손절선 이탈. 관련 뉴스 악재 발생으로 추가 하락 리스크가 크다고 판단해 즉시 손절했습니다. 손실을 최소화하는 것이 우선입니다.',
  },
  {
    id: 't3',
    coin: '이더리움',
    symbol: 'ETH',
    direction: 'Short',
    type: 'close',
    entryPrice: 5_450_000,
    exitPrice: 5_200_000,
    amount: 2_500_000,
    profit: 115_000,
    profitRate: 4.59,
    entryAt: '2024-03-25 15:00',
    exitAt: '2024-03-29 10:20',
    holdingDays: 4,
    agentEntryReason:
      'ETH 선물 펀딩비율이 과도하게 높아 롱 과열 신호 감지. 5,500,000원 강한 저항선에서 숏 진입했습니다.',
    agentExitReason:
      '목표가 5,200,000원 도달로 청산. 예상 구간에서 지지세가 강해 추가 하락 가능성이 낮다고 판단했습니다.',
  },
];

// ─── 충전/출금 내역 ────────────────────────────────────────────────────────────

export type FundTransaction = {
  id: string;
  type: 'deposit' | 'withdraw';
  amount: number;
  status: 'pending' | 'processing' | 'done' | 'rejected';
  requestedAt: string;
  completedAt?: string;
};

export const mockFundTransactions: FundTransaction[] = [
  { id: 'f1', type: 'deposit',  amount: 1_000_000, status: 'done',       requestedAt: '2024-04-03', completedAt: '2024-04-03' },
  { id: 'f2', type: 'withdraw', amount: 500_000,   status: 'done',       requestedAt: '2024-04-01', completedAt: '2024-04-01' },
  { id: 'f3', type: 'deposit',  amount: 500_000,   status: 'pending',    requestedAt: '2024-03-28' },
];

// ─── 에이전트 통계 ─────────────────────────────────────────────────────────────

export const mockAgentStats = {
  status: 'running' as 'running' | 'paused' | 'waiting',
  lastTradeAt: '2시간 전',
  winRate30d: 68.4,
  totalTrades: 47,
  avgHoldingDays: 3.2,
  riskLevel: 'medium' as 'low' | 'medium' | 'high',
};
