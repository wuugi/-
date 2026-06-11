"use client";

import { useActionState } from "react";
import { autoRecordTodayFills } from "./actions";

const initialState = { ok: true, message: "" };

export function AutoRecordButton({ strategyId }: { strategyId: number }) {
  const [state, formAction, pending] = useActionState(autoRecordTodayFills, initialState);

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
      {state.message ? (
        <p className={`text-xs ${state.ok ? "text-zinc-500" : "text-[var(--negative)]"}`}>
          {state.message}
        </p>
      ) : null}
    </div>
  );
}
