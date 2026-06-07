import { db } from "@/db/client";
import { strategies, cycles, trades, priceSnapshots, holdingsDaily } from "@/db/schema";
import { desc, eq } from "drizzle-orm";

export async function getStrategyById(strategyId: number) {
  const rows = await db.select().from(strategies).where(eq(strategies.id, strategyId)).limit(1);
  return rows[0] ?? null;
}

/** 홈 화면에 표시할 전체 프로젝트(전략) 목록과 각 프로젝트의 현재 진행 상황 요약 */
export async function getStrategySummaries() {
  const allStrategies = await db.select().from(strategies).orderBy(desc(strategies.id));

  return Promise.all(
    allStrategies.map(async (strategy) => {
      const [currentCycle] = await db
        .select()
        .from(cycles)
        .where(eq(cycles.strategyId, strategy.id))
        .orderBy(desc(cycles.cycleNo))
        .limit(1);

      const [holdings] = await db
        .select()
        .from(holdingsDaily)
        .where(eq(holdingsDaily.strategyId, strategy.id))
        .orderBy(desc(holdingsDaily.date), desc(holdingsDaily.id))
        .limit(1);

      return { strategy, currentCycle: currentCycle ?? null, holdings: holdings ?? null };
    })
  );
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
