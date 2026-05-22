/** 손익·CRMS 매핑 공통 — 예산/분기 항목 제외 */
export function isBudgetOrQuarter(v: string | null | undefined): boolean {
  const s = String(v ?? "").toUpperCase();
  return /(?:^|[^0-9])(1Q|2Q|3Q|4Q)(?:[^0-9]|$)/.test(s) || s.includes("예산") || s.includes("상반기") || s.includes("하반기");
}

const MAPPABLE_ROW_TYPES = new Set([
  "QTY_INPUT",
  "AMT_INPUT",
  "AMT_CALC",
  "SUBTOTAL",
  "TOTAL",
  "GRAND_TOTAL",
]);

export function isPnlRowMappable(rowType: string, rowLabel: string | null | undefined): boolean {
  if (!MAPPABLE_ROW_TYPES.has(rowType)) return false;
  if (isBudgetOrQuarter(rowLabel)) return false;
  return true;
}

export function rowTypeLabel(rowType: string): string {
  switch (rowType) {
    case "QTY_INPUT":
      return "수량";
    case "AMT_INPUT":
      return "금액";
    case "AMT_CALC":
      return "계산";
    case "SUBTOTAL":
      return "소계";
    case "TOTAL":
      return "합계";
    case "GRAND_TOTAL":
      return "총계";
    case "PROFIT_CALC":
      return "이익";
    default:
      return rowType;
  }
}
