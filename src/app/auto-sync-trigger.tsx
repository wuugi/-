"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

const STORAGE_KEY = "lastAutoSyncAt";
const SYNC_INTERVAL_MS = 3 * 60 * 60 * 1000; // 3시간

/**
 * 가장 최근에 지난 미국 정규장 마감 시각(4 PM ET)을 UTC ms로 반환한다.
 * 장 마감 이전이면 전날(또는 직전 금요일) 마감 시각을 반환한다.
 */
function lastMarketCloseMs(): number {
  const now = Date.now();
  // 오늘 기준으로 최대 4일 전까지 역순으로 가장 최근 평일 장 마감을 찾는다.
  for (let daysAgo = 0; daysAgo <= 4; daysAgo++) {
    const d = new Date(now - daysAgo * 86400000);
    const dow = d.getUTCDay();
    if (dow === 0 || dow === 6) continue; // 주말 스킵
    const month = d.getUTCMonth() + 1;
    const isDst = month >= 3 && month <= 11;
    const closeHourUtc = isDst ? 20 : 21; // 4 PM ET
    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(d.getUTCDate()).padStart(2, "0");
    const closeMs = new Date(`${yyyy}-${mm}-${dd}T${String(closeHourUtc).padStart(2, "0")}:00:00Z`).getTime();
    if (closeMs <= now) return closeMs;
  }
  return 0;
}

/**
 * 사이트에 접속했을 때 /api/auto-sync를 호출해 종가 수집 + 체결 자동 기록을 트리거한다.
 * 3시간 게이트를 두되, 마지막 sync가 최근 장 마감 이전이면 게이트를 무시하고 재시도한다.
 * 이렇게 하면 장중 방문(데이터 없음) → 장 마감 후 재방문(종가 확정) 시 반드시 재-sync된다.
 */
export function AutoSyncTrigger() {
  const router = useRouter();

  useEffect(() => {
    const lastAt = Number(localStorage.getItem(STORAGE_KEY) ?? 0);
    const recentClose = lastMarketCloseMs();
    const withinInterval = Date.now() - lastAt < SYNC_INTERVAL_MS;
    const syncedAfterClose = lastAt >= recentClose;
    if (withinInterval && syncedAfterClose) return;

    localStorage.setItem(STORAGE_KEY, String(Date.now()));
    fetch("/api/auto-sync", { method: "POST" })
      .then((res) => res.json())
      .then((data) => {
        if (!data.skipped) router.refresh();
      })
      .catch(() => {
        localStorage.removeItem(STORAGE_KEY);
      });
  }, [router]);

  return null;
}
