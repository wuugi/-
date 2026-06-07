// 라오어의 무한매수법 핵심 계산 로직
//
// 주의: 아래 수식들은 공개된 무한매수법 가이드를 단순화한 근사치입니다.
// 실제 운용 전에는 본인의 기준에 맞게 targetRate / riskGauge 산식을 조정하세요.

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

export interface BuyPlanItem {
  label: "무릎" | "허벅지";
  price: number;
  qty: number;
}

/**
 * 오늘의 매수 계획: 1회차 예산을 무릎(전일 종가)/허벅지(전일 종가 대비 -3% 지정가)로 분할 매수.
 * 리스크 게이지가 높을수록(하락폭이 클수록) 허벅지 비중을 늘린다.
 */
export function getBuyPlan(
  principal: number,
  splitCount: number,
  prevClose: number,
  riskGauge: RiskGauge
): BuyPlanItem[] {
  const roundBudget = principal / splitCount;
  const thighRatio = riskGauge === 40 ? 0.6 : riskGauge === 30 ? 0.5 : 0.4;
  const kneeRatio = 1 - thighRatio;

  const kneePrice = Number(prevClose.toFixed(2));
  const thighPrice = Number((prevClose * 0.97).toFixed(2));

  return [
    {
      label: "무릎",
      price: kneePrice,
      qty: Number(((roundBudget * kneeRatio) / kneePrice).toFixed(4)),
    },
    {
      label: "허벅지",
      price: thighPrice,
      qty: Number(((roundBudget * thighRatio) / thighPrice).toFixed(4)),
    },
  ];
}

export interface SellPlan {
  sellPrice: number;
  sellQty: number;
}

/** 평단가에 목표 수익률을 더한 가격으로 보유 수량 전량 매도 지정가 산출 */
export function getSellPlan(avgPrice: number, qty: number, targetRate: number): SellPlan {
  return {
    sellPrice: Number((avgPrice * (1 + targetRate / 100)).toFixed(2)),
    sellQty: qty,
  };
}
