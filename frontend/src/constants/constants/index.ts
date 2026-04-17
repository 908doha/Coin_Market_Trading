export const COMPANY_BANK = {
  bank: '신한은행',
  account: '110-123-456789',
  holder: '(주)코인마켓트레이딩',
};

export const DEPOSIT_MIN = 10_000;
export const WITHDRAW_FEE = 500;
export const BUSINESS_HOURS = '평일 09:00 ~ 18:00';

export const RISK_LABELS = {
  low:    '보수적',
  medium: '중간',
  high:   '공격적',
} as const;

export const RISK_DESCRIPTIONS = {
  low:    '안정성 우선. 소규모 포지션, 빠른 손절.',
  medium: '균형잡힌 운용. 일반적인 리스크/수익 비율.',
  high:   '수익 극대화. 큰 포지션, 넓은 손절 구간.',
} as const;
