-- 거래내역 영구 저장 테이블
-- Supabase SQL Editor에서 실행하거나 supabase migration apply로 적용

create table if not exists trades (
  id                 text        not null,
  account_key        text        not null,  -- sha256(apiKey).slice(0,16) — API키를 직접 저장하지 않음
  exchange           text        not null  default 'gate',
  symbol             text,
  coin               text,
  direction          text,                  -- 'Long' | 'Short'
  type               text,                  -- 'take_profit' | 'stop_loss' | 'manual'
  profit             numeric,               -- 실현손익 KRW
  profit_rate        numeric,               -- 수익률 %
  holding_days       integer,
  entry_at           text,                  -- ISO 또는 "YYYY.MM.DD HH:MM" 형식
  exit_at            text,
  entry_price        numeric,               -- USD
  exit_price         numeric,               -- USD
  amount             numeric,               -- 증거금 KRW
  leverage           integer,
  agent_entry_reason text,
  agent_exit_reason  text,
  saved_at           timestamptz default now(),
  primary key (id, account_key)
);

-- account_key + exit_at 기준 최신순 조회 인덱스
create index if not exists trades_account_key_exit_at_idx
  on trades (account_key, exit_at desc);

-- RLS: 서버에서 service_role 키로만 접근 (클라이언트 직접 접근 차단)
alter table trades enable row level security;

-- service_role은 RLS 우회하므로 별도 policy 불필요
-- anon/authenticated 역할은 접근 불가 (보안)
