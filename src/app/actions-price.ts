"use server";

import { db } from "@/db/client";
import { priceSnapshots } from "@/db/schema";
import { revalidatePath } from "next/cache";

/** 종가 스냅샷을 기록한다 (이미 있는 날짜면 갱신) */
export async function recordPriceSnapshot(formData: FormData) {
  const ticker = String(formData.get("ticker") ?? "").trim();
  const date = String(formData.get("date") ?? "").trim();
  const closePrice = Number(formData.get("closePrice"));

  if (!ticker || !date || !Number.isFinite(closePrice) || closePrice <= 0) {
    throw new Error("종가 입력값이 올바르지 않습니다.");
  }

  await db.insert(priceSnapshots).values({ ticker, date, closePrice });

  revalidatePath("/");
}
