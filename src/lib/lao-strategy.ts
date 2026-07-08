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
  /** 해당 단계에서 매수할 주식 수 (반올림된 표시용) */
  qty: number;
  /** 해당 단계에 배정된 예산 (체결 수량 역산용 — 단계별 반올림 오차를 피하기 위해 사용) */
  budget: number;
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
  label: string,
  budgetEach = 0
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
      budget: budgetEach,
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
  const bigNumberBudget = dailyBudget / 2;
  const bigNumberQty = roundQty(bigNumberBudget / bigNumberPrice);
  const stepBudget = dailyBudget / 2 / 4;
  const stepQty = roundQty(stepBudget / prevClose);
  const stepPct = getStepPct(crashProtectionPct, 4);
  return [
    { level: 0, dropPct: -12, limitPrice: bigNumberPrice, qty: bigNumberQty, budget: bigNumberBudget, label: "큰수 매수(시초가 갭상승 대비)" },
    ...buildStepDownLadder(prevClose, 1, stepQty, 4, stepPct, `단계별 하락 매수(폭락률 보호 ${crashProtectionPct}% 구간)`, stepBudget),
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
  const starBudget = half / 2;
  const avgBudget = half / 2;
  const stepBudget = half / 2 / 3;
  const starQty = roundQty(starBudget / buyTrigger);
  const avgQty = roundQty(avgBudget / avgPrice);
  const stepQty = roundQty(stepBudget / prevClose);
  const stepPct = getStepPct(crashProtectionPct, 3);
  return [
    { level: 1, dropPct: 0, limitPrice: buyTrigger, qty: starQty, budget: starBudget, label: "별지점 LOC 매수" },
    { level: 2, dropPct: 0, limitPrice: avgPrice, qty: avgQty, budget: avgBudget, label: "평단가 LOC 매수" },
    ...buildStepDownLadder(prevClose, 3, stepQty, 3, stepPct, `단계별 하락 매수(폭락률 보호 ${crashProtectionPct}% 구간)`, stepBudget),
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
  const starBudget = dailyBudget / 2;
  const stepBudget = dailyBudget / 2 / 4;
  const starQty = roundQty(starBudget / buyTrigger);
  const stepQty = roundQty(stepBudget / prevClose);
  const stepPct = getStepPct(crashProtectionPct, 4);
  return [
    { level: 1, dropPct: 0, limitPrice: buyTrigger, qty: starQty, budget: starBudget, label: "별지점 LOC 매수" },
    ...buildStepDownLadder(prevClose, 2, stepQty, 4, stepPct, `단계별 하락 매수(폭락률 보호 ${crashProtectionPct}% 구간)`, stepBudget),
  ];
}

/** 종가가 단계별 지정가 이하로 마감되면 해당 단계는 LOC 매수 체결로 본다 */
export function judgeBuyFill(limitPrice: number, closePrice: number): boolean {
  return closePrice <= limitPrice;
}

export interface SpecialBuyPlan {
  /** 통합 매수 LOC 지정가 */
  limitPrice: number;
  /** 통합 매수 수량 */
  qty: number;
  /** 자동 판단 사유 (체결 기록의 "특이사항" 태그로 남는다) */
  note: string;
}

/**
 * 폭락 대응 "큰수 매수" 자동 판단 (라오어 4.0 카페 공지 <큰수 매수 정리> 기준).
 *
 * 사이클 중간에 폭락으로 별지점/평단과 전일 종가의 괴리가 폭락률 보호 구간(%)을 넘으면,
 * 별지점 근처에 거는 정상 사다리 가격은 전일 종가와 너무 멀어 증권사 시스템에서
 * 주문 오류로 거부될 수 있다. 이런 경우 "별가격 아래에서 무조건 매수"를 의도하기 위해
 * 사다리 예산 전체를 전일 종가보다 적당히 큰 수(괴리율의 절반, 5~20% 사이)만큼
 * 위에 잡은 단일 LOC 매수로 통합한다. 괴리가 클수록 더 큰 수를, 작을수록 더 작은 수를
 * 선택해 거부 범위를 피하면서도 별지점 아래 체결을 보장한다.
 */
export function detectCrashBigNumberBuy(
  prevClose: number,
  targetPrice: number,
  dailyBudget: number,
  crashProtectionPct: CrashProtectionPct
): SpecialBuyPlan | null {
  if (prevClose <= 0 || targetPrice <= 0 || dailyBudget <= 0) return null;

  const gapPct = ((targetPrice - prevClose) / prevClose) * 100;
  if (gapPct <= crashProtectionPct) return null;

  const bigNumberPct = Math.min(20, Math.max(5, Number((gapPct / 2).toFixed(2))));
  const limitPrice = Number((prevClose * (1 + bigNumberPct / 100)).toFixed(2));
  const qty = roundQty(dailyBudget / limitPrice);
  if (qty <= 0) return null;

  return {
    limitPrice,
    qty,
    note: `[특이사항] 폭락 대응 큰수 매수 — 별지점 대비 종가 괴리 ${gapPct.toFixed(1)}%가 폭락률 보호 구간(${crashProtectionPct}%)을 초과해, 사다리 매수를 종가 +${bigNumberPct}% 큰수(${limitPrice}) LOC 매수로 통합 체결`,
  };
}

/**
 * 갭상승 대응 "큰수 매수" 자동 판단.
 *
 * 새 사이클 시작(T=0)의 큰수 사다리는 "처음 매수는 무조건 매수"를 의도하므로,
 * 종가가 사다리의 가장 높은 지정가(보통 전일 종가 +12%)보다도 더 높게 마감되면
 * (예상보다 큰 갭상승) 정상 사다리로는 그 의도가 깨진다. 이 경우 종가 기준으로
 * 일일 매수금 전액을 단일 매수로 체결한 것으로 간주해 "처음 매수는 무조건 매수"
 * 원칙을 지킨다.
 */
export function detectSurgeForcedFirstBuy(
  closePrice: number,
  ladder: LadderTier[],
  dailyBudget: number
): SpecialBuyPlan | null {
  if (ladder.length === 0 || closePrice <= 0 || dailyBudget <= 0) return null;

  const maxLimit = Math.max(...ladder.map((t) => t.limitPrice));
  if (closePrice <= maxLimit) return null;

  const gapPct = ((closePrice - maxLimit) / maxLimit) * 100;
  const qty = roundQty(dailyBudget / closePrice);
  if (qty <= 0) return null;

  return {
    limitPrice: closePrice,
    qty,
    note: `[특이사항] 갭상승 대응 큰수 매수 — 예상 큰수(${maxLimit})보다 종가가 ${gapPct.toFixed(1)}% 더 높게 마감해, "첫 매수는 무조건 매수" 원칙에 따라 종가(${closePrice}) 기준 전액 매수로 체결`,
  };
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
