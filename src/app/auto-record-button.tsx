"use client";

import { useActionState } from "react";
import { autoRecordTodayFills, clearAutoRecordSkip } from "./actions";

const initialState = { ok: true, message: "" };

export function AutoRecordButton({ strategyId }: { strategyId: number }) {
  const [state, formAction, pending] = useActionState(autoRecordTodayFills, initialState);

  const skippedDate = state.message?.startsWith("SKIPPED:") ? state.message.slice(8) : null;

  return (
    <div className="flex flex-col items-end gap-1">
      <form action={formAction}>
        <input type="hidden" name="strategyId" value={strategyId} />
        <button
          type="submit"
          disabled={pending}
          className="whitespace-nowrap rounded-full border border-[var(--accent)]/40 px-3.5 py-1.5 text-xs font-medium text-[var(--accent)] transition-colors hover:bg-[var(--accent-soft)] disabled:opacity-50"
        >
          {pending ? "처리 중…" : "최근 종가 기준 자동 기록"}
        </button>
      </form>

      {skippedDate ? (
        <div className="flex items-center gap-2">
          <p className="text-xs text-zinc-500">{skippedDate} — 삭제한 날짜라 건너뜀</p>
          <form action={clearAutoRecordSkip}>
            <input type="hidden" name="strategyId" value={strategyId} />
            <input type="hidden" name="date" value={skippedDate} />
            <button
              type="submit"
              className="text-xs text-[var(--accent)] underline hover:no-underline"
            >
              차단 해제
            </button>
          </form>
        </div>
      ) : state.message ? (
        <p className={`text-xs ${state.ok ? "text-zinc-500" : "text-[var(--negative)]"}`}>
          {state.message}
        </p>
      ) : null}
    </div>
  );
}
