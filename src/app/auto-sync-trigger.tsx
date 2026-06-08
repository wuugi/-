"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

const STORAGE_KEY = "lastAutoSyncAt";
const SYNC_INTERVAL_MS = 3 * 60 * 60 * 1000; // 3시간

/**
 * 사이트에 접속했을 때 /api/auto-sync를 호출해 종가 수집 + 체결 자동 기록을 트리거한다.
 * 같은 날이더라도 3시간이 지나면 재시도한다 — 장중 방문(데이터 없음)과 장 마감 후
 * 방문(종가 확정) 모두 커버하기 위함이다. 서버 쪽 자체 게이트와 DB의 중복 기록
 * 방지 로직이 있어 실제로 중복 처리되지는 않는다.
 */
export function AutoSyncTrigger() {
  const router = useRouter();

  useEffect(() => {
    const lastAt = Number(localStorage.getItem(STORAGE_KEY) ?? 0);
    if (Date.now() - lastAt < SYNC_INTERVAL_MS) return;

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
