// Yahoo Finance 차트 API에서 최근 영업일의 종가/고가/저가를 가져온다 (자동 종가 수집용)
// 고가/저가는 지정가 매도 주문이 장중에 체결됐을 가능성을 추정하는 데 사용한다.

export interface FetchedClosePrice {
  date: string; // ISO date (YYYY-MM-DD), 거래소 현지 기준
  closePrice: number;
  dayHigh: number | null;
  dayLow: number | null;
}

/**
 * 최근 N영업일치 종가/고가/저가를 과거 → 최신 순으로 가져온다.
 * 하루치만 가져오면, "전일 종가"(사다리 기준가)를 계산할 직전 거래일 데이터가
 * 비어 있을 수 있으므로(예: 신규 프로젝트, 수집을 며칠 건너뛴 경우) 항상
 * 며칠치를 함께 가져와 연속된 데이터를 보장한다.
 */
export async function fetchRecentClosePrices(ticker: string, days = 10): Promise<FetchedClosePrice[]> {
  const res = await fetch(
    `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=${days}d&interval=1d`,
    { headers: { "User-Agent": "Mozilla/5.0" }, cache: "no-store" }
  );
  if (!res.ok) return [];

  const data = await res.json();
  const result = data?.chart?.result?.[0];
  const timestamps: number[] = result?.timestamp ?? [];
  const quote = result?.indicators?.quote?.[0] ?? {};
  const closes: Array<number | null> = quote.close ?? [];
  const highs: Array<number | null> = quote.high ?? [];
  const lows: Array<number | null> = quote.low ?? [];
  const gmtoffset: number = result?.meta?.gmtoffset ?? 0;

  // 거래소 현지 기준 "오늘" 날짜가 장중이면 종가가 아직 확정되지 않으므로 제외한다.
  // 거래소 정규장 마감(16:00 ET)으로부터 1시간 이상 지난 17:00 이후에만 오늘 데이터를 허용한다.
  const nowLocalDate = new Date(Date.now() + gmtoffset * 1000);
  const exchangeTodayIso = nowLocalDate.toISOString().slice(0, 10);
  const exchangeHour = nowLocalDate.getUTCHours(); // gmtoffset이 이미 반영된 "현지 시각"
  const marketClosed = exchangeHour >= 17; // 17:00 이후 = 마감 확정

  const prices: FetchedClosePrice[] = [];
  for (let i = 0; i < timestamps.length; i++) {
    const close = closes[i];
    if (close == null) continue;
    const localMs = (timestamps[i] + gmtoffset) * 1000;
    const date = new Date(localMs).toISOString().slice(0, 10);
    if (date > exchangeTodayIso) continue; // 미래 날짜 (있을 수 없지만 방어)
    if (date === exchangeTodayIso && !marketClosed) continue; // 장중 미완성 종가
    const high = highs[i];
    const low = lows[i];
    prices.push({
      date,
      closePrice: Number(close.toFixed(2)),
      dayHigh: high != null ? Number(high.toFixed(2)) : null,
      dayLow: low != null ? Number(low.toFixed(2)) : null,
    });
  }
  return prices;
}

export async function fetchLatestClosePrice(ticker: string): Promise<FetchedClosePrice | null> {
  const prices = await fetchRecentClosePrices(ticker, 5);
  return prices.at(-1) ?? null;
}
