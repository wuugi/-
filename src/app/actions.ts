"use server";

import { db } from "@/db/client";
import { strategies, cycles, trades, holdingsDaily } from "@/db/schema";
import { eq, asc, desc } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { applyTDelta, type TradeKind } from "@/lib/lao-strategy";

const BUY_KINDS: TradeKind[] = ["first", "full", "half", "extra"];
const SELL_KINDS: TradeKind[] = ["quarterSell", "remainderSell"];

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

/** 새 전략을 등록하고 1번째 사이클(T=0)을 시작한다 */
export async function createStrategy(formData: FormData) {
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
    .values({ ticker, principal, splitCount, crashProtectionPct, createdAt: todayIso() })
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
    .where(eq(holdingsDaily.strategyId, strategyId))
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
  });

  // 전체 체결 내역으로 평단가/보유수량/예수금 재계산
  const allTrades = await db
    .select()
    .from(trades)
    .where(eq(trades.strategyId, strategyId))
    .orderBy(asc(trades.date), asc(trades.id));

  let qtyHeld = 0;
  let avgPrice = 0;
  let cashBalance = strategy.principal;

  for (const t of allTrades) {
    if (t.side === "buy") {
      const totalCost = avgPrice * qtyHeld + t.price * t.qty;
      qtyHeld += t.qty;
      avgPrice = qtyHeld > 0 ? totalCost / qtyHeld : 0;
      cashBalance -= t.price * t.qty;
    } else {
      qtyHeld -= t.qty;
      cashBalance += t.price * t.qty;
      if (qtyHeld <= 0) {
        qtyHeld = 0;
        avgPrice = 0;
      }
    }
  }

  await db.insert(holdingsDaily).values({
    strategyId,
    date,
    avgPrice,
    qty: qtyHeld,
    cashBalance,
    tValue: tAfter,
  });

  // 매도 체결로 보유 수량이 0이 되면 현재 사이클을 완료 처리하고 T=0인 새 사이클을 시작한다
  if (side === "sell" && qtyHeld === 0 && activeCycle) {
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

    await db.insert(holdingsDaily).values({
      strategyId,
      date,
      avgPrice: 0,
      qty: 0,
      cashBalance,
      tValue: 0,
    });
  }

  revalidatePath("/");
  revalidatePath(`/projects/${strategyId}`);
}
