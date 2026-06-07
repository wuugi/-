// 라오어의 무한매수법 핵심 계산 로직
//
// 주의: 비공개 카페 자료(라오어 4.0 원문)에는 접근할 수 없어, 공개된 원칙을 토대로
// 구현한 근사치입니다. 확인된 핵심 원칙:
//  - 평단 대비 쌀수록 더 매수하고, 비쌀수록 적게 매수하는 계단식(폭락률 단계별) 매수
//  - 2회차부터 매일 "현재 평단 + 목표수익률% AFTER 지정가" 매도 주문을 갱신
//  - LOC(종가) 주문은 종가가 지정가 조건을 만족하면 체결된 것으로 판단
// 실제 운용 전에는 본인의 기준에 맞게 단계 구간/수량/추세 판정 로직을 조정하세요.

export type Phase = "전반전" | "후반전";

/** 회차(T)가 전체 분할 수의 절반을 넘기면 후반전 */
export function getPhase(roundNo: number, splitCount: number): Phase {
  return roundNo <= splitCount / 2 ? "전반전" : "후반전";
}

/**
 * 회차별 매도 목표 수익률(%).
 * 전반전은 높은 목표가, 후반전으로 갈수록 목표를 낮춰 회전율을 높인다.
 */
export function getTargetRate(roundNo: number, splitCount: number): number {
  const half = splitCount / 2;
  if (roundNo <= half) {
    // 전반전: 10% -> 5%로 선형 감소
    const progress = (roundNo - 1) / Math.max(half - 1, 1);
    return Number((10 - progress * 5).toFixed(2));
  }
  // 후반전: 5% -> 2%로 선형 감소
  const progress = (roundNo - half - 1) / Math.max(half - 1, 1);
  return Number((5 - progress * 3).toFixed(2));
}

export type RiskGauge = 20 | 30 | 40;

/**
 * 최근 고점 대비 현재가 하락률로 리스크 단계를 산출.
 * 하락폭이 클수록 더 공격적으로 매수해야 하므로 게이지 값이 커진다.
 */
export function getRiskGauge(currentPrice: number, recentHigh: number): RiskGauge {
  if (recentHigh <= 0) return 20;
  const drawdownPct = ((recentHigh - currentPrice) / recentHigh) * 100;
  if (drawdownPct >= 30) return 40;
  if (drawdownPct >= 20) return 30;
  return 20;
}

export interface BuyTier {
  /** 단계 번호 (1단계가 가장 비싼 가격, 숫자가 커질수록 더 떨어진 가격) */
  level: number;
  /** 전일 종가 대비 하락률(%) 기준점 */
  dropPct: number;
  /** 해당 단계의 LOC 지정가 */
  limitPrice: number;
  /** 해당 단계에서 추가로 매수할 주식 수 (1주 단위로 단계마다 누적) */
  qty: number;
}

/**
 * 폭락률 단계별 1주 매수 사다리.
 * 전일 종가를 기준으로 -3%p씩 하락 구간을 나누고, 더 떨어진 단계일수록
 * 매수 수량을 늘려(1주 -> 2주 -> 3주 -> 4주) 평단가를 낮춘다.
 * 리스크 게이지가 높을수록(하락 추세가 강할수록) 단계별 기준 수량 자체를 키운다.
 */
export function getBuyLadder(prevClose: number, riskGauge: RiskGauge): BuyTier[] {
  const stepPct = 3;
  const baseQty = riskGauge === 40 ? 2 : riskGauge === 30 ? 1.5 : 1;
  const tiers: BuyTier[] = [];
  for (let level = 1; level <= 4; level++) {
    const dropPct = stepPct * (level - 1);
    tiers.push({
      level,
      dropPct,
      limitPrice: Number((prevClose * (1 - dropPct / 100)).toFixed(2)),
      qty: Number((baseQty * level).toFixed(2)),
    });
  }
  return tiers;
}

export interface BuyTierFill extends BuyTier {
  /** 종가가 지정가 이하로 마감되어 LOC 매수가 체결되었는지 여부 */
  filled: boolean;
}

/** LOC 매수 자동 판단: 종가가 단계별 지정가 이하로 마감되면 해당 단계는 체결된 것으로 본다 */
export function judgeBuyLadderFills(ladder: BuyTier[], closePrice: number): BuyTierFill[] {
  return ladder.map((tier) => ({ ...tier, filled: closePrice <= tier.limitPrice }));
}

/** 최근 N일 종가 단순이동평균 */
export function getMovingAverage(closes: number[], window: number): number | null {
  if (closes.length < window) return null;
  const recent = closes.slice(-window);
  return recent.reduce((sum, v) => sum + v, 0) / window;
}

export type Trend = "상승" | "하락" | "횡보";

/** 종가와 이동평균을 비교해 단기 시장 흐름을 판단 */
export function getTrend(closePrice: number, movingAverage: number | null): Trend {
  if (movingAverage === null) return "횡보";
  if (closePrice > movingAverage * 1.01) return "상승";
  if (closePrice < movingAverage * 0.99) return "하락";
  return "횡보";
}

export interface SellRecommendation {
  /** 오늘 저녁에 걸어야 할 AFTER 지정가 매도 가격 */
  limitPrice: number;
  /** 매도 수량 (보유 전량) */
  qty: number;
  /** 추세 판단 결과 */
  trend: Trend;
  /** 추세를 반영해 조정된 목표 수익률(%) */
  adjustedTargetRate: number;
  /** 오늘 매도 지정가 주문을 걸어야 하는지 여부 (보유 수량이 있을 때만 권장) */
  shouldPlaceOrder: boolean;
}

/**
 * 2회차 이후 매일 갱신하는 매도 추천.
 * 기본은 "평단 + 회차 목표수익률%" 가격에 AFTER 지정가 주문을 걸되,
 * 단기 추세가 하락이면 회전율을 높이기 위해 목표 수익률을 낮춰 잡고,
 * 상승 추세면 더 큰 수익을 노려 목표 수익률을 그대로 유지한다.
 */
export function getSellRecommendation(
  avgPrice: number,
  qty: number,
  targetRate: number,
  closePrice: number,
  movingAverage: number | null
): SellRecommendation {
  const trend = getTrend(closePrice, movingAverage);
  const adjustedTargetRate = trend === "하락" ? Number((targetRate * 0.7).toFixed(2)) : targetRate;
  return {
    limitPrice: Number((avgPrice * (1 + adjustedTargetRate / 100)).toFixed(2)),
    qty,
    trend,
    adjustedTargetRate,
    shouldPlaceOrder: qty > 0,
  };
}

/** 지정가 매도 자동 판단: 종가가 지정가 이상으로 마감되면 매도 체결로 본다 */
export function judgeSellFill(limitPrice: number, closePrice: number): boolean {
  return closePrice >= limitPrice;
}
