import { db } from "@/db/client";
import { strategies, cycles, trades, priceSnapshots, holdingsDaily } from "@/db/schema";
import { desc, eq } from "drizzle-orm";

/** 가장 최근에 등록된 전략을 대시보드의 활성 전략으로 사용 */
export async function getActiveStrategy() {
  const rows = await db.select().from(strategies).orderBy(desc(strategies.id)).limit(1);
  return rows[0] ?? null;
}

export async function getCyclesByStrategy(strategyId: number) {
  return db
    .select()
    .from(cycles)
    .where(eq(cycles.strategyId, strategyId))
    .orderBy(cycles.cycleNo);
}

export async function getCurrentCycle(strategyId: number) {
  const rows = await db
    .select()
    .from(cycles)
    .where(eq(cycles.strategyId, strategyId))
    .orderBy(desc(cycles.cycleNo))
    .limit(1);
  return rows[0] ?? null;
}

export async function getLatestHoldings(strategyId: number) {
  const rows = await db
    .select()
    .from(holdingsDaily)
    .where(eq(holdingsDaily.strategyId, strategyId))
    .orderBy(desc(holdingsDaily.date), desc(holdingsDaily.id))
    .limit(1);
  return rows[0] ?? null;
}

export async function getTradesByStrategy(strategyId: number) {
  return db
    .select()
    .from(trades)
    .where(eq(trades.strategyId, strategyId))
    .orderBy(desc(trades.date), desc(trades.id));
}

export async function getRecentPriceSnapshots(ticker: string, limit = 30) {
  return db
    .select()
    .from(priceSnapshots)
    .where(eq(priceSnapshots.ticker, ticker))
    .orderBy(desc(priceSnapshots.date))
    .limit(limit);
}
