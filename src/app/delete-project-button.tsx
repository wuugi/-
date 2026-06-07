"use client";

import { useTransition } from "react";
import { deleteStrategy } from "./actions";

export function DeleteProjectButton({ strategyId, label }: { strategyId: number; label: string }) {
  const [isPending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={isPending}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!window.confirm(`"${label}" 프로젝트를 삭제할까요?\n사이클·체결·보유 현황 기록이 모두 함께 삭제되며 되돌릴 수 없습니다.`)) {
          return;
        }
        const fd = new FormData();
        fd.set("strategyId", String(strategyId));
        startTransition(() => {
          deleteStrategy(fd);
        });
      }}
      className="rounded-full p-1.5 text-zinc-400 transition-colors hover:bg-[var(--negative-soft)] hover:text-[var(--negative)] disabled:opacity-50"
      aria-label="프로젝트 삭제"
      title="프로젝트 삭제"
    >
      {isPending ? (
        <span className="block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
      ) : (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4">
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 7h12M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m2 0-1 13a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1L6 7h12Z" />
        </svg>
      )}
    </button>
  );
}
