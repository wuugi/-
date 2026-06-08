"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

const STORAGE_KEY = "lastAutoSyncDate";

/**
 * 사이트에 접속했을 때 KST 기준 오늘 날짜로 동기화를 한 번만 트리거한다.
 * (localStorage에 마지막 동기화 날짜를 기록해 같은 날 재방문 시 중복 호출을 막는다.
 * 서버 쪽에도 동일한 메모리 게이트가 있어 이중으로 안전하다)
 */
export function AutoSyncTrigger() {
  const router = useRouter();

  useEffect(() => {
    const todayKst = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
    if (localStorage.getItem(STORAGE_KEY) === todayKst) return;

    localStorage.setItem(STORAGE_KEY, todayKst);
    fetch("/api/auto-sync", { method: "POST" })
      .then((res) => res.json())
      .then((data) => {
        if (!data.skipped) router.refresh();
      })
      .catch(() => {
        // 실패해도 다음 접속 때 다시 시도하도록 기록을 되돌린다
        localStorage.removeItem(STORAGE_KEY);
      });
  }, [router]);

  return null;
}
