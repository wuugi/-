import Link from "next/link";
import { notFound } from "next/navigation";
import { autoRecordTodayFills, deleteTrade, recordTrade, updateCrashProtection } from "../../actions";
import { DeleteTradeButton } from "../../delete-trade-button";
import { BuyCostSummary } from "../../buy-cost-summary";
import { fetchAndRecordPrice, recordPriceSnapshot } from "../../actions-price";
import {
  getCurrentCycle,
  getCyclesByStrategy,
  getLatestHoldings,
  getRecentPriceSnapshots,
  getStrategyById,
  getTradesByStrategy,
} from "@/lib/queries";
import {
  detectCrashBigNumberBuy,
  getBuyTriggerPrice,
  getDailyBuyBudget,
  getFirstBuyLadder,
  getFirstHalfLadder,
  getPhase,
  getSecondHalfLadder,
  getSellPlan,
  getSellTriggerPrice,
  getStarPercent,
  getStarPoint,
  type CrashProtectionPct,
  type LadderTier,
  type SpecialBuyPlan,
  type Ticker,
} from "@/lib/lao-strategy";
import { isUsMarketTradingDay, todayIsoKst } from "@/lib/market-date";

const todayIso = todayIsoKst;

function fmt(n: number, digits = 2) {
  return n.toLocaleString("ko-KR", { maximumFractionDigits: digits });
}

export default async function ProjectDashboard({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const strategyId = Number(id);
  if (!Number.isFinite(strategyId)) notFound();

  const strategy = await getStrategyById(strategyId);
  if (!strategy) notFound();

  const ticker = strategy.ticker as Ticker;
  const crashProtectionPct = strategy.crashProtectionPct as CrashProtectionPct;

  const [currentCycle, holdings, allCycles, allTrades, recentPrices] = await Promise.all([
    getCurrentCycle(strategy.id),
    getLatestHoldings(strategy.id),
    getCyclesByStrategy(strategy.id),
    getTradesByStrategy(strategy.id),
    getRecentPriceSnapshots(strategy.ticker, 30),
  ]);

  const avgPrice = holdings?.avgPrice ?? 0;
  const qty = holdings?.qty ?? 0;
  const cashBalance = holdings?.cashBalance ?? strategy.principal;
  const tValue = holdings?.tValue ?? 0;

  const sortedPrices = [...recentPrices].sort((a, b) => (a.date < b.date ? -1 : 1));
  const latestPrice = sortedPrices.at(-1);
  // 가장 최근에 수집된 종가 = "오늘(다음 거래일)의 매수 사다리"를 세우는 기준이 되는 전일 종가.
  // "오늘"의 종가는 아직 장이 마감되지 않아 존재하지 않으므로, 이 값으로 체결 여부를
  // 판정해서는 안 된다 (지정가는 항상 이 값 기준으로 계산되므로 자기 자신과 비교하면
  // 항상 "체결"이 되어 버린다). 체결 판정은 다음 거래일 종가가 들어온 뒤 자동 기록에서 처리한다.
  const prevClose = latestPrice?.closePrice ?? 0;
  const latestPriceIsTradingDay = latestPrice ? isUsMarketTradingDay(latestPrice.date) : false;

  const totalBought = allTrades
    .filter((t) => t.side === "buy")
    .reduce((sum, t) => sum + t.price * t.qty, 0);

  const phase = getPhase(tValue, strategy.splitCount);
  const starPercent = getStarPercent(ticker, strategy.splitCount, tValue);
  const starPoint = avgPrice > 0 ? getStarPoint(avgPrice, starPercent) : null;
  const buyTriggerPrice = starPoint !== null ? getBuyTriggerPrice(starPoint) : null;
  const sellTriggerPrice = starPoint !== null ? getSellTriggerPrice(starPoint) : null;
  const dailyBudget = getDailyBuyBudget(tValue, strategy.splitCount, strategy.principal, cashBalance);

  let buyLadder: LadderTier[] = [];
  let crashBigNumber: SpecialBuyPlan | null = null;
  if (prevClose > 0) {
    if (tValue <= 0) {
      buyLadder = getFirstBuyLadder(prevClose, dailyBudget, crashProtectionPct);
    } else if (starPoint !== null) {
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
    tValue >= 1 && qty > 0 && avgPrice > 0 && starPoint !== null
      ? getSellPlan(ticker, avgPrice, qty, starPoint)
      : null;

  return (
    <div className="mx-auto w-full max-w-4xl px-6 py-10">
      <div className="mb-4">
        <Link href="/" className="text-sm text-zinc-500 hover:underline">
          ← 프로젝트 목록으로
        </Link>
      </div>
      <header className="mb-8 flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-[var(--accent)] sm:text-2xl">
            {strategy.name?.trim() || `${strategy.ticker} 무한매수법 대시보드`}
          </h1>
          {strategy.name?.trim() ? (
            <p className="mt-0.5 text-sm text-zinc-500">{strategy.ticker} 무한매수법 대시보드 (라오어 4.0)</p>
          ) : (
            <p className="mt-0.5 text-sm text-zinc-500">라오어 4.0</p>
          )}
        </div>
        <span className="text-sm text-zinc-500">원금 ${fmt(strategy.principal, 0)}</span>
      </header>

      {/* 현재 상태 요약 */}
      <section className="mb-4 grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-7">
        <StatCard label="사이클" value={currentCycle ? `${currentCycle.cycleNo}회차` : "-"} />
        <StatCard label="T값" value={fmt(tValue, 4)} />
        <StatCard label="전후반전" value={phase} />
        <StatCard label="별%" value={`${fmt(starPercent)}%`} />
        <StatCard label="평단가" value={avgPrice > 0 ? `$${fmt(avgPrice)}` : "-"} />
        <StatCard label="보유수량" value={qty > 0 ? fmt(Math.round(qty), 0) : "0"} />
        <StatCard label="누적 매수금액" value={totalBought > 0 ? `$${fmt(totalBought, 2)}` : "-"} />
      </section>

      {/* 폭락률 보호 구간 표시 + 수정 */}
      <section className="mb-8 flex flex-wrap items-center gap-3 rounded-2xl border border-zinc-200/70 bg-[var(--surface)] px-4 py-3 text-sm shadow-sm dark:border-zinc-800">
        <span className="text-zinc-500">폭락률 보호 구간</span>
        <span className="font-semibold">{strategy.crashProtectionPct}%</span>
        <form action={updateCrashProtection} className="ml-auto flex items-center gap-2">
          <input type="hidden" name="strategyId" value={strategy.id} />
          <select
            name="crashProtectionPct"
            defaultValue={String(strategy.crashProtectionPct)}
            className="rounded border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          >
            <option value="20">20%</option>
            <option value="30">30%</option>
          </select>
          <button type="submit" className="rounded-full bg-[var(--accent)] px-3.5 py-1 text-sm font-medium text-white shadow-sm transition-shadow hover:shadow-md">
            변경
          </button>
        </form>
      </section>

      <div className="mb-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* 오늘의 매수/매도 추천 */}
        <section className="rounded-2xl border border-zinc-200/70 bg-[var(--surface)] p-5 shadow-sm dark:border-zinc-800">
          <h2 className="mb-3 text-lg font-semibold">오늘의 매수/매도 추천</h2>
          {!latestPrice ? (
            <p className="text-sm text-zinc-500">
              종가 데이터가 없습니다. 아래에서 오늘 종가를 입력하면 추천이 계산됩니다.
            </p>
          ) : !latestPriceIsTradingDay ? (
            <p className="text-sm text-zinc-500">
              최근 입력된 종가 날짜({latestPrice.date})는 미국 증시 휴장일(주말/공휴일)이라 체결 여부를 확인하지
              않습니다. 다음 개장일의 종가가 입력되면 추천과 체결 판정이 표시됩니다.
            </p>
          ) : (
            <div className="flex flex-col gap-4 text-sm">
              <div className="rounded-xl bg-[var(--accent-soft)] px-3 py-2 text-xs">
                <p>
                  별지점 {starPoint !== null ? `$${fmt(starPoint)}` : "-"} (별% {fmt(starPercent)}%) · 매수점{" "}
                  {buyTriggerPrice !== null ? `$${fmt(buyTriggerPrice)}` : "-"} · 매도점{" "}
                  {sellTriggerPrice !== null ? `$${fmt(sellTriggerPrice)}` : "-"}
                </p>
                <p className="mt-1">
                  1회 매수금 <span className="font-semibold">${fmt(dailyBudget)}</span>{" "}
                  {tValue <= 0 ? "(= 원금 / 분할수)" : "(= 잔금 / (분할수 - T))"} · 잔금 ${fmt(cashBalance)}
                </p>
              </div>
              <div>
                <h3 className="mb-1 font-medium">
                  {crashBigNumber
                    ? "폭락 대응 큰수 매수 (자동 전환)"
                    : tValue <= 0
                      ? "첫 매수 LOC 사다리"
                      : phase === "전반전"
                        ? "전반전 매수 사다리 (별지점 LOC + 평단가 LOC)"
                        : "후반전 매수 사다리 (별지점 LOC 중심)"}{" "}
                  (전일 종가 ${fmt(prevClose)} 기준)
                </h3>

                {crashBigNumber ? (
                  <div className="flex flex-col gap-2 rounded-xl bg-[var(--negative-soft)] px-3 py-2 text-xs">
                    <p>
                      <span className="rounded-full bg-[var(--negative)] px-2 py-0.5 font-medium text-white">특이사항</span>{" "}
                      별지점과 종가의 괴리가 폭락률 보호 구간({crashProtectionPct}%)을 초과해, 정상 사다리 대신 단일 큰수
                      LOC 매수로 자동 전환되었습니다.
                    </p>
                    <table className="w-full min-w-[420px] overflow-hidden text-xs">
                      <thead className="bg-white/40 text-left dark:bg-black/20">
                        <tr>
                          <th className="whitespace-nowrap px-2 py-1.5">큰수 LOC 지정가</th>
                          <th className="whitespace-nowrap px-2 py-1.5">통합 매수 수량</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr className="border-t border-white/40 dark:border-black/20">
                          <td className="whitespace-nowrap px-2 py-1.5">${fmt(crashBigNumber.limitPrice)}</td>
                          <td className="whitespace-nowrap px-2 py-1.5">{fmt(Math.round(crashBigNumber.qty), 0)}주</td>
                        </tr>
                      </tbody>
                    </table>
                    <p>{crashBigNumber.note.replace("[특이사항] ", "")}</p>
                    <BuyCostSummary
                      items={[{ label: "폭락대비 큰수 LOC", qty: Math.round(crashBigNumber.qty), price: crashBigNumber.limitPrice }]}
                      total={Math.round(crashBigNumber.qty) * crashBigNumber.limitPrice}
                    />
                  </div>
                ) : (
                  <>
                    <div className="overflow-x-auto rounded">
                    <table className="w-full min-w-[480px] overflow-hidden text-xs">
                      <thead className="bg-[var(--accent-soft)]/60 text-left">
                        <tr>
                          <th className="whitespace-nowrap px-2 py-1.5">단계</th>
                          <th className="whitespace-nowrap px-2 py-1.5">사유</th>
                          <th className="whitespace-nowrap px-2 py-1.5">LOC 지정가</th>
                          <th className="whitespace-nowrap px-2 py-1.5">매수 수량</th>
                        </tr>
                      </thead>
                      <tbody>
                        {buyLadder.length === 0 ? (
                          <tr>
                            <td colSpan={4} className="px-2 py-3 text-center text-zinc-500">
                              매수 사다리를 계산할 수 없습니다 (평단가 또는 종가 데이터 필요).
                            </td>
                          </tr>
                        ) : (
                          buyLadder.map((tier) => (
                            <tr key={tier.level} className="border-t border-zinc-200 dark:border-zinc-800">
                              <td className="whitespace-nowrap px-2 py-1.5">{tier.level}</td>
                              <td className="whitespace-nowrap px-2 py-1.5">{tier.label}</td>
                              <td className="whitespace-nowrap px-2 py-1.5">${fmt(tier.limitPrice)}</td>
                              <td className="whitespace-nowrap px-2 py-1.5">{fmt(Math.round(tier.qty), 0)}주</td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                    </div>
                    {(() => {
                      // 별지점(level 1), 평단가(level 2), 첫 번째 단계별 하락(step1)만 합산
                      const costItems = buyLadder
                        .filter((t) => t.level === 1 || t.label.includes("평단가") || t.label.includes("단계별 하락"))
                        .reduce<{ label: string; qty: number; price: number }[]>((acc, t) => {
                          if (t.level === 1) return [...acc, { label: "별지점 LOC", qty: Math.round(t.qty), price: t.limitPrice }];
                          if (t.label.includes("평단가")) return [...acc, { label: "평단가 LOC", qty: Math.round(t.qty), price: t.limitPrice }];
                          // 단계별 하락은 첫 번째 step만 (이미 추가한 게 없는 경우)
                          if (!acc.some((x) => x.label === "단계별 하락 1차")) {
                            return [...acc, { label: "단계별 하락 1차 LOC", qty: Math.round(t.qty), price: t.limitPrice }];
                          }
                          return acc;
                        }, [])
                        .filter((item) => item.qty > 0);
                      const total = costItems.reduce((s, x) => s + x.qty * x.price, 0);
                      return <BuyCostSummary items={costItems} total={total} />;
                    })()}
                    <p className="mt-1 text-xs text-zinc-500">
                      오늘 장이 마감되어 종가가 입력되면, 이 사다리를 기준으로 체결 여부가 자동 기록됩니다 (종가 ≤ 지정가 → 체결).
                    </p>
                  </>
                )}
              </div>
              <div>
                <h3 className="mb-1 font-medium">매도 계획 (2회차/T≥1부터 매일 지정가 갱신)</h3>
                {tValue < 1 ? (
                  <p className="text-zinc-500">
                    T값이 1 미만(첫 매수 단계)에서는 매도 지정가를 걸지 않습니다. T값이 1 이상이 되면 매일 갱신됩니다.
                  </p>
                ) : sellPlan ? (
                  <div className="rounded-xl border-l-4 border-[var(--negative)] bg-[var(--negative-soft)] px-3 py-2">
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[400px] text-xs">
                        <thead className="bg-white/40 text-left dark:bg-black/20">
                          <tr>
                            <th className="whitespace-nowrap px-2 py-1.5">종류</th>
                            <th className="whitespace-nowrap px-2 py-1.5">주문 방식</th>
                            <th className="whitespace-nowrap px-2 py-1.5">지정가</th>
                            <th className="whitespace-nowrap px-2 py-1.5">수량</th>
                            <th className="whitespace-nowrap px-2 py-1.5">금액</th>
                            <th className="whitespace-nowrap px-2 py-1.5">T 변화</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr className="border-t border-white/40 dark:border-black/20">
                            <td className="whitespace-nowrap px-2 py-1.5 font-medium text-[var(--negative)]">쿼터매도</td>
                            <td className="whitespace-nowrap px-2 py-1.5">별지점 LOC</td>
                            <td className="whitespace-nowrap px-2 py-1.5">${fmt(sellPlan.quarterSell.limitPrice)}</td>
                            <td className="whitespace-nowrap px-2 py-1.5">{fmt(Math.round(sellPlan.quarterSell.qty), 0)}주</td>
                            <td className="whitespace-nowrap px-2 py-1.5">${fmt(sellPlan.quarterSell.limitPrice * sellPlan.quarterSell.qty)}</td>
                            <td className="whitespace-nowrap px-2 py-1.5">직전T × 0.75</td>
                          </tr>
                          <tr className="border-t border-white/40 dark:border-black/20">
                            <td className="whitespace-nowrap px-2 py-1.5 font-medium text-[var(--negative)]">잔여매도</td>
                            <td className="whitespace-nowrap px-2 py-1.5">평단+{sellPlan.remainderSell.fixedRate}% 지정가</td>
                            <td className="whitespace-nowrap px-2 py-1.5">${fmt(sellPlan.remainderSell.limitPrice)}</td>
                            <td className="whitespace-nowrap px-2 py-1.5">{fmt(Math.round(sellPlan.remainderSell.qty), 0)}주</td>
                            <td className="whitespace-nowrap px-2 py-1.5">${fmt(sellPlan.remainderSell.limitPrice * sellPlan.remainderSell.qty)}</td>
                            <td className="whitespace-nowrap px-2 py-1.5">변화 없음</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                    <p className="mt-1.5 text-xs text-zinc-500">
                      장 시작 전 매일 갱신해 지정가 주문을 걸어두세요. 체결 여부는 종가·고가 입력 후 자동 기록됩니다.
                    </p>
                  </div>
                ) : (
                  <p className="text-zinc-500">보유 수량이 없어 매도 계획이 없습니다.</p>
                )}
              </div>
            </div>
          )}

          <form action={fetchAndRecordPrice} className="mt-4 flex flex-wrap items-center gap-2 border-t border-zinc-200 pt-4 text-sm dark:border-zinc-800">
            <input type="hidden" name="ticker" value={strategy.ticker} />
            <span className="text-zinc-500">최근 영업일 종가를 자동으로 가져와 기록합니다 (Yahoo Finance).</span>
            <button type="submit" className="ml-auto shrink-0 whitespace-nowrap rounded-full border border-[var(--accent)]/40 px-4 py-1.5 font-medium text-[var(--accent)] transition-colors hover:bg-[var(--accent-soft)]">
              종가 자동 수집
            </button>
          </form>

          <form action={recordPriceSnapshot} className="mt-2 flex flex-wrap items-end gap-2 border-t border-zinc-200 pt-4 dark:border-zinc-800">
            <input type="hidden" name="ticker" value={strategy.ticker} />
            <label className="flex flex-1 flex-col gap-1 text-sm">
              <span>날짜</span>
              <input
                type="date"
                name="date"
                defaultValue={todayIso()}
                required
                className="rounded-lg border border-zinc-300 px-2 py-1.5 outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-soft)] dark:border-zinc-700 dark:bg-zinc-900"
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
                className="rounded-lg border border-zinc-300 px-2 py-1.5 outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-soft)] dark:border-zinc-700 dark:bg-zinc-900"
              />
            </label>
            <button type="submit" className="shrink-0 whitespace-nowrap rounded-full bg-[var(--accent)] px-4 py-1.5 text-sm font-medium text-white shadow-sm transition-shadow hover:shadow-md">
              종가 입력
            </button>
          </form>
        </section>

        {/* T값 / 별% 요약 */}
        <section className="rounded-2xl border border-zinc-200/70 bg-[var(--surface)] p-5 shadow-sm dark:border-zinc-800">
          <h2 className="mb-3 text-lg font-semibold">T값 진행 현황</h2>
          <div className="flex flex-col gap-3">
            <div className="flex h-3 w-full overflow-hidden rounded-full bg-[var(--accent-soft)]">
              <div
                className="h-full bg-[var(--accent)] transition-all"
                style={{ width: `${Math.min((tValue / strategy.splitCount) * 100, 100)}%` }}
              />
            </div>
            <div className="flex justify-between text-xs text-zinc-500">
              <span>T = 0</span>
              <span>T = {strategy.splitCount / 2} (후반전 진입)</span>
              <span>T = {strategy.splitCount}</span>
            </div>
            <p className="text-sm">
              현재 T값 <span className="font-semibold">{fmt(tValue, 4)}</span> · {phase} 진행 중
            </p>
            <p className="text-xs text-zinc-500">
              별% = {strategy.ticker === "TQQQ" ? (strategy.splitCount === 40 ? "15 - 0.75×T" : "15 - 1.5×T") : strategy.splitCount === 40 ? "20 - T" : "20 - 2×T"}{" "}
              = {fmt(starPercent)}% · 별지점 = 평단가 × (1 + 별%/100)
            </p>
          </div>
        </section>
      </div>

      {/* 사이클별 운용 내역 */}
      <section className="mb-8">
        <h2 className="mb-3 text-lg font-semibold">사이클별 운용 내역</h2>
        <div className="overflow-x-auto rounded-2xl border border-zinc-200/70 bg-[var(--surface)] shadow-sm dark:border-zinc-800">
          <table className="w-full text-sm">
            <thead className="bg-[var(--accent-soft)]/60 text-left">
              <tr>
                <th className="px-3 py-2">사이클</th>
                <th className="px-3 py-2">상태</th>
                <th className="px-3 py-2">시작일</th>
                <th className="px-3 py-2">완료일</th>
              </tr>
            </thead>
            <tbody>
              {allCycles.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-3 py-4 text-center text-zinc-500">
                    사이클 정보가 없습니다.
                  </td>
                </tr>
              ) : (
                [...allCycles].reverse().map((c) => (
                  <tr key={c.id} className="border-t border-zinc-200 dark:border-zinc-800">
                    <td className="px-3 py-2">{c.cycleNo}회차</td>
                    <td className="px-3 py-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          c.status === "진행중"
                            ? "bg-[var(--positive-soft)] text-[var(--positive)]"
                            : "bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
                        }`}
                      >
                        {c.status}
                      </span>
                    </td>
                    <td className="px-3 py-2">{c.startedAt}</td>
                    <td className="px-3 py-2">{c.completedAt ?? "-"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* 거래 입력 폼 + 최근 체결 내역 */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-2xl border border-zinc-200/70 bg-[var(--surface)] p-5 shadow-sm dark:border-zinc-800">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold">거래 입력</h2>
            <form action={autoRecordTodayFills}>
              <input type="hidden" name="strategyId" value={strategy.id} />
              <button
                type="submit"
                className="whitespace-nowrap rounded-full border border-[var(--accent)]/40 px-3.5 py-1.5 text-xs font-medium text-[var(--accent)] transition-colors hover:bg-[var(--accent-soft)]"
              >
                최근 종가 기준 자동 기록
              </button>
            </form>
          </div>
          <p className="mb-3 -mt-1 text-xs text-zinc-500">
            제안된 사다리/매도 지정가에 종가가 닿으면 자동으로 체결로 판단해 기록합니다. 자동 판단이 실제 체결과 다르면
            아래에서 직접 입력해 보정하세요.
          </p>
          <form action={recordTrade} className="flex flex-col gap-3 text-sm">
            <input type="hidden" name="strategyId" value={strategy.id} />
            <div className="flex gap-3">
              <label className="flex min-w-0 flex-1 flex-col gap-1">
                <span>날짜</span>
                <input
                  type="date"
                  name="date"
                  defaultValue={todayIso()}
                  required
                  className="w-full min-w-0 rounded-lg border border-zinc-300 px-2 py-1.5 outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-soft)] dark:border-zinc-700 dark:bg-zinc-900"
                />
              </label>
              <label className="flex min-w-0 flex-1 flex-col gap-1">
                <span>구분</span>
                <select
                  name="side"
                  required
                  className="w-full min-w-0 rounded-lg border border-zinc-300 px-2 py-1.5 outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-soft)] dark:border-zinc-700 dark:bg-zinc-900"
                >
                  <option value="buy">매수</option>
                  <option value="sell">매도</option>
                </select>
              </label>
            </div>
            <label className="flex min-w-0 flex-col gap-1">
              <span>체결 종류 (T값 변화 결정)</span>
              <select
                name="tradeKind"
                required
                className="w-full min-w-0 rounded-lg border border-zinc-300 px-2 py-1.5 outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-soft)] dark:border-zinc-700 dark:bg-zinc-900"
              >
                <optgroup label="매수">
                  <option value="first">첫매수 (T 0 → 진행)</option>
                  <option value="full">1회매수 (T + 1)</option>
                  <option value="half">절반매수 (T + 0.5)</option>
                  <option value="extra">추가 LOC 매수 (T 변화 없음)</option>
                </optgroup>
                <optgroup label="매도">
                  <option value="quarterSell">쿼터매도 (T = 직전T × 0.75)</option>
                  <option value="remainderSell">잔여 지정가 매도 (T 변화 없음)</option>
                </optgroup>
              </select>
            </label>
            <div className="flex gap-3">
              <label className="flex min-w-0 flex-1 flex-col gap-1">
                <span>가격 ($)</span>
                <input
                  type="number"
                  name="price"
                  step="0.01"
                  min={0}
                  required
                  className="w-full min-w-0 rounded-lg border border-zinc-300 px-2 py-1.5 outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-soft)] dark:border-zinc-700 dark:bg-zinc-900"
                />
              </label>
              <label className="flex min-w-0 flex-1 flex-col gap-1">
                <span>수량</span>
                <input
                  type="number"
                  name="qty"
                  step="0.0001"
                  min={0}
                  required
                  className="w-full min-w-0 rounded-lg border border-zinc-300 px-2 py-1.5 outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-soft)] dark:border-zinc-700 dark:bg-zinc-900"
                />
              </label>
            </div>
            <button type="submit" className="mt-1 rounded-full bg-[var(--accent)] px-4 py-2 font-medium text-white shadow-sm transition-shadow hover:shadow-md">
              체결 기록 추가
            </button>
          </form>
        </div>

        <div className="rounded-2xl border border-zinc-200/70 bg-[var(--surface)] p-5 shadow-sm dark:border-zinc-800">
          <h2 className="mb-3 text-lg font-semibold">최근 체결 내역</h2>
          <ul className="flex max-h-80 flex-col gap-2 overflow-y-auto text-sm">
            {allTrades.length === 0 ? (
              <li className="text-zinc-500">체결 내역이 없습니다.</li>
            ) : (
              allTrades.slice(0, 20).map((t, idx) => (
                <li key={t.id} className={`flex flex-col gap-0.5 rounded-xl px-3 py-1.5 border-l-4 ${t.side === "buy" ? "bg-[var(--positive-soft)] border-[var(--positive)]" : "bg-[var(--negative-soft)] border-[var(--negative)]"}`}>
                  <div className="flex justify-between gap-2">
                    <span>
                      <span className="font-bold text-[var(--accent)]">#{allTrades.length - idx}</span> {t.date} ·{" "}
                      <span className={`font-semibold ${t.side === "buy" ? "text-[var(--positive)]" : "text-[var(--negative)]"}`}>
                        {t.side === "buy" ? "매수" : "매도"}
                      </span>{" "}
                      ({t.tradeKind})
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="font-medium">${fmt(t.price * t.qty)}</span>
                      <span className="ml-1 text-xs text-zinc-500">
                        ({fmt(t.price)} × {fmt(Math.round(t.qty), 0)}주)
                      </span>
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-zinc-500">
                      T값 {fmt(t.tBefore, 4)} → {fmt(t.tAfter, 4)}
                    </span>
                    <DeleteTradeButton tradeId={t.id} strategyId={strategy.id} />
                  </div>
                  {t.note ? (
                    <span className="mt-0.5 inline-block w-fit rounded-full bg-[var(--accent-soft)] px-2 py-0.5 text-xs font-medium text-[var(--accent)]">
                      특이사항: {t.note}
                    </span>
                  ) : null}
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
    <div className="rounded-2xl border border-zinc-200/70 bg-[var(--surface)] px-4 py-3 shadow-sm dark:border-zinc-800">
      <p className="text-xs text-zinc-500">{label}</p>
      <p className="mt-1 text-lg font-semibold text-[var(--accent)]">{value}</p>
    </div>
  );
}

