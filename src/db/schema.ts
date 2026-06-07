import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";

// 전략 설정 (종목별 무한매수법 운용 정보)
export const strategies = sqliteTable("strategies", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ticker: text("ticker").notNull(), // 'TQQQ' | 'SOXL'
  principal: real("principal").notNull(), // 원금
  splitCount: integer("split_count").notNull(), // 회차 분할 수 (20 또는 40)
  createdAt: text("created_at").notNull(), // ISO date
});

// 회차 (T)
export const rounds = sqliteTable("rounds", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  strategyId: integer("strategy_id")
    .notNull()
    .references(() => strategies.id),
  roundNo: integer("round_no").notNull(), // T
  targetRate: real("target_rate").notNull(), // 매도 목표 수익률(%) - 공식으로 계산해 저장
  phase: text("phase").notNull(), // '전반전' | '후반전'
  status: text("status").notNull(), // '진행중' | '완료'
  startedAt: text("started_at").notNull(),
  completedAt: text("completed_at"),
});

// 종목 종가 기록 (자동 수집 또는 수동 입력)
export const priceSnapshots = sqliteTable("price_snapshots", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ticker: text("ticker").notNull(),
  date: text("date").notNull(), // ISO date (YYYY-MM-DD)
  closePrice: real("close_price").notNull(),
});

// 그날의 매수/매도 추천 (계산 결과 저장)
export const dailyOrders = sqliteTable("daily_orders", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  strategyId: integer("strategy_id")
    .notNull()
    .references(() => strategies.id),
  date: text("date").notNull(),
  buyPlan: text("buy_plan"), // JSON 문자열: [{price, qty}, ...] 무릎/허벅지 분할 매수 계획
  sellPrice: real("sell_price"), // 목표 매도 지정가
  sellQty: real("sell_qty"),
  riskGauge: integer("risk_gauge"), // 20 | 30 | 40 단계
});

// 실제 체결 기록
export const trades = sqliteTable("trades", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  strategyId: integer("strategy_id")
    .notNull()
    .references(() => strategies.id),
  roundId: integer("round_id").references(() => rounds.id),
  date: text("date").notNull(),
  side: text("side").notNull(), // 'buy' | 'sell'
  price: real("price").notNull(),
  qty: real("qty").notNull(),
});

// 일별 보유 현황 스냅샷 (평단가/보유수량/예수금)
export const holdingsDaily = sqliteTable("holdings_daily", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  strategyId: integer("strategy_id")
    .notNull()
    .references(() => strategies.id),
  date: text("date").notNull(),
  avgPrice: real("avg_price").notNull(), // 평단가
  qty: real("qty").notNull(), // 보유수량
  cashBalance: real("cash_balance").notNull(), // 예수금
});
