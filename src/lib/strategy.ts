export type Ticker = "TQQQ" | "SOXL";
export type SplitCount = 20 | 40;
export type Phase = "전반전" | "후반전";

/**
 * 매도 목표 수익률(%) 계산
 * TQQQ 20분할: (15 - 1.5*T)%   TQQQ 40분할: (15 - 0.15*T)%
 * SOXL 20분할: (20 - 2*T)%     SOXL 40분할: (20 - 1*T)%
 */
export function targetSellRate(ticker: Ticker, splitCount: SplitCount, roundNo: number): number {
  if (ticker === "TQQQ") {
    return splitCount === 20 ? 15 - 1.5 * roundNo : 15 - 0.15 * roundNo;
  }
  return splitCount === 20 ? 20 - 2 * roundNo : 20 - 1 * roundNo;
}

/** 평단가 기준 매도 목표가 */
export function targetSellPrice(avgPrice: number, ticker: Ticker, splitCount: SplitCount, roundNo: number): number {
  const rate = targetSellRate(ticker, splitCount, roundNo);
  return avgPrice * (1 + rate / 100);
}

/** 회차 1회당 할당 금액 (원금 / 분할수) */
export function amountPerRound(principal: number, splitCount: SplitCount): number {
  return principal / splitCount;
}

/**
 * 누적 매수 금액으로부터 현재 회차(T)와 전/후반전 판정
 * T는 "회차별 할당 금액이 채워졌을 때"를 기준으로 증가
 */
export function currentRound(
  cumulativeInvested: number,
  principal: number,
  splitCount: SplitCount,
): { roundNo: number; phase: Phase } {
  const perRound = amountPerRound(principal, splitCount);
  const roundNo = Math.min(splitCount, Math.floor(cumulativeInvested / perRound) + 1);
  const phase: Phase = roundNo <= splitCount / 2 ? "전반전" : "후반전";
  return { roundNo, phase };
}

export type BuyPlanLevel = { price: number; qty: number };

/**
 * 무릎/허벅지 구간 LOC 분할 매수 계획
 * 전일 종가를 기준으로 -knee%, -thigh% 구간을 levels개의 가격대로 등분하고
 * 그날 매수 예산(budget)을 가격이 낮을수록 더 많이 배분(역가중)한다.
 */
export function buildLocBuyPlan(
  prevClose: number,
  budget: number,
  opts: { kneePct?: number; thighPct?: number; levels?: number } = {},
): BuyPlanLevel[] {
  const kneePct = opts.kneePct ?? 5; // 무릎: -5%
  const thighPct = opts.thighPct ?? 10; // 허벅지: -10%
  const levels = opts.levels ?? 5;

  const high = prevClose * (1 - kneePct / 100);
  const low = prevClose * (1 - thighPct / 100);
  const step = (high - low) / (levels - 1);

  // 가격이 낮을수록 가중치를 높여서(역가중) 분할 매수 수량 산출
  const weights = Array.from({ length: levels }, (_, i) => i + 1); // [1,2,3,4,5]
  const weightSum = weights.reduce((a, b) => a + b, 0);

  return Array.from({ length: levels }, (_, i) => {
    const price = Number((high - step * i).toFixed(3));
    const allocated = (budget * weights[levels - 1 - i]) / weightSum;
    const qty = Number((allocated / price).toFixed(3));
    return { price, qty };
  });
}

export type RiskGauge = 20 | 30 | 40;

/**
 * 리스크 게이지 산출
 * - 평단가 대비 현재가 괴리율
 * - 남은 분할 대비 소진 속도
 * 둘 중 더 위험한 쪽을 기준으로 20/30/40 단계 반환
 */
export function riskGauge(params: {
  avgPrice: number;
  currentPrice: number;
  roundNo: number;
  splitCount: SplitCount;
  elapsedDays: number;
  totalDaysPlanned: number;
}): RiskGauge {
  const { avgPrice, currentPrice, roundNo, splitCount, elapsedDays, totalDaysPlanned } = params;

  const priceGapPct = ((avgPrice - currentPrice) / avgPrice) * 100; // 평단가보다 얼마나 빠졌는지
  const burnRate = roundNo / splitCount - elapsedDays / totalDaysPlanned; // 계획 대비 소진 속도(+면 빠르게 소진 중)

  if (priceGapPct >= 20 || burnRate >= 0.15) return 40;
  if (priceGapPct >= 10 || burnRate >= 0.05) return 30;
  return 20;
}
