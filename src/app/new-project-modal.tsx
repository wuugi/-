"use client";

import { useRef } from "react";
import { createStrategy } from "./actions";

export function NewProjectModal() {
  const dialogRef = useRef<HTMLDialogElement>(null);

  return (
    <>
      <button
        type="button"
        onClick={() => dialogRef.current?.showModal()}
        className="whitespace-nowrap rounded-full bg-[var(--accent)] px-5 py-2.5 text-sm font-medium text-white shadow-sm transition-shadow hover:shadow-md"
      >
        새 프로젝트 시작
      </button>

      <dialog
        ref={dialogRef}
        className="m-auto w-full max-w-sm rounded-2xl border border-zinc-200/70 bg-[var(--surface)] p-0 shadow-xl backdrop:bg-black/40 dark:border-zinc-800"
      >
        <div className="p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-[var(--accent)]">새 프로젝트 시작</h2>
            <button
              type="button"
              onClick={() => dialogRef.current?.close()}
              className="text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
              aria-label="닫기"
            >
              ✕
            </button>
          </div>
          <form
            action={createStrategy}
            className="flex flex-col gap-4"
            onSubmit={() => dialogRef.current?.close()}
          >
            <label className="flex flex-col gap-1">
              <span className="text-sm font-medium">프로젝트 이름 (선택)</span>
              <input
                type="text"
                name="name"
                maxLength={50}
                placeholder="예: TQQQ 40분할 본계좌"
                className="rounded-lg border border-zinc-300 bg-[var(--surface)] text-[var(--foreground)] px-3 py-2 outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-soft)] dark:border-zinc-700"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-sm font-medium">종목</span>
              <select
                name="ticker"
                required
                defaultValue="TQQQ"
                className="rounded-lg border border-zinc-300 bg-[var(--surface)] text-[var(--foreground)] px-3 py-2 outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-soft)] dark:border-zinc-700"
              >
                <option value="TQQQ">TQQQ</option>
                <option value="SOXL">SOXL</option>
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-sm font-medium">원금 ($)</span>
              <input
                type="number"
                name="principal"
                required
                min={0}
                step="0.01"
                className="rounded-lg border border-zinc-300 bg-[var(--surface)] text-[var(--foreground)] px-3 py-2 outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-soft)] dark:border-zinc-700"
                placeholder="10000"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-sm font-medium">분할 카운트(회차)</span>
              <select
                name="splitCount"
                required
                defaultValue="20"
                className="rounded-lg border border-zinc-300 bg-[var(--surface)] text-[var(--foreground)] px-3 py-2 outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-soft)] dark:border-zinc-700"
              >
                <option value="20">20회차</option>
                <option value="40">40회차</option>
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-sm font-medium">폭락률 보호 구간</span>
              <select
                name="crashProtectionPct"
                required
                defaultValue="20"
                className="rounded-lg border border-zinc-300 bg-[var(--surface)] text-[var(--foreground)] px-3 py-2 outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-soft)] dark:border-zinc-700"
              >
                <option value="20">20%</option>
                <option value="30">30%</option>
              </select>
            </label>
            <button
              type="submit"
              className="mt-2 rounded-full bg-[var(--accent)] px-4 py-2.5 font-medium text-white shadow-sm transition-shadow hover:shadow-md"
            >
              프로젝트 시작하기
            </button>
          </form>
        </div>
      </dialog>
    </>
  );
}
