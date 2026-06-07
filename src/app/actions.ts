"use server";

import { db } from "@/db/client";
import { strategies, rounds, trades, holdingsDaily } from "@/db/schema";
import { eq, asc } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getPhase, getTargetRate } from "@/lib/lao-strategy";

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

/** 새 전략을 등록하고 1회차를 시작한다 */
export async function createStrategy(formData: FormData) {
  const ticker = String(formData.get("ticker") ?? "").trim();
  const principal = Number(formData.get("principal"));
  const splitCount = Number(formData.get("splitCount"));

  if (!ticker || !Number.isFinite(principal) || principal <= 0) {
    throw new Error("종목과 원금을 올바르게 입력하세요.");
  }
  if (![20, 40].includes(splitCount)) {
    throw new Error("분할 카운트는 20 또는 40이어야 합니다.");
  }

  const [strategy] = await db
    .insert(strategies)
    .values({ ticker, principal, splitCount, createdAt: todayIso() })
    .returning();

  await db.insert(rounds).values({
    strategyId: strategy.id,
    roundNo: 1,
    targetRate: getTargetRate(1, splitCount),
    phase: getPhase(1, splitCount),
    status: "진행중",
    startedAt: todayIso(),
  });

  revalidatePath("/");
}

/** 체결 기록을 추가하고 보유 현황(평단가/수량/예수금) 스냅샷을 갱신한다 */
export async function recordTrade(formData: FormData) {
  const strategyId = Number(formData.get("strategyId"));
  const side = String(formData.get("side"));
  const price = Number(formData.get("price"));
  const qty = Number(formData.get("qty"));
  const date = String(formData.get("date") || todayIso());

  if (!strategyId || (side !== "buy" && side !== "sell")) {
    throw new Error("입력값이 올바르지 않습니다.");
  }
  if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(qty) || qty <= 0) {
    throw new Error("가격과 수량은 0보다 큰 숫자여야 합니다.");
  }

  const strategy = await db.query.strategies.findFirst({
    where: eq(strategies.id, strategyId),
  });
  if (!strategy) throw new Error("전략을 찾을 수 없습니다.");

  const currentRound = await db.query.rounds.findFirst({
    where: eq(rounds.strategyId, strategyId),
    orderBy: [asc(rounds.roundNo)],
    // 가장 최근(최대 회차) 진행중 회차를 찾기 위해 정렬 후 아래에서 필터링
  });

  const allRounds = await db
    .select()
    .from(rounds)
    .where(eq(rounds.strategyId, strategyId))
    .orderBy(rounds.roundNo);
  const activeRound = [...allRounds].reverse().find((r) => r.status === "진행중") ?? currentRound;

  await db.insert(trades).values({
    strategyId,
    roundId: activeRound?.id ?? null,
    date,
    side,
    price,
    qty,
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

  const existingSnapshot = await db.query.holdingsDaily.findFirst({
    where: eq(holdingsDaily.strategyId, strategyId),
    orderBy: [asc(holdingsDaily.date)],
  });
  void existingSnapshot;

  await db.insert(holdingsDaily).values({
    strategyId,
    date,
    avgPrice,
    qty: qtyHeld,
    cashBalance,
  });

  // 매도 체결로 보유 수량이 0이 되면 현재 회차를 완료 처리하고 다음 회차를 시작한다
  if (side === "sell" && qtyHeld === 0 && activeRound) {
    await db
      .update(rounds)
      .set({ status: "완료", completedAt: date })
      .where(eq(rounds.id, activeRound.id));

    const nextRoundNo = activeRound.roundNo + 1;
    if (nextRoundNo <= strategy.splitCount) {
      await db.insert(rounds).values({
        strategyId,
        roundNo: nextRoundNo,
        targetRate: getTargetRate(nextRoundNo, strategy.splitCount),
        phase: getPhase(nextRoundNo, strategy.splitCount),
        status: "진행중",
        startedAt: date,
      });
    }
  }

  revalidatePath("/");
}
