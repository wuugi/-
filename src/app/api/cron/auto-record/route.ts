import { db } from "@/db/client";
import { strategies } from "@/db/schema";
import { fetchAndRecordPrice } from "@/app/actions-price";
import { autoRecordTodayFills } from "@/app/actions";

/**
 * 매 영업일 미국 장 마감 후 호출되는 크론 엔드포인트.
 * 1) 전략에 등록된 각 티커의 최근 종가를 자동 수집하고
 * 2) 각 전략에 대해 "오늘 체결 자동 기록"을 시도한다.
 * 휴장일·중복 기록·체결 없음 등은 actions 쪽에서 에러를 던지므로 결과만 모아 보고한다.
 */
export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${cronSecret}`) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

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

  return Response.json({ priceResults, fillResults });
}
