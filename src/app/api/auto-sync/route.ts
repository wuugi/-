import { db } from "@/db/client";
import { strategies } from "@/db/schema";
import { fetchAndRecordPrice } from "@/app/actions-price";
import { autoRecordTodayFills } from "@/app/actions";

const SYNC_INTERVAL_MS = 3 * 60 * 60 * 1000;
let lastSyncedAt = 0;

function lastMarketCloseMs(): number {
  const now = Date.now();
  for (let daysAgo = 0; daysAgo <= 4; daysAgo++) {
    const d = new Date(now - daysAgo * 86400000);
    const dow = d.getUTCDay();
    if (dow === 0 || dow === 6) continue;
    const month = d.getUTCMonth() + 1;
    const isDst = month >= 3 && month <= 11;
    const closeHourUtc = isDst ? 20 : 21;
    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(d.getUTCDate()).padStart(2, "0");
    const closeMs = new Date(`${yyyy}-${mm}-${dd}T${String(closeHourUtc).padStart(2, "0")}:00:00Z`).getTime();
    if (closeMs <= now) return closeMs;
  }
  return 0;
}

export async function POST() {
  const recentClose = lastMarketCloseMs();
  const withinInterval = Date.now() - lastSyncedAt < SYNC_INTERVAL_MS;
  const syncedAfterClose = lastSyncedAt >= recentClose;
  if (withinInterval && syncedAfterClose) {
    return Response.json({ skipped: true, reason: "최근 장 마감 이후 이미 동기화를 시도했습니다." });
  }
  lastSyncedAt = Date.now();

  const allStrategies = await db.select().from(strategies);
  const tickers = [...new Set(allStrategies.map((s) => s.ticker))];

  const priceResults: Array<{ ticker: string; status: "ok" | "error"; message?: string }> = [];
  for (const ticker of tickers) {
    const fd = new FormData();
    fd.set("ticker", ticker);
    try {
      await fetchAndRecordPrice(fd);
      priceResults.push({ ticker, status: "ok" });
    } catch (e) {
      priceResults.push({ ticker, status: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }

  const fillResults: Array<{ strategyId: number; name: string | null; status: "ok" | "skipped"; message?: string }> = [];
  for (const strategy of allStrategies) {
    const fd = new FormData();
    fd.set("strategyId", String(strategy.id));
    try {
      await autoRecordTodayFills(fd);
      fillResults.push({ strategyId: strategy.id, name: strategy.name, status: "ok" });
    } catch (e) {
      fillResults.push({
        strategyId: strategy.id,
        name: strategy.name,
        status: "skipped",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return Response.json({ skipped: false, priceResults, fillResults });
}
