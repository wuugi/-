// 라오어의 무한매수법 V4.0 핵심 계산 로직
//
// 카페 비공개 자료(라오어 4.0 원문 PDF)를 기반으로 구현했습니다.
// 핵심 개념:
//  - T값: 0에서 시작해 매수/매도 체결 종류에 따라 변하는 연속적인 진행도 값
//  - 별%: 종목/분할수/T값에 따라 정해지는 매수·매도 기준 수익률
//  - 별지점: 평단가 × (1 + 별% / 100). 매수점은 별지점 - 0.01, 매도점은 별지점
//  - 1회 매수금: 잔금 / (분할수 - T) (단, 첫 매수는 원금 / 분할수)

export type Ticker = "TQQQ" | "SOXL";
export type Phase = "전반전" | "후반전";
export type TradeKind = "first" | "full" | "half" | "extra" | "quarterSell" | "remainderSell";

/** T값이 분할수의 절반 이상이면 후반전 */
export function getPhase(tValue: number, splitCount: number): Phase {
  return tValue < splitCount / 2 ? "전반전" : "후반전";
}

/**
 * 별% 계산 (라오어 4.0 공식)
 *  - 20분할 TQQQ: 15 - 1.5*T
 *  - 40분할 TQQQ: 15 - 0.75*T
 *  - 20분할 SOXL: 20 - 2*T
 *  - 40분할 SOXL: 20 - T
 */
export function getStarPercent(ticker: Ticker, splitCount: number, tValue: number): number {
  if (ticker === "TQQQ") {
    const slope = splitCount === 40 ? 0.75 : 1.5;
    return Number((15 - slope * tValue).toFixed(4));
  }
  const slope = splitCount === 40 ? 1 : 2;
  return Number((20 - slope * tValue).toFixed(4));
}

/** 별지점 = 평단가 * (1 + 별% / 100) */
export function getStarPoint(avgPrice: number, starPercent: number): number {
  return Number((avgPrice * (1 + starPercent / 100)).toFixed(2));
}

/** 매수점 = 별지점 - 0.01 (매도점과 겹치지 않도록) */
export function getBuyTriggerPrice(starPoint: number): number {
  return Number((starPoint - 0.01).toFixed(2));
}

/** 매도점 = 별지점 그대로 */
export function getSellTriggerPrice(starPoint: number): number {
  return starPoint;
}

/**
 * 1회 매수금 계산
 *  - 첫 매수(T=0): 원금 / 분할수
 *  - 이후: 잔금 / (분할수 - T)
 */
export function getDailyBuyBudget(
  tValue: number,
  splitCount: number,
  principal: number,
  cashBalance: number
): number {
  if (tValue <= 0) {
    return Number((principal / splitCount).toFixed(2));
  }
  const denominator = Math.max(splitCount - tValue, 1);
  return Number((cashBalance / denominator).toFixed(2));
}

/**
 * T값 변화 적용
 *  - first/full(1회매수): T + 1
 *  - half(절반매수): T + 0.5
 *  - extra(추가 LOC매수): 변화 없음
 *  - quarterSell(쿼터매도): T = 직전 T * 0.75
 *  - remainderSell(잔여 지정가 매도): 변화 없음
 */
export function applyTDelta(tValue: number, kind: TradeKind): number {
  switch (kind) {
    case "first":
    case "full":
      return Number((tValue + 1).toFixed(6));
    case "half":
      return Number((tValue + 0.5).toFixed(6));
    case "quarterSell":
      return Number((tValue * 0.75).toFixed(6));
    case "extra":
    case "remainderSell":
    default:
      return tValue;
  }
}

export interface LadderTier {
  /** 단계 번호 (1단계가 기준가에 가장 가까운 단계) */
  level: number;
  /** 기준가 대비 하락률(%) */
  dropPct: number;
  /** 해당 단계의 LOC 지정가 */
  limitPrice: number;
  /** 해당 단계에서 매수할 주식 수 */
  qty: number;
  /** 매수 사유 라벨 */
  label: string;
}

/** 매수/매도 수량은 소수점 없이 정수 주 단위로 반올림해 노출한다 */
function roundQty(qty: number): number {
  return Math.max(Math.round(qty), 0);
}

export type CrashProtectionPct = 20 | 30;

/**
 * 폭락률 보호 구간에 따라 단계별 하락 LOC 사다리의 하락폭(%) 간격을 계산한다.
 * 보호 구간이 클수록(30%) 더 넓은 폭(%)으로 단계를 나눠 깊은 폭락까지 대비하고,
 * 보호 구간이 작으면(20%) 더 촘촘한 폭으로 단계를 나눈다.
 */
function getStepPct(crashProtectionPct: CrashProtectionPct, count: number): number {
  return crashProtectionPct / count;
}

/** 기준가에서 -stepPct%p씩 내려가는 보조 단계별 LOC 사다리 (잔여 예산 소진용) */
function buildStepDownLadder(
  basePrice: number,
  startLevel: number,
  qtyEach: number,
  count: number,
  stepPct: number,
  label: string
): LadderTier[] {
  const tiers: LadderTier[] = [];
  for (let i = 0; i < count; i++) {
    const level = startLevel + i;
    const dropPct = Number((stepPct * (i + 1)).toFixed(2));
    tiers.push({
      level,
      dropPct,
      limitPrice: Number((basePrice * (1 - dropPct / 100)).toFixed(2)),
      qty: qtyEach,
      label,
    });
  }
  return tiers;
}

/**
 * 첫 매수(T=0) 사다리: 큰수 LOC(전일 종가 대비 +10~15%) + 단계별 하락 LOC
 * 큰수 매수는 전일 종가보다 높은 가격에 걸어 시초가 갭상승에도 체결되게 하는 주문이다.
 * 폭락률 보호 구간(20%/30%)에 맞춰 하락 사다리의 간격을 조정한다.
 */
export function getFirstBuyLadder(
  prevClose: number,
  dailyBudget: number,
  crashProtectionPct: CrashProtectionPct = 20
): LadderTier[] {
  const bigNumberPrice = Number((prevClose * 1.12).toFixed(2));
  const bigNumberQty = roundQty(dailyBudget / 2 / bigNumberPrice);
  const stepQty = roundQty(dailyBudget / 2 / 4 / prevClose);
  const stepPct = getStepPct(crashProtectionPct, 4);
  return [
    { level: 0, dropPct: -12, limitPrice: bigNumberPrice, qty: bigNumberQty, label: "큰수 매수(시초가 갭상승 대비)" },
    ...buildStepDownLadder(prevClose, 1, stepQty, 4, stepPct, `단계별 하락 매수(폭락률 보호 ${crashProtectionPct}% 구간)`),
  ];
}

/**
 * 전반전(T < 분할수/2) 매수 사다리
 *  - 일일 매수금의 절반은 별지점 LOC, 절반은 평단가 LOC
 *  - 잔여 예산은 폭락률 보호 구간(20%/30%)에 맞춘 단계별 하락 LOC로 분산
 */
export function getFirstHalfLadder(
  avgPrice: number,
  starPoint: number,
  prevClose: number,
  dailyBudget: number,
  crashProtectionPct: CrashProtectionPct = 20
): LadderTier[] {
  const half = dailyBudget / 2;
  const buyTrigger = getBuyTriggerPrice(starPoint);
  const starQty = roundQty(half / 2 / buyTrigger);
  const avgQty = roundQty(half / 2 / avgPrice);
  const stepQty = roundQty(half / 2 / 3 / prevClose);
  const stepPct = getStepPct(crashProtectionPct, 3);
  return [
    { level: 1, dropPct: 0, limitPrice: buyTrigger, qty: starQty, label: "별지점 LOC 매수" },
    { level: 2, dropPct: 0, limitPrice: avgPrice, qty: avgQty, label: "평단가 LOC 매수" },
    ...buildStepDownLadder(prevClose, 3, stepQty, 3, stepPct, `단계별 하락 매수(폭락률 보호 ${crashProtectionPct}% 구간)`),
  ];
}

/**
 * 후반전(T >= 분할수/2) 매수 사다리
 *  - 일일 매수금 전체를 별지점 LOC + 폭락률 보호 구간(20%/30%)에 맞춘 단계별 하락 LOC로 배분
 */
export function getSecondHalfLadder(
  starPoint: number,
  prevClose: number,
  dailyBudget: number,
  crashProtectionPct: CrashProtectionPct = 20
): LadderTier[] {
  const buyTrigger = getBuyTriggerPrice(starPoint);
  const starQty = roundQty((dailyBudget / 2) / buyTrigger);
  const stepQty = roundQty((dailyBudget / 2) / 4 / prevClose);
  const stepPct = getStepPct(crashProtectionPct, 4);
  return [
    { level: 1, dropPct: 0, limitPrice: buyTrigger, qty: starQty, label: "별지점 LOC 매수" },
    ...buildStepDownLadder(prevClose, 2, stepQty, 4, stepPct, `단계별 하락 매수(폭락률 보호 ${crashProtectionPct}% 구간)`),
  ];
}

/** 종가가 단계별 지정가 이하로 마감되면 해당 단계는 LOC 매수 체결로 본다 */
export function judgeBuyFill(limitPrice: number, closePrice: number): boolean {
  return closePrice <= limitPrice;
}

export interface SellPlan {
  /** 쿼터매도(보유의 1/4): 별지점 LOC 매도, T = 직전T * 0.75 */
  quarterSell: {
    limitPrice: number;
    qty: number;
  };
  /** 잔여(보유의 3/4): 평단 + 고정수익률 지정가 매도 (TQQQ +15% / SOXL +20%) */
  remainderSell: {
    limitPrice: number;
    qty: number;
    fixedRate: number;
  };
}

const FIXED_SELL_RATE: Record<Ticker, number> = { TQQQ: 15, SOXL: 20 };

/**
 * 2회차(T>=1)부터 매일 갱신하는 매도 계획.
 *  - 보유수량의 1/4: 별지점 LOC 매도(쿼터매도) → 체결 시 T = 직전T * 0.75
 *  - 보유수량의 3/4: 평단 + 고정 수익률 지정가 매도(잔여 지정가 매도) → T 변화 없음
 */
export function getSellPlan(ticker: Ticker, avgPrice: number, qty: number, starPoint: number): SellPlan {
  const fixedRate = FIXED_SELL_RATE[ticker];
  const quarterQty = roundQty(qty / 4);
  const remainderQty = roundQty(qty - quarterQty);
  return {
    quarterSell: {
      limitPrice: getSellTriggerPrice(starPoint),
      qty: quarterQty,
    },
    remainderSell: {
      limitPrice: Number((avgPrice * (1 + fixedRate / 100)).toFixed(2)),
      qty: remainderQty,
      fixedRate,
    },
  };
}

/** LOC 매도 자동 판단: 종가가 지정가 이상으로 마감되면 매도 체결로 본다 (LOC는 종가에 체결) */
export function judgeSellFill(limitPrice: number, closePrice: number): boolean {
  return closePrice >= limitPrice;
}

/**
 * 일반 지정가 매도 자동 판단 (잔여 지정가 매도용).
 * 지정가 주문은 종가와 무관하게 장중에 가격이 지정가에 닿으면 그 시점에 체결될 수 있다.
 * 장중 고가 데이터가 있으면 "고가 ≥ 지정가"로 장중 체결 가능성까지 포함해 판단하고,
 * 없으면(수동 입력 등) 종가 기준으로만 보수적으로 판단한다.
 */
export function judgeLimitSellFill(limitPrice: number, closePrice: number, dayHigh?: number | null): boolean {
  if (dayHigh != null) return dayHigh >= limitPrice;
  return judgeSellFill(limitPrice, closePrice);
}
