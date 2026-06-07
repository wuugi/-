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
        className="rounded bg-foreground px-4 py-2 text-sm font-medium text-background"
      >
        새 프로젝트 시작
      </button>

      <dialog
        ref={dialogRef}
        className="m-auto w-full max-w-sm rounded-lg border border-zinc-200 bg-background p-0 backdrop:bg-black/40 dark:border-zinc-800"
      >
        <div className="p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold">새 프로젝트 시작</h2>
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
              <span className="text-sm font-medium">종목</span>
              <select
                name="ticker"
                required
                defaultValue="TQQQ"
                className="rounded border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
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
                className="rounded border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
                placeholder="10000"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-sm font-medium">분할 카운트(회차)</span>
              <select
                name="splitCount"
                required
                defaultValue="20"
                className="rounded border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
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
                className="rounded border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
              >
                <option value="20">20%</option>
                <option value="30">30%</option>
              </select>
            </label>
            <button
              type="submit"
              className="mt-2 rounded bg-foreground px-4 py-2 font-medium text-background"
            >
              프로젝트 시작하기
            </button>
          </form>
        </div>
      </dialog>
    </>
  );
}
