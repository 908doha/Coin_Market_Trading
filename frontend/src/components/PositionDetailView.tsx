/**
 * 포지션 상세 / 거래 상세 공통 화면 레이아웃
 * positions/[id].tsx + history/[id].tsx 모두 이 컴포넌트를 사용
 * → UI를 변경하려면 이 파일 하나만 수정하면 양쪽 화면에 반영됨
 */
import React from 'react';
import { View, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import {
  Text, GlassCard, SubPageHeader, ScreenTransition,
  PositionDetailSkeleton, CurrencyToggle,
} from '@/design-system';
import { colors } from '@/design-system/tokens';
import { CoinHeaderCard, PnlCard, type GridRow } from '@/components/PositionDetailCard';
import IctAnalysisCard, { type IctAnalysis } from '@/components/IctAnalysisCard';
import type { PricePoint } from '@/utils/priceHistory';

export interface PositionDetailViewProps {
  // ─ 헤더
  title:         string;
  showUsd?:      boolean;
  onToggleUsd?:  () => void;
  rate?:         number;

  // ─ 로딩 / 에러
  isLoading:  boolean;
  hasError:   boolean;
  skeleton?:  React.ReactNode;   // 기본값: <PositionDetailSkeleton />
  emptyText?: string;

  // ─ 코인 헤더 카드
  coin:          string;
  symbol:        string;
  direction:     'Long' | 'Short';
  leverage?:     number;
  entryAt?:      string;
  holdingLabel?: string;

  // ─ PnL 카드
  profit:               number;
  profitRate:           number;
  pnlLabel?:            string;
  animated?:            boolean;
  pnlColor:             string;
  isProfit:             boolean;
  entryPrice:           number;
  exitOrCurrentPrice:   number;
  currentLabel?:        string;
  targetPrice?:         number | null;
  stopLoss?:            number | null;
  rows:                 GridRow[];

  // ─ 시계열 차트
  pricePoints?: PricePoint[];
  entryAtTs?:   number;

  // ─ ICT 분석
  ictAnalysis: IctAnalysis | null;
  ictPending?: boolean;

  // ─ TP/SL 수동 새로고침 (포지션 상세에서만 사용)
  onRefreshTpSl?:    () => void;
  tpSlRefreshing?:   boolean;

  // ─ 뒤로가기 커스텀 (홈→상세→홈 흐름)
  onBack?:           () => void;
}

export function PositionDetailView({
  title, showUsd = false, onToggleUsd, rate = 1350,
  isLoading, hasError, skeleton, emptyText = '데이터를 찾을 수 없어요',
  coin, symbol, direction, leverage, entryAt, holdingLabel,
  profit, profitRate, pnlLabel = '손익', animated = false,
  pnlColor, isProfit,
  entryPrice, exitOrCurrentPrice, currentLabel = '현재',
  targetPrice, stopLoss,
  rows,
  pricePoints, entryAtTs,
  ictAnalysis, ictPending,
  onRefreshTpSl, tpSlRefreshing,
  onBack,
}: PositionDetailViewProps) {
  return (
    <ScreenTransition>
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg.elevated }} edges={['top']}>
        <SubPageHeader
          title={title}
          onBack={onBack ?? (() => router.back())}
          rightElement={
            onToggleUsd
              ? <CurrencyToggle showUsd={showUsd} onToggle={onToggleUsd} />
              : undefined
          }
        />

        <ScrollView
          contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 8 }}
          showsVerticalScrollIndicator={false}
        >
          {isLoading ? (
            skeleton ?? <PositionDetailSkeleton />
          ) : hasError ? (
            <GlassCard intensity="low" radius={20} padding={48} style={{ alignItems: 'center' }}>
              <Text variant="body2" color={colors.text.tertiary}>{emptyText}</Text>
            </GlassCard>
          ) : (
            <>
              <CoinHeaderCard
                coin={coin}
                symbol={symbol}
                direction={direction}
                leverage={leverage}
                entryAt={entryAt}
                holdingLabel={holdingLabel}
              />

              <PnlCard
                profit={profit}
                profitRate={profitRate}
                pnlLabel={pnlLabel}
                animated={animated}
                showUsd={showUsd}
                rate={rate}
                pnlColor={pnlColor}
                isProfit={isProfit}
                entryPrice={entryPrice}
                currentOrExitPrice={exitOrCurrentPrice}
                currentLabel={currentLabel}
                targetPrice={targetPrice}
                stopLoss={stopLoss}
                direction={direction}
                pricePoints={pricePoints}
                entryAtTs={entryAtTs}
                rows={rows}
              />

              {/* TP/SL 수동 새로고침 버튼 (포지션 상세에서만 표시) */}
              {onRefreshTpSl && (
                <Pressable
                  onPress={onRefreshTpSl}
                  style={{
                    flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end',
                    marginTop: -4, marginBottom: 10, paddingHorizontal: 4, gap: 5,
                  }}
                >
                  <Text style={{ fontSize: 11, color: tpSlRefreshing ? colors.text.disabled : colors.text.tertiary }}>
                    {tpSlRefreshing ? 'TP/SL 조회 중...' : '↻  TP/SL 새로고침'}
                  </Text>
                </Pressable>
              )}

              <IctAnalysisCard
                ictAnalysis={ictAnalysis}
                direction={direction}
                pending={ictPending}
              />

              <View style={{ height: 120 }} />
            </>
          )}
        </ScrollView>
      </SafeAreaView>
    </ScreenTransition>
  );
}
