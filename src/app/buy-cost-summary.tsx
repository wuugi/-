"use client";

import { useState } from "react";

interface CostItem {
  label: string;
  qty: number;
  price: number;
}

interface BuyCostSummaryProps {
  items: CostItem[];
  total: number;
  fmt: (n: number, digits?: number) => string;
}

function fmtNum(n: number, digits = 2) {
  return n.toLocaleString("ko-KR", { maximumFractionDigits: digits });
}

export function BuyCostSummary({ items, total }: { items: CostItem[]; total: number }) {
  const [open, setOpen] = useState(false);

  if (total <= 0) return null;

  return (
    <div className="mt-3 rounded-xl border border-[var(--accent)]/30 bg-[var(--accent-soft)] text-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-3 py-2 font-medium text-[var(--accent)]"
      >
        <span>💰 오늘 필요 매수 금액</span>
        <span className="flex items-center gap-2">
          <span className="font-bold">${fmtNum(total)}</span>
          <span className="text-xs text-zinc-400">{open ? "▲" : "▼"}</span>
        </span>
      </button>
      {open && (
        <div className="border-t border-[var(--accent)]/20 px-3 py-2">
          <ul className="flex flex-col gap-1 text-xs">
            {items.map((item, i) => (
              <li key={i} className="flex justify-between gap-2 text-zinc-600 dark:text-zinc-400">
                <span>{item.label}</span>
                <span className="shrink-0">
                  {fmtNum(item.qty, 0)}주 × ${fmtNum(item.price)} ={" "}
                  <span className="font-medium text-[var(--accent)]">${fmtNum(item.qty * item.price)}</span>
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-zinc-500">
            ※ 종가가 각 LOC 지정가 이하로 마감될 때 체결되는 예상 금액입니다.
          </p>
        </div>
      )}
    </div>
  );
}
