import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";

// 전략 설정 (종목별 무한매수법 운용 정보)
export const strategies = sqliteTable("strategies", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ticker: text("ticker").notNull(), // 'TQQQ' | 'SOXL'
  principal: real("principal").notNull(), // 원금
  splitCount: integer("split_count").notNull(), // 분할 수 (20 또는 40)
  crashProtectionPct: integer("crash_protection_pct").notNull().default(20), // 폭락률 보호 구간 (20 또는 30, %)
  createdAt: text("created_at").notNull(), // ISO date
});

// 사이클: T=0(보유 zero)에서 시작해 보유수량이 0이 되어 종료될 때까지의 한 바퀴
export const cycles = sqliteTable("cycles", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  strategyId: integer("strategy_id")
    .notNull()
    .references(() => strategies.id),
  cycleNo: integer("cycle_no").notNull(),
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
  dayHigh: real("day_high"), // 장중 고가 (자동 수집 시에만 채워짐, 지정가 매도의 장중 체결 판단에 사용)
  dayLow: real("day_low"), // 장중 저가 (자동 수집 시에만 채워짐)
});

// 실제 체결 기록
export const trades = sqliteTable("trades", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  strategyId: integer("strategy_id")
    .notNull()
    .references(() => strategies.id),
  cycleId: integer("cycle_id").references(() => cycles.id),
  date: text("date").notNull(),
  side: text("side").notNull(), // 'buy' | 'sell'
  price: real("price").notNull(),
  qty: real("qty").notNull(),
  // T값에 영향을 주는 체결 종류 (V4.0 정의)
  // 'first' = 첫매수(T 0->진행), 'full' = 1회매수(T+1), 'half' = 절반매수(T+0.5),
  // 'extra' = 추가 LOC 매수(T 변화 없음), 'quarterSell' = 쿼터매도(T = 직전T*0.75),
  // 'remainderSell' = 잔여 지정가 매도(T 변화 없음)
  tradeKind: text("trade_kind").notNull(),
  tBefore: real("t_before").notNull(), // 체결 전 T값
  tAfter: real("t_after").notNull(), // 체결 후 T값
});

// 일별 보유 현황 스냅샷 (평단가/보유수량/예수금/T값)
export const holdingsDaily = sqliteTable("holdings_daily", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  strategyId: integer("strategy_id")
    .notNull()
    .references(() => strategies.id),
  date: text("date").notNull(),
  avgPrice: real("avg_price").notNull(), // 평단가
  qty: real("qty").notNull(), // 보유수량
  cashBalance: real("cash_balance").notNull(), // 잔금(예수금)
  tValue: real("t_value").notNull(), // 해당 시점의 T값
});
