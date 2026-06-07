import { createStrategy, recordTrade } from "./actions";
import { recordPriceSnapshot } from "./actions-price";
import {
  getActiveStrategy,
  getCurrentRound,
  getLatestHoldings,
  getRecentPriceSnapshots,
  getRoundsByStrategy,
  getTradesByStrategy,
} from "@/lib/queries";
import {
  getBuyLadder,
  getMovingAverage,
  getRiskGauge,
  getSellRecommendation,
  judgeBuyLadderFills,
  judgeSellFill,
  type RiskGauge,
} from "@/lib/lao-strategy";

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function fmt(n: number, digits = 2) {
  return n.toLocaleString("ko-KR", { maximumFractionDigits: digits });
}

export default async function Home() {
  const strategy = await getActiveStrategy();

  if (!strategy) {
    return (
      <div className="mx-auto w-full max-w-md px-6 py-16">
        <h1 className="mb-6 text-2xl font-bold">라오어의 무한매수법 - 전략 등록</h1>
        <form action={createStrategy} className="flex flex-col gap-4">
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium">종목 (예: TQQQ, SOXL)</span>
            <input
              name="ticker"
              required
              className="rounded border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
              placeholder="TQQQ"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium">원금 ($)</span>
            <input
              type="number"
              name="principal"
              required
              min={0}
              step="0.01"
              className="rounded border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
              placeholder="10000"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium">분할 카운트</span>
            <select
              name="splitCount"
              required
              className="rounded border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
            >
              <option value="20">20회차</option>
              <option value="40">40회차</option>
            </select>
          </label>
          <button
            type="submit"
            className="mt-2 rounded bg-foreground px-4 py-2 font-medium text-background"
          >
            전략 시작하기
          </button>
        </form>
      </div>
    );
  }

  const [currentRound, holdings, allRounds, allTrades, recentPrices] = await Promise.all([
    getCurrentRound(strategy.id),
    getLatestHoldings(strategy.id),
    getRoundsByStrategy(strategy.id),
    getTradesByStrategy(strategy.id),
    getRecentPriceSnapshots(strategy.ticker, 30),
  ]);

  const avgPrice = holdings?.avgPrice ?? 0;
  const qty = holdings?.qty ?? 0;
  const cashBalance = holdings?.cashBalance ?? strategy.principal;

  const sortedPrices = [...recentPrices].sort((a, b) => (a.date < b.date ? -1 : 1));
  const latestPrice = sortedPrices.at(-1);
  const recentHigh = sortedPrices.reduce((max, p) => Math.max(max, p.closePrice), 0);

  const closeSeries = sortedPrices.map((p) => p.closePrice);
  const movingAverage = getMovingAverage(closeSeries, 5);

  let riskGauge: RiskGauge | null = null;
  let buyLadder: ReturnType<typeof judgeBuyLadderFills> | null = null;
  let sellRecommendation: ReturnType<typeof getSellRecommendation> | null = null;

  if (latestPrice && currentRound) {
    riskGauge = getRiskGauge(latestPrice.closePrice, recentHigh || latestPrice.closePrice);
    const ladder = getBuyLadder(latestPrice.closePrice, riskGauge);
    buyLadder = judgeBuyLadderFills(ladder, latestPrice.closePrice);
    if (qty > 0 && avgPrice > 0 && currentRound.roundNo >= 2) {
      sellRecommendation = getSellRecommendation(
        avgPrice,
        qty,
        currentRound.targetRate,
        latestPrice.closePrice,
        movingAverage
      );
    }
  }

  return (
    <div className="mx-auto w-full max-w-4xl px-6 py-10">
      <header className="mb-8 flex items-baseline justify-between">
        <h1 className="text-2xl font-bold">
          {strategy.ticker} 무한매수법 대시보드
        </h1>
        <span className="text-sm text-zinc-500">원금 ${fmt(strategy.principal, 0)}</span>
      </header>

      {/* 현재 상태 요약 */}
      <section className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard label="회차" value={currentRound ? `${currentRound.roundNo} / ${strategy.splitCount}` : "-"} />
        <StatCard label="원금" value={`$${fmt(strategy.principal, 0)}`} />
        <StatCard label="분할카운트" value={`${strategy.splitCount}`} />
        <StatCard label="전후반전" value={currentRound?.phase ?? "-"} />
        <StatCard label="평단가" value={avgPrice > 0 ? `$${fmt(avgPrice)}` : "-"} />
        <StatCard label="보유수량" value={qty > 0 ? fmt(qty, 4) : "0"} />
      </section>

      <div className="mb-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* 오늘의 매수/매도 추천 */}
        <section className="rounded-lg border border-zinc-200 p-5 dark:border-zinc-800">
          <h2 className="mb-3 text-lg font-semibold">오늘의 매수/매도 추천</h2>
          {!latestPrice ? (
            <p className="text-sm text-zinc-500">
              종가 데이터가 없습니다. 아래에서 오늘 종가를 입력하면 추천이 계산됩니다.
            </p>
          ) : (
            <div className="flex flex-col gap-4 text-sm">
              <div>
                <h3 className="mb-1 font-medium">
                  폭락률 단계별 LOC 매수 사다리 (전일 종가 ${fmt(latestPrice.closePrice)} 기준)
                </h3>
                <table className="w-full overflow-hidden rounded text-xs">
                  <thead className="bg-zinc-100 text-left dark:bg-zinc-900">
                    <tr>
                      <th className="whitespace-nowrap px-2 py-1.5">단계</th>
                      <th className="whitespace-nowrap px-2 py-1.5">하락률</th>
                      <th className="whitespace-nowrap px-2 py-1.5">LOC 지정가</th>
                      <th className="whitespace-nowrap px-2 py-1.5">매수 수량</th>
                      <th className="whitespace-nowrap px-2 py-1.5">자동 판단</th>
                    </tr>
                  </thead>
                  <tbody>
                    {buyLadder?.map((tier) => (
                      <tr key={tier.level} className="border-t border-zinc-200 dark:border-zinc-800">
                        <td className="whitespace-nowrap px-2 py-1.5">{tier.level}단계</td>
                        <td className="whitespace-nowrap px-2 py-1.5">-{tier.dropPct}%</td>
                        <td className="whitespace-nowrap px-2 py-1.5">${fmt(tier.limitPrice)}</td>
                        <td className="whitespace-nowrap px-2 py-1.5">{fmt(tier.qty)}주</td>
                        <td className="px-2 py-1.5">
                          <span
                            className={`rounded-full px-2 py-0.5 text-xs ${
                              tier.filled
                                ? "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300"
                                : "bg-zinc-200 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
                            }`}
                          >
                            {tier.filled ? "체결 (종가 ≤ 지정가)" : "미체결"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="mt-1 text-xs text-zinc-500">
                  평단가 ${avgPrice > 0 ? fmt(avgPrice) : "-"} · 1회차 예산 ${fmt(strategy.principal / strategy.splitCount)} ·
                  최근 입력된 종가를 기준으로 각 단계의 LOC 매수 체결 여부를 자동 판단합니다 (종가 ≤ 지정가 → 체결).
                </p>
              </div>
              <div>
                <h3 className="mb-1 font-medium">매도 추천 (2회차부터 매일 AFTER 지정가 갱신)</h3>
                {currentRound && currentRound.roundNo < 2 ? (
                  <p className="text-zinc-500">1회차는 매도 지정가를 걸지 않습니다. 2회차부터 매일 갱신됩니다.</p>
                ) : sellRecommendation ? (
                  <div className="flex flex-col gap-1.5 rounded bg-zinc-100 px-3 py-2 dark:bg-zinc-900">
                    <p>
                      목표가 <span className="font-semibold">${fmt(sellRecommendation.limitPrice)}</span> (조정된 목표 수익률{" "}
                      {sellRecommendation.adjustedTargetRate}%, 회차 기준 {currentRound?.targetRate}%)에 보유{" "}
                      {fmt(sellRecommendation.qty, 4)}주 전량 AFTER 지정가 매도 권장
                    </p>
                    <p className="text-xs text-zinc-500">
                      추세 판단: <span className="font-medium">{sellRecommendation.trend}</span>
                      {movingAverage !== null && <> (5일 이동평균 ${fmt(movingAverage)} 대비)</>} ·{" "}
                      {sellRecommendation.trend === "하락"
                        ? "하락 추세에서는 회전율을 높이기 위해 목표 수익률을 낮춰 지정가를 잡습니다."
                        : "상승/횡보 추세에서는 회차 목표 수익률을 그대로 유지합니다."}
                    </p>
                    {latestPrice && (
                      <p className="text-xs">
                        자동 판단:{" "}
                        <span
                          className={`rounded-full px-2 py-0.5 ${
                            judgeSellFill(sellRecommendation.limitPrice, latestPrice.closePrice)
                              ? "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300"
                              : "bg-zinc-200 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
                          }`}
                        >
                          {judgeSellFill(sellRecommendation.limitPrice, latestPrice.closePrice)
                            ? "체결 (종가 ≥ 지정가)"
                            : "미체결"}
                        </span>
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="text-zinc-500">보유 수량이 없어 매도 추천이 없습니다.</p>
                )}
              </div>
            </div>
          )}

          <form action={recordPriceSnapshot} className="mt-4 flex flex-wrap items-end gap-2 border-t border-zinc-200 pt-4 dark:border-zinc-800">
            <input type="hidden" name="ticker" value={strategy.ticker} />
            <label className="flex flex-1 flex-col gap-1 text-sm">
              <span>날짜</span>
              <input
                type="date"
                name="date"
                defaultValue={todayIso()}
                required
                className="rounded border border-zinc-300 px-2 py-1.5 dark:border-zinc-700 dark:bg-zinc-900"
              />
            </label>
            <label className="flex flex-1 flex-col gap-1 text-sm">
              <span>종가 ($)</span>
              <input
                type="number"
                name="closePrice"
                step="0.01"
                min={0}
                required
                className="rounded border border-zinc-300 px-2 py-1.5 dark:border-zinc-700 dark:bg-zinc-900"
              />
            </label>
            <button type="submit" className="shrink-0 whitespace-nowrap rounded bg-foreground px-3 py-1.5 text-sm font-medium text-background">
              종가 입력
            </button>
          </form>
        </section>

        {/* 리스크 게이지 */}
        <section className="rounded-lg border border-zinc-200 p-5 dark:border-zinc-800">
          <h2 className="mb-3 text-lg font-semibold">리스크 게이지</h2>
          {riskGauge ? (
            <div className="flex flex-col gap-3">
              <div className="flex h-3 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
                <div
                  className={`h-full transition-all ${
                    riskGauge === 40 ? "bg-red-500" : riskGauge === 30 ? "bg-amber-500" : "bg-emerald-500"
                  }`}
                  style={{ width: `${(riskGauge / 40) * 100}%` }}
                />
              </div>
              <div className="flex justify-between text-xs text-zinc-500">
                <span>20단계 (안정)</span>
                <span>30단계 (주의)</span>
                <span>40단계 (위험)</span>
              </div>
              <p className="text-sm">
                현재 게이지: <span className="font-semibold">{riskGauge}단계</span>
                {recentHigh > 0 && latestPrice && (
                  <>
                    {" "}
                    (최근 고점 대비 {fmt(((recentHigh - latestPrice.closePrice) / recentHigh) * 100)}% 하락)
                  </>
                )}
              </p>
            </div>
          ) : (
            <p className="text-sm text-zinc-500">종가 데이터를 입력하면 리스크 게이지가 표시됩니다.</p>
          )}
        </section>
      </div>

      {/* 회차별 운용 내역 */}
      <section className="mb-8">
        <h2 className="mb-3 text-lg font-semibold">회차별 운용 내역</h2>
        <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-sm">
            <thead className="bg-zinc-100 text-left dark:bg-zinc-900">
              <tr>
                <th className="px-3 py-2">회차</th>
                <th className="px-3 py-2">전후반전</th>
                <th className="px-3 py-2">목표 수익률</th>
                <th className="px-3 py-2">상태</th>
                <th className="px-3 py-2">시작일</th>
                <th className="px-3 py-2">완료일</th>
              </tr>
            </thead>
            <tbody>
              {allRounds.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-4 text-center text-zinc-500">
                    회차 정보가 없습니다.
                  </td>
                </tr>
              ) : (
                [...allRounds].reverse().map((r) => (
                  <tr key={r.id} className="border-t border-zinc-200 dark:border-zinc-800">
                    <td className="px-3 py-2">{r.roundNo}</td>
                    <td className="px-3 py-2">{r.phase}</td>
                    <td className="px-3 py-2">{r.targetRate}%</td>
                    <td className="px-3 py-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs ${
                          r.status === "진행중"
                            ? "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300"
                            : "bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
                        }`}
                      >
                        {r.status}
                      </span>
                    </td>
                    <td className="px-3 py-2">{r.startedAt}</td>
                    <td className="px-3 py-2">{r.completedAt ?? "-"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* 거래 입력 폼 + 최근 체결 내역 */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-lg border border-zinc-200 p-5 dark:border-zinc-800">
          <h2 className="mb-3 text-lg font-semibold">거래 입력</h2>
          <form action={recordTrade} className="flex flex-col gap-3 text-sm">
            <input type="hidden" name="strategyId" value={strategy.id} />
            <div className="flex gap-3">
              <label className="flex flex-1 flex-col gap-1">
                <span>날짜</span>
                <input
                  type="date"
                  name="date"
                  defaultValue={todayIso()}
                  required
                  className="rounded border border-zinc-300 px-2 py-1.5 dark:border-zinc-700 dark:bg-zinc-900"
                />
              </label>
              <label className="flex flex-1 flex-col gap-1">
                <span>구분</span>
                <select
                  name="side"
                  required
                  className="rounded border border-zinc-300 px-2 py-1.5 dark:border-zinc-700 dark:bg-zinc-900"
                >
                  <option value="buy">매수</option>
                  <option value="sell">매도</option>
                </select>
              </label>
            </div>
            <div className="flex gap-3">
              <label className="flex flex-1 flex-col gap-1">
                <span>가격 ($)</span>
                <input
                  type="number"
                  name="price"
                  step="0.01"
                  min={0}
                  required
                  className="rounded border border-zinc-300 px-2 py-1.5 dark:border-zinc-700 dark:bg-zinc-900"
                />
              </label>
              <label className="flex flex-1 flex-col gap-1">
                <span>수량</span>
                <input
                  type="number"
                  name="qty"
                  step="0.0001"
                  min={0}
                  required
                  className="rounded border border-zinc-300 px-2 py-1.5 dark:border-zinc-700 dark:bg-zinc-900"
                />
              </label>
            </div>
            <button type="submit" className="mt-1 rounded bg-foreground px-4 py-2 font-medium text-background">
              체결 기록 추가
            </button>
          </form>
        </div>

        <div className="rounded-lg border border-zinc-200 p-5 dark:border-zinc-800">
          <h2 className="mb-3 text-lg font-semibold">최근 체결 내역</h2>
          <ul className="flex max-h-80 flex-col gap-2 overflow-y-auto text-sm">
            {allTrades.length === 0 ? (
              <li className="text-zinc-500">체결 내역이 없습니다.</li>
            ) : (
              allTrades.slice(0, 20).map((t) => (
                <li key={t.id} className="flex justify-between rounded bg-zinc-100 px-3 py-1.5 dark:bg-zinc-900">
                  <span>
                    {t.date} ·{" "}
                    <span className={t.side === "buy" ? "text-blue-600 dark:text-blue-400" : "text-red-600 dark:text-red-400"}>
                      {t.side === "buy" ? "매수" : "매도"}
                    </span>
                  </span>
                  <span>
                    ${fmt(t.price)} x {fmt(t.qty, 4)}주
                  </span>
                </li>
              ))
            )}
          </ul>
          <p className="mt-3 text-xs text-zinc-500">예수금: ${fmt(cashBalance)}</p>
        </div>
      </section>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-zinc-200 px-4 py-3 dark:border-zinc-800">
      <p className="text-xs text-zinc-500">{label}</p>
      <p className="mt-1 text-lg font-semibold">{value}</p>
    </div>
  );
}
