import { db } from "@/db/client";
import { strategies } from "@/db/schema";
import { fetchAndRecordPrice } from "@/app/actions-price";
import { autoRecordTodayFills } from "@/app/actions";
import { todayIsoKst } from "@/lib/market-date";

// 서버 인스턴스당 하루 한 번만 동기화하도록 막는 메모리 게이트.
// (콜드 스타트로 리셋돼도 actions 쪽이 "이미 기록됨"을 자체적으로 걸러주므로 안전하다)
let lastSyncedDate: string | null = null;

/**
 * 사용자가 사이트에 접속했을 때 클라이언트에서 호출하는 동기화 엔드포인트.
 * 1) 전략에 등록된 각 티커의 최근 종가를 자동 수집하고
 * 2) 각 전략에 대해 "오늘 체결 자동 기록"을 시도한다.
 * 휴장일·중복 기록·체결 없음 등은 actions 쪽에서 에러를 던지므로 결과만 모아 보고한다.
 */
export async function POST() {
  const today = todayIsoKst();
  if (lastSyncedDate === today) {
    return Response.json({ skipped: true, reason: "오늘은 이미 동기화를 시도했습니다." });
  }
  lastSyncedDate = today;

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
