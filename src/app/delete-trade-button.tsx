"use client";

import { deleteTrade } from "./actions";

export function DeleteTradeButton({ tradeId, strategyId }: { tradeId: number; strategyId: number }) {
  return (
    <form action={deleteTrade}>
      <input type="hidden" name="tradeId" value={tradeId} />
      <input type="hidden" name="strategyId" value={strategyId} />
      <button
        type="submit"
        className="text-xs text-zinc-400 hover:text-[var(--negative)] transition-colors"
        onClick={(e) => {
          if (!confirm("이 체결 기록을 삭제하시겠습니까?")) e.preventDefault();
        }}
      >
        삭제
      </button>
    </form>
  );
}
