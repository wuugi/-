// 날짜는 한국시간(KST, UTC+9) 기준으로 다루고, 미국 주식 시장 개장일 여부를 판단한다.

/** 현재 시각을 KST 기준 'YYYY-MM-DD'로 반환한다. */
export function todayIsoKst(): string {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

// 고정 날짜 미국 증시 휴장일 (월별 변동 공휴일인 추수감사절 등은 포함하지 않음)
const FIXED_US_MARKET_HOLIDAYS = new Set([
  "01-01", // New Year's Day
  "06-19", // Juneteenth
  "07-04", // Independence Day
  "12-25", // Christmas Day
]);

/**
 * 해당 거래일의 미국 정규장 마감(4:00 PM ET) 시각을 UTC 밀리초로 반환한다.
 * US DST: 3월~10월은 UTC-4, 그 외는 UTC-5.
 */
export function usMarketCloseUtcMs(dateIso: string): number {
  const month = Number(dateIso.slice(5, 7));
  const isDst = month >= 3 && month <= 11;
  const closeHourUtc = isDst ? 20 : 21; // 4 PM ET
  return new Date(`${dateIso}T${String(closeHourUtc).padStart(2, "0")}:00:00Z`).getTime();
}

/**
 * 해당 날짜(YYYY-MM-DD)가 미국 증시 개장일인지 대략적으로 판단한다.
 * 주말(토/일)과 고정 날짜 공휴일을 제외한다. (변동 공휴일은 가격 데이터 자체가 없어 자연히 걸러진다)
 */
export function isUsMarketTradingDay(dateIso: string): boolean {
  const [, month, day] = dateIso.split("-");
  if (FIXED_US_MARKET_HOLIDAYS.has(`${month}-${day}`)) return false;

  const dayOfWeek = new Date(`${dateIso}T12:00:00Z`).getUTCDay();
  return dayOfWeek !== 0 && dayOfWeek !== 6;
}
