import { db } from "@/db/client";
import { strategies } from "@/db/schema";
import { fetchAndRecordPrice } from "@/app/actions-price";
import { autoRecordTodayFills } from "@/app/actions";
// 서버 인스턴스당 3시간에 한 번만 동기화하도록 막는 메모리 게이트.
// Vercel 서버리스 환경에선 콜드 스타트로 리셋될 수 있지만, actions 쪽이 "이미
// 기록됨" 체크를 DB 수준에서 처리하므로 중복 기록은 발생하지 않는다.
const SYNC_INTERVAL_MS = 3 * 60 * 60 * 1000;
let lastSyncedAt = 0;

/**
 * 사용자가 사이트에 접속했을 때 클라이언트에서 호출하는 동기화 엔드포인트.
 * 1) 전략에 등록된 각 티커의 최근 종가를 자동 수집하고
 * 2) 각 전략에 대해 "오늘 체결 자동 기록"을 시도한다.
 * 휴장일·중복 기록·체결 없음 등은 actions 쪽에서 에러를 던지므로 결과만 모아 보고한다.
 */
export async function POST() {
  if (Date.now() - lastSyncedAt < SYNC_INTERVAL_MS) {
    return Response.json({ skipped: true, reason: "최근 3시간 내에 이미 동기화를 시도했습니다." });
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
