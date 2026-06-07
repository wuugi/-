// Yahoo Finance 차트 API에서 최근 영업일의 종가/고가/저가를 가져온다 (자동 종가 수집용)
// 고가/저가는 지정가 매도 주문이 장중에 체결됐을 가능성을 추정하는 데 사용한다.

export interface FetchedClosePrice {
  date: string; // ISO date (YYYY-MM-DD), 거래소 현지 기준
  closePrice: number;
  dayHigh: number | null;
  dayLow: number | null;
}

export async function fetchLatestClosePrice(ticker: string): Promise<FetchedClosePrice | null> {
  const res = await fetch(
    `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=5d&interval=1d`,
    { headers: { "User-Agent": "Mozilla/5.0" }, cache: "no-store" }
  );
  if (!res.ok) return null;

  const data = await res.json();
  const result = data?.chart?.result?.[0];
  const timestamps: number[] = result?.timestamp ?? [];
  const quote = result?.indicators?.quote?.[0] ?? {};
  const closes: Array<number | null> = quote.close ?? [];
  const highs: Array<number | null> = quote.high ?? [];
  const lows: Array<number | null> = quote.low ?? [];
  const gmtoffset: number = result?.meta?.gmtoffset ?? 0;

  for (let i = timestamps.length - 1; i >= 0; i--) {
    const close = closes[i];
    if (close == null) continue;
    const localMs = (timestamps[i] + gmtoffset) * 1000;
    const date = new Date(localMs).toISOString().slice(0, 10);
    const high = highs[i];
    const low = lows[i];
    return {
      date,
      closePrice: Number(close.toFixed(2)),
      dayHigh: high != null ? Number(high.toFixed(2)) : null,
      dayLow: low != null ? Number(low.toFixed(2)) : null,
    };
  }
  return null;
}
