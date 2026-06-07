"use server";

import { db } from "@/db/client";
import { priceSnapshots } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { fetchLatestClosePrice } from "@/lib/price-fetch";

async function upsertPriceSnapshot(ticker: string, date: string, closePrice: number) {
  const existing = await db
    .select()
    .from(priceSnapshots)
    .where(and(eq(priceSnapshots.ticker, ticker), eq(priceSnapshots.date, date)))
    .limit(1);

  if (existing[0]) {
    await db
      .update(priceSnapshots)
      .set({ closePrice })
      .where(eq(priceSnapshots.id, existing[0].id));
  } else {
    await db.insert(priceSnapshots).values({ ticker, date, closePrice });
  }
}

/** 종가 스냅샷을 기록한다 (이미 있는 날짜면 갱신) */
export async function recordPriceSnapshot(formData: FormData) {
  const ticker = String(formData.get("ticker") ?? "").trim();
  const date = String(formData.get("date") ?? "").trim();
  const closePrice = Number(formData.get("closePrice"));

  if (!ticker || !date || !Number.isFinite(closePrice) || closePrice <= 0) {
    throw new Error("종가 입력값이 올바르지 않습니다.");
  }

  await upsertPriceSnapshot(ticker, date, closePrice);

  revalidatePath("/", "layout");
}

/** Yahoo Finance에서 최근 영업일 종가를 자동으로 가져와 기록한다 (이미 있는 날짜면 갱신) */
export async function fetchAndRecordPrice(formData: FormData) {
  const ticker = String(formData.get("ticker") ?? "").trim();

  if (!["TQQQ", "SOXL"].includes(ticker)) {
    throw new Error("종목은 TQQQ 또는 SOXL이어야 합니다.");
  }

  const latest = await fetchLatestClosePrice(ticker);
  if (!latest) {
    throw new Error("종가를 자동으로 가져오지 못했습니다. 잠시 후 다시 시도하거나 직접 입력하세요.");
  }

  await upsertPriceSnapshot(ticker, latest.date, latest.closePrice);

  revalidatePath("/", "layout");
}
