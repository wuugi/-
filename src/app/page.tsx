import Link from "next/link";
import { NewProjectModal } from "./new-project-modal";
import { getStrategySummaries } from "@/lib/queries";
import { getPhase, getStarPercent, type Ticker } from "@/lib/lao-strategy";

function fmt(n: number, digits = 2) {
  return n.toLocaleString("ko-KR", { maximumFractionDigits: digits });
}

export default async function Home() {
  const summaries = await getStrategySummaries();

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-10">
      <header className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">라오어의 무한매수법 - 프로젝트 목록</h1>
          <p className="mt-1 text-sm text-zinc-500">
            종목·분할수별로 운용 중인 무한매수 프로젝트를 관리합니다. 프로젝트를 선택하면 상세 대시보드로 이동합니다.
          </p>
        </div>
        <NewProjectModal />
      </header>

      <section className="mb-10">
        {summaries.length === 0 ? (
          <p className="rounded-lg border border-zinc-200 p-6 text-center text-sm text-zinc-500 dark:border-zinc-800">
            등록된 프로젝트가 없습니다. 우측 상단의 &quot;새 프로젝트 시작&quot; 버튼을 눌러 시작하세요.
          </p>
        ) : (
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {summaries.map(({ strategy, currentCycle, holdings }) => {
              const ticker = strategy.ticker as Ticker;
              const tValue = holdings?.tValue ?? 0;
              const avgPrice = holdings?.avgPrice ?? 0;
              const qty = holdings?.qty ?? 0;
              const phase = getPhase(tValue, strategy.splitCount);
              const starPercent = getStarPercent(ticker, strategy.splitCount, tValue);

              return (
                <li key={strategy.id}>
                  <Link
                    href={`/projects/${strategy.id}`}
                    className="block h-full rounded-lg border border-zinc-200 p-5 transition-colors hover:border-zinc-400 dark:border-zinc-800 dark:hover:border-zinc-600"
                  >
                    <div className="mb-3 flex items-center justify-between">
                      <h2 className="text-lg font-semibold">{strategy.ticker}</h2>
                      <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
                        {strategy.splitCount}분할
                      </span>
                    </div>
                    <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-sm">
                      <DataRow label="원금" value={`$${fmt(strategy.principal, 0)}`} />
                      <DataRow label="사이클" value={currentCycle ? `${currentCycle.cycleNo}회차` : "-"} />
                      <DataRow label="T값" value={fmt(tValue, 4)} />
                      <DataRow label="전후반전" value={phase} />
                      <DataRow label="별%" value={`${fmt(starPercent)}%`} />
                      <DataRow label="평단가" value={avgPrice > 0 ? `$${fmt(avgPrice)}` : "-"} />
                      <DataRow label="보유수량" value={qty > 0 ? fmt(qty, 4) : "0"} />
                      <DataRow label="상태" value={currentCycle?.status ?? "-"} />
                    </dl>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

    </div>
  );
}

function DataRow({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-zinc-500">{label}</dt>
      <dd className="text-right font-medium">{value}</dd>
    </>
  );
}
