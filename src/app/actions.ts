"use server";

import { db } from "@/db/client";
import { strategies, cycles, trades, holdingsDaily, priceSnapshots } from "@/db/schema";
import { and, eq, asc, desc, lt } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { isUsMarketTradingDay, todayIsoKst, usMarketCloseUtcMs } from "@/lib/market-date";
import {
  applyTDelta,
  detectCrashBigNumberBuy,
  detectSurgeForcedFirstBuy,
  getDailyBuyBudget,
  getFirstBuyLadder,
  getFirstHalfLadder,
  getPhase,
  getSecondHalfLadder,
  getSellPlan,
  getStarPercent,
  getStarPoint,
  judgeBuyFill,
  judgeLimitSellFill,
  judgeSellFill,
  type CrashProtectionPct,
  type LadderTier,
  type SpecialBuyPlan,
  type Ticker,
  type TradeKind,
} from "@/lib/lao-strategy";

const BUY_KINDS: TradeKind[] = ["first", "full", "half", "extra"];
const SELL_KINDS: TradeKind[] = ["quarterSell", "remainderSell"];

const todayIso = todayIsoKst;

/** 새 전략을 등록하고 1번째 사이클(T=0)을 시작한다 */
export async function createStrategy(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const ticker = String(formData.get("ticker") ?? "").trim();
  const principal = Number(formData.get("principal"));
  const splitCount = Number(formData.get("splitCount"));
  const crashProtectionPct = Number(formData.get("crashProtectionPct"));

  if (!["TQQQ", "SOXL"].includes(ticker)) {
    throw new Error("종목은 TQQQ 또는 SOXL이어야 합니다.");
  }
  if (!Number.isFinite(principal) || principal <= 0) {
    throw new Error("원금을 올바르게 입력하세요.");
  }
  if (![20, 40].includes(splitCount)) {
    throw new Error("분할 카운트는 20 또는 40이어야 합니다.");
  }
  if (![20, 30].includes(crashProtectionPct)) {
    throw new Error("폭락률 보호는 20% 또는 30%여야 합니다.");
  }

  const [strategy] = await db
    .insert(strategies)
    .values({ name: name || null, ticker, principal, splitCount, crashProtectionPct, createdAt: new Date().toISOString() })
    .returning();

  await db.insert(cycles).values({
    strategyId: strategy.id,
    cycleNo: 1,
    status: "진행중",
    startedAt: todayIso(),
  });

  await db.insert(holdingsDaily).values({
    strategyId: strategy.id,
    date: todayIso(),
    avgPrice: 0,
    qty: 0,
    cashBalance: principal,
    tValue: 0,
  });

  revalidatePath("/");
  redirect(`/projects/${strategy.id}`);
}

/** 폭락률 보호 구간(20%/30%)을 대시보드에서 수정한다 */
export async function updateCrashProtection(formData: FormData) {
  const strategyId = Number(formData.get("strategyId"));
  const crashProtectionPct = Number(formData.get("crashProtectionPct"));

  if (!strategyId) {
    throw new Error("전략을 찾을 수 없습니다.");
  }
  if (![20, 30].includes(crashProtectionPct)) {
    throw new Error("폭락률 보호는 20% 또는 30%여야 합니다.");
  }

  await db
    .update(strategies)
    .set({ crashProtectionPct })
    .where(eq(strategies.id, strategyId));

  revalidatePath("/");
  revalidatePath(`/projects/${strategyId}`);
}

/** 프로젝트(전략)와 연관된 사이클/체결/보유현황 기록을 모두 삭제한다 */
export async function deleteStrategy(formData: FormData) {
  const strategyId = Number(formData.get("strategyId"));
  if (!strategyId) {
    throw new Error("전략을 찾을 수 없습니다.");
  }

  await db.delete(trades).where(eq(trades.strategyId, strategyId));
  await db.delete(holdingsDaily).where(eq(holdingsDaily.strategyId, strategyId));
  await db.delete(cycles).where(eq(cycles.strategyId, strategyId));
  await db.delete(strategies).where(eq(strategies.id, strategyId));

  revalidatePath("/");
  redirect("/");
}

/**
 * 체결 기록을 추가하고 T값/보유 현황(평단가/수량/예수금) 스냅샷을 갱신한다.
 * tradeKind에 따라 T값이 변하며(applyTDelta), 매도로 보유수량이 0이 되면
 * 현재 사이클을 완료 처리하고 T=0인 새 사이클을 시작한다.
 */
export async function recordTrade(formData: FormData) {
  const strategyId = Number(formData.get("strategyId"));
  const side = String(formData.get("side"));
  const tradeKind = String(formData.get("tradeKind")) as TradeKind;
  const price = Number(formData.get("price"));
  const qty = Number(formData.get("qty"));
  const date = String(formData.get("date") || todayIso());
  const note = String(formData.get("note") ?? "").trim() || null;

  if (!strategyId || (side !== "buy" && side !== "sell")) {
    throw new Error("입력값이 올바르지 않습니다.");
  }
  if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(qty) || qty <= 0) {
    throw new Error("가격과 수량은 0보다 큰 숫자여야 합니다.");
  }
  if (side === "buy" && !BUY_KINDS.includes(tradeKind)) {
    throw new Error("매수 체결 종류가 올바르지 않습니다.");
  }
  if (side === "sell" && !SELL_KINDS.includes(tradeKind)) {
    throw new Error("매도 체결 종류가 올바르지 않습니다.");
  }

  const strategy = await db.query.strategies.findFirst({
    where: eq(strategies.id, strategyId),
  });
  if (!strategy) throw new Error("전략을 찾을 수 없습니다.");

  const allCycles = await db
    .select()
    .from(cycles)
    .where(eq(cycles.strategyId, strategyId))
    .orderBy(cycles.cycleNo);
  const activeCycle = [...allCycles].reverse().find((c) => c.status === "진행중") ?? null;

  const [latestHoldings] = await db
    .select()
    .from(holdingsDaily)
    .where(and(eq(holdingsDaily.strategyId, strategyId), lt(holdingsDaily.date, date)))
    .orderBy(desc(holdingsDaily.date), desc(holdingsDaily.id))
    .limit(1);

  const tBefore = latestHoldings?.tValue ?? 0;
  const tAfter = applyTDelta(tBefore, tradeKind);

  await db.insert(trades).values({
    strategyId,
    cycleId: activeCycle?.id ?? null,
    date,
    side,
    price,
    qty,
    tradeKind,
    tBefore,
    tAfter,
    note,
  });

  // 삽입 후 전체 replay: 과거 날짜 입력 등으로 T값 순서가 틀릴 수 있으므로 전체 재계산
  await replayTrades(strategyId);

  // 매도 체결로 보유 수량이 0이 되면 현재 사이클을 완료 처리하고 T=0인 새 사이클을 시작한다
  const [latestAfterReplay] = await db
    .select()
    .from(holdingsDaily)
    .where(eq(holdingsDaily.strategyId, strategyId))
    .orderBy(desc(holdingsDaily.date), desc(holdingsDaily.id))
    .limit(1);

  if (side === "sell" && (latestAfterReplay?.qty ?? 0) === 0 && activeCycle) {
    await db
      .update(cycles)
      .set({ status: "완료", completedAt: date })
      .where(eq(cycles.id, activeCycle.id));

    await db.insert(cycles).values({
      strategyId,
      cycleNo: activeCycle.cycleNo + 1,
      status: "진행중",
      startedAt: date,
    });
  }

  revalidatePath("/");
  revalidatePath(`/projects/${strategyId}`);
}

/**
 * 최근 종가를 기준으로 "오늘의 매수/매도 추천" 화면과 동일한 방식으로 LOC/지정가 체결 여부를 판단하고,
 * 체결로 판단된 만큼 자동으로 체결 기록을 추가한다 (이미 같은 날짜·종류로 기록된 건은 건너뛴다).
 *  - 매수 사다리: 종가 ≤ 지정가인 단계들의 수량을 합산해 1건으로 기록 (T값은 하루 1회 변화 기준)
 *  - 쿼터매도(LOC): 종가 ≥ 별지점이면 종가에 체결된 것으로 기록
 *  - 잔여 지정가 매도: 장중 고가 데이터가 있으면 고가 기준으로, 없으면 종가 기준으로 체결 가능성을 판단해
 *    지정가에 체결된 것으로 기록한다 (실제 체결가가 더 좋았을 수 있으므로 거래 입력에서 보정 가능)
 */
export async function autoRecordTodayFills(
  _prevState: { ok: boolean; message: string } | null,
  formData: FormData
): Promise<{ ok: boolean; message: string }> {
  const strategyId = Number(formData.get("strategyId"));
  if (!strategyId) return { ok: false, message: "전략을 찾을 수 없습니다." };

  const strategy = await db.query.strategies.findFirst({ where: eq(strategies.id, strategyId) });
  if (!strategy) return { ok: false, message: "전략을 찾을 수 없습니다." };

  const ticker = strategy.ticker as Ticker;
  const crashProtectionPct = strategy.crashProtectionPct as CrashProtectionPct;

  const [latestHoldings] = await db
    .select()
    .from(holdingsDaily)
    .where(eq(holdingsDaily.strategyId, strategyId))
    .orderBy(desc(holdingsDaily.id))
    .limit(1);

  const [latestPrice] = await db
    .select()
    .from(priceSnapshots)
    .where(eq(priceSnapshots.ticker, strategy.ticker))
    .orderBy(desc(priceSnapshots.date), desc(priceSnapshots.id))
    .limit(1);

  if (!latestPrice) {
    return { ok: false, message: "종가 데이터가 없습니다. 먼저 종가를 입력하세요." };
  }

  const avgPrice = latestHoldings?.avgPrice ?? 0;
  const qtyHeld = latestHoldings?.qty ?? 0;
  const cashBalance = latestHoldings?.cashBalance ?? strategy.principal;
  const tValue = latestHoldings?.tValue ?? 0;

  const date = latestPrice.date;

  // 전략 생성 시각(UTC)이 해당 거래일의 장 마감(4 PM ET) 이후면 그날 체결이 불가능하다.
  // createdAt이 날짜만 있는 구 형식(예: "2026-06-08")이면 00:00 UTC로 파싱해
  // "장 열리기 전 생성"으로 간주한다(안전한 방향).
  const createdAtMs = new Date(strategy.createdAt).getTime();
  const marketCloseMs = usMarketCloseUtcMs(date);
  if (createdAtMs > marketCloseMs) {
    return { ok: true, message: "전략 생성일 이후 첫 장이 아직 마감되지 않아 건너뜁니다." };
  }

  if (!isUsMarketTradingDay(date)) {
    return { ok: true, message: "휴장일입니다." };
  }

  const closePrice = latestPrice.closePrice;
  const dayHigh = latestPrice.dayHigh ?? null;

  // 사다리의 기준이 되는 "전일 종가"는 오늘(latestPrice.date) 종가와는 별개로,
  // 그 직전 거래일의 종가여야 한다 (같은 값을 쓰면 "종가가 전일종가의 +N% 이내"라는
  // 사다리/큰수 판정이 항상 자명하게 참이 되어 버린다).
  const [prevPriceSnapshot] = await db
    .select()
    .from(priceSnapshots)
    .where(and(eq(priceSnapshots.ticker, strategy.ticker), lt(priceSnapshots.date, date)))
    .orderBy(desc(priceSnapshots.date), desc(priceSnapshots.id))
    .limit(1);

  if (!prevPriceSnapshot) {
    return { ok: false, message: `${date} 기준 전일 종가(${date} 이전 날짜)가 없습니다. 종가 입력 폼에서 직전 거래일 종가를 먼저 입력하세요.` };
  }

  const prevClose = prevPriceSnapshot.closePrice;

  const phase = getPhase(tValue, strategy.splitCount);
  const starPercent = getStarPercent(ticker, strategy.splitCount, tValue);
  const starPoint = avgPrice > 0 ? getStarPoint(avgPrice, starPercent) : null;
  const dailyBudget = getDailyBuyBudget(tValue, strategy.splitCount, strategy.principal, cashBalance);

  let buyLadder: LadderTier[] = [];
  let crashBigNumber: SpecialBuyPlan | null = null;
  if (prevClose > 0) {
    if (tValue <= 0) {
      buyLadder = getFirstBuyLadder(prevClose, dailyBudget, crashProtectionPct);
    } else if (starPoint !== null) {
      // 폭락으로 별지점과 종가의 괴리가 폭락률 보호 구간을 넘으면 정상 사다리 대신 큰수 매수로 통합
      crashBigNumber = detectCrashBigNumberBuy(prevClose, starPoint, dailyBudget, crashProtectionPct);
      if (!crashBigNumber) {
        buyLadder =
          phase === "전반전" && avgPrice > 0
            ? getFirstHalfLadder(avgPrice, starPoint, prevClose, dailyBudget, crashProtectionPct)
            : getSecondHalfLadder(starPoint, prevClose, dailyBudget, crashProtectionPct);
      }
    }
  }

  const sellPlan =
    tValue >= 1 && qtyHeld > 0 && avgPrice > 0 && starPoint !== null
      ? getSellPlan(ticker, avgPrice, qtyHeld, starPoint)
      : null;

  // 같은 날짜에 이미 (수동/자동) 기록이 있으면 자동 기록을 건너뛴다.
  // T값/평단가 등은 하루에 한 번만 변하므로, 재실행 시 변경된 상태로 사다리를
  // 다시 계산해 같은 종가에 대해 또 다른 "체결"을 만들어내는 연쇄 오기록을 막기 위함이다.
  const existingTradesForDate = await db
    .select()
    .from(trades)
    .where(and(eq(trades.strategyId, strategyId), eq(trades.date, date)));
  if (existingTradesForDate.length > 0) {
    return { ok: true, message: `${date} 날짜에 이미 기록된 체결이 있습니다.` };
  }

  const planned: Array<{ side: "buy" | "sell"; tradeKind: TradeKind; qty: number; price: number; note?: string }> = [];

  let filledBuyQty = 0;
  let buyNote: string | undefined;

  if (crashBigNumber) {
    // 폭락 대응 큰수 매수: 종가가 큰수 지정가 이하로 마감되면 통합 LOC 매수로 체결
    if (judgeBuyFill(crashBigNumber.limitPrice, closePrice) && crashBigNumber.qty > 0) {
      filledBuyQty = crashBigNumber.qty;
      buyNote = crashBigNumber.note;
    }
  } else {
    filledBuyQty = buyLadder
      .filter((tier) => judgeBuyFill(tier.limitPrice, closePrice))
      .reduce((sum, tier) => sum + Math.max(Math.round(tier.qty), 0), 0);

    // 갭상승 대응: 첫 매수(T=0) 사다리의 가장 높은 큰수보다 종가가 더 높게 마감해
    // 정상 사다리로는 하나도 체결되지 않는다면, "처음 매수는 무조건 매수" 원칙에 따라
    // 종가 기준 전액 매수로 자동 보정한다.
    if (tValue <= 0 && filledBuyQty === 0 && buyLadder.length > 0) {
      const surgeBuy = detectSurgeForcedFirstBuy(closePrice, buyLadder, dailyBudget);
      if (surgeBuy) {
        filledBuyQty = surgeBuy.qty;
        buyNote = surgeBuy.note;
      }
    }
  }

  if (filledBuyQty > 0) {
    let buyKind: TradeKind;
    if (tValue <= 0) {
      buyKind = "first";
    } else if (crashBigNumber) {
      buyKind = "full";
    } else {
      // 전반전 사다리: 평단가 LOC(level 2)가 체결됐으면 full(T+1), 별지점만이면 half(T+0.5)
      const avgTierFilled = buyLadder.some((tier) => tier.level === 2 && judgeBuyFill(tier.limitPrice, closePrice));
      buyKind = avgTierFilled ? "full" : "half";
    }
    planned.push({ side: "buy", tradeKind: buyKind, qty: filledBuyQty, price: closePrice, note: buyNote });
  }

  if (sellPlan) {
    if (judgeSellFill(sellPlan.quarterSell.limitPrice, closePrice) && sellPlan.quarterSell.qty > 0) {
      planned.push({
        side: "sell",
        tradeKind: "quarterSell",
        qty: sellPlan.quarterSell.qty,
        price: closePrice,
      });
    }
    if (
      judgeLimitSellFill(sellPlan.remainderSell.limitPrice, closePrice, dayHigh) &&
      sellPlan.remainderSell.qty > 0
    ) {
      planned.push({
        side: "sell",
        tradeKind: "remainderSell",
        qty: sellPlan.remainderSell.qty,
        price: sellPlan.remainderSell.limitPrice,
      });
    }
  }

  if (planned.length === 0) {
    return { ok: true, message: `${date} 종가($${closePrice})가 어떤 지정가에도 닿지 않아 체결 없음으로 처리됩니다.` };
  }

  for (const p of planned) {
    const fd = new FormData();
    fd.set("strategyId", String(strategyId));
    fd.set("side", p.side);
    fd.set("tradeKind", p.tradeKind);
    fd.set("price", String(p.price));
    fd.set("qty", String(p.qty));
    fd.set("date", date);
    if (p.note) fd.set("note", p.note);
    await recordTrade(fd);
  }
  return { ok: true, message: `${date} 체결 ${planned.length}건 기록 완료.` };
}

/**
 * 체결 기록 1건을 삭제하고, 해당 전략의 모든 trades T값과 holdingsDaily를 처음부터 재계산한다.
 */
export async function deleteTrade(formData: FormData) {
  const tradeId = Number(formData.get("tradeId"));
  const strategyId = Number(formData.get("strategyId"));
  if (!tradeId || !strategyId) throw new Error("잘못된 요청");

  await db.delete(trades).where(and(eq(trades.id, tradeId), eq(trades.strategyId, strategyId)));

  await replayTrades(strategyId);

  revalidatePath("/");
  revalidatePath(`/projects/${strategyId}`);
}

/**
 * 전략의 모든 체결 기록을 날짜·id 순으로 replay해
 * trades.tBefore/tAfter와 holdingsDaily를 처음부터 재계산한다.
 */
async function replayTrades(strategyId: number) {
  const strategy = await db.query.strategies.findFirst({ where: eq(strategies.id, strategyId) });
  if (!strategy) throw new Error("전략 없음");

  await db.delete(holdingsDaily).where(eq(holdingsDaily.strategyId, strategyId));

  const allTrades = await db.select().from(trades)
    .where(eq(trades.strategyId, strategyId))
    .orderBy(asc(trades.date), asc(trades.id));

  let avgPrice = 0;
  let qtyHeld = 0;
  let cashBalance = strategy.principal;
  let tValue = 0;

  for (const t of allTrades) {
    const tBefore = tValue;
    const tAfter = applyTDelta(tBefore, t.tradeKind as TradeKind);
    tValue = tAfter;

    // trades 테이블의 T값도 정확하게 업데이트
    await db.update(trades).set({ tBefore, tAfter }).where(eq(trades.id, t.id));

    if (t.side === "buy") {
      const totalCost = avgPrice * qtyHeld + t.price * t.qty;
      qtyHeld += t.qty;
      avgPrice = qtyHeld > 0 ? totalCost / qtyHeld : 0;
      cashBalance -= t.price * t.qty;
    } else {
      qtyHeld -= t.qty;
      cashBalance += t.price * t.qty;
      if (qtyHeld <= 0) { qtyHeld = 0; avgPrice = 0; }
    }

    await db.insert(holdingsDaily).values({
      strategyId,
      date: t.date,
      avgPrice,
      qty: qtyHeld,
      cashBalance,
      tValue: tAfter,
    });
  }
}
