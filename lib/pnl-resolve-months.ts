import { isOpCostSubtotalManualRow } from "./pnl-crms-shared";
import type { PnlFeeOption } from "./pnl-fee-options";

export const PNL_GOAL_MONTH_KEYS = Array.from({ length: 12 }, (_, i) => `t_m${String(i + 1).padStart(2, "0")}`);
export const PNL_ACTUAL_MONTH_KEYS = Array.from({ length: 12 }, (_, i) => `a_m${String(i + 1).padStart(2, "0")}`);

export type PnlResolveRow = {
  row_code: string;
  row_type: string;
  calc_mode: string;
  formula_targets: string | null;
  ref_qty_row_code: string | null;
  ref_unit_price_cd: string | null;
  promo_apply_actual?: boolean;
  vat_included_price?: boolean;
  actual_explicit_months?: string | null;
  sort_order: number;
  [key: string]: unknown;
};

export type ResolvedMonths = { goalByMonth: number[]; actualByMonth: number[] };

function toNumber(value: unknown) {
  const n = Number(String(value ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function monthDate(baseYear: number, monthIndexZeroBased: number) {
  return new Date(baseYear, monthIndexZeroBased, 1);
}

function isDateInRange(target: Date, startIso: string | null, endIso: string | null) {
  if (!startIso && !endIso) return true;
  const targetMs = target.getTime();
  if (startIso) {
    const start = new Date(startIso);
    start.setHours(0, 0, 0, 0);
    if (targetMs < start.getTime()) return false;
  }
  if (endIso) {
    const end = new Date(endIso);
    end.setHours(23, 59, 59, 999);
    if (targetMs > end.getTime()) return false;
  }
  return true;
}

function calcSlidingAmount(
  monthQtyRaw: number,
  beforeCumRaw: number,
  tiersRaw: Array<{ minCount: number; maxCount: number; price: number }> = [],
) {
  const monthQty = Math.max(0, Math.floor(monthQtyRaw));
  const beforeCum = Math.max(0, Math.floor(beforeCumRaw));
  if (monthQty === 0) return 0;

  const tiers = [...tiersRaw]
    .map((tier) => ({
      minCount: Math.max(1, Math.floor(tier.minCount)),
      maxCount: Math.max(1, Math.floor(tier.maxCount)),
      price: toNumber(tier.price),
    }))
    .sort((a, b) => a.minCount - b.minCount);
  if (tiers.length === 0) return 0;

  const start = beforeCum + 1;
  const end = beforeCum + monthQty;
  let amount = 0;

  for (const tier of tiers) {
    const overlapStart = Math.max(start, tier.minCount);
    const overlapEnd = Math.min(end, tier.maxCount);
    if (overlapEnd >= overlapStart) {
      amount += (overlapEnd - overlapStart + 1) * tier.price;
    }
  }
  return amount;
}

function calcAmtByPolicy(
  baseYear: number,
  monthlyQtyValues: number[],
  policy: PnlFeeOption | undefined,
  allowPromotion: boolean,
  isVatIncluded: boolean,
) {
  if (!policy) return monthlyQtyValues.map(() => 0);

  const standardTiers = policy.tiers ?? [];
  const isOperationFee = policy.feeCategory === "OPERATION";
  const promotions = allowPromotion ? policy.promotions ?? [] : [];
  let standardCum = 0;
  const promoCumBySeq = new Map<number, number>();

  return monthlyQtyValues.map((qtyRaw, monthIdx) => {
    const qty = Math.max(0, Math.floor(qtyRaw));
    const currentDate = monthDate(baseYear, monthIdx);
    const promo = promotions.find((item) => isDateInRange(currentDate, item.startDate, item.endDate));
    if (promo) {
      const promoCum = promoCumBySeq.get(promo.promoSeq) ?? 0;
      let amount = 0;
      if (promo.isSliding === "Y") {
        amount = calcSlidingAmount(qty, isOperationFee ? 0 : promoCum, promo.tiers ?? []);
      } else {
        amount = qty * toNumber(promo.price);
      }
      if (isVatIncluded) amount = Math.round(amount / 1.1);
      if (!isOperationFee) {
        promoCumBySeq.set(promo.promoSeq, promoCum + qty);
        standardCum += qty;
      }
      return amount;
    }

    let amount = 0;
    if (policy.isSliding === "Y") {
      amount = calcSlidingAmount(qty, isOperationFee ? 0 : standardCum, standardTiers);
    } else {
      amount = qty * toNumber(policy.unitPrice);
    }
    if (isVatIncluded) amount = Math.round(amount / 1.1);
    if (!isOperationFee) standardCum += qty;
    return amount;
  });
}

function parseActualExplicitMonthsSet(csv: unknown): Set<string> {
  return new Set(
    String(csv ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => PNL_ACTUAL_MONTH_KEYS.includes(s)),
  );
}

function allowPromotionForGoal(policy: PnlFeeOption | undefined): boolean {
  if (!policy) return false;
  return String(policy.feeCategory ?? "").toUpperCase() === "SETUP";
}

function allowPromotionForActual(policy: PnlFeeOption | undefined, row: PnlResolveRow): boolean {
  if (!policy) return false;
  if (String(policy.feeCategory ?? "").toUpperCase() === "SETUP") return true;
  return Boolean(row.promo_apply_actual);
}

function isImBankOperationUnyongryoPolicy(policy: PnlFeeOption | undefined): boolean {
  if (!policy) return false;
  if (String(policy.bankCd ?? "").toUpperCase() !== "IM") return false;
  if (String(policy.feeCategory ?? "").toUpperCase() !== "OPERATION") return false;
  const blob = `${policy.serviceType ?? ""} ${policy.label ?? ""}`.toLowerCase().replace(/\s+/g, "");
  return blob.includes("운영료") || blob.includes("유지운영");
}

function isTotalRowEligibleForPartialGoalOverride(
  totalRow: PnlResolveRow,
  allRows: PnlResolveRow[],
  policyByCode: Map<string, PnlFeeOption>,
): boolean {
  if (totalRow.row_type !== "TOTAL") return false;
  const codes = (totalRow.formula_targets || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (codes.length === 0) return false;
  const byCode = new Map(allRows.map((r) => [r.row_code, r]));
  const targets = codes.map((c) => byCode.get(c)).filter(Boolean) as PnlResolveRow[];
  if (targets.length !== codes.length) return false;
  if (!targets.every((t) => t.row_type === "AMT_CALC")) return false;
  return targets.every((t) => {
    const cd = t.ref_unit_price_cd;
    if (!cd) return false;
    return isImBankOperationUnyongryoPolicy(policyByCode.get(cd));
  });
}

/** 손익 그리드 effectiveRows와 동일한 월별 목표·실적 금액(AR/AP 시트) */
export function resolvePnlRowsMonths(
  rows: PnlResolveRow[],
  feeOptions: PnlFeeOption[],
  baseYear: number,
): Map<string, ResolvedMonths> {
  const sorted = [...rows].sort((a, b) => a.sort_order - b.sort_order);
  const byCode = new Map(sorted.map((row) => [row.row_code, row]));
  const policyByCode = new Map(feeOptions.map((item) => [item.code, item]));
  const cache = new Map<string, PnlResolveRow>();
  const out = new Map<string, ResolvedMonths>();

  const resolve = (row: PnlResolveRow): PnlResolveRow => {
    if (cache.has(row.row_code)) return cache.get(row.row_code)!;
    const actualExplicit = parseActualExplicitMonthsSet(row.actual_explicit_months);
    let next = { ...row } as PnlResolveRow;

    const resolvedActualMonth = (r: PnlResolveRow, ak: string, gk: string) => {
      const raw = toNumber(r[ak]);
      if (actualExplicit.has(ak)) return raw;
      if (raw !== 0) return raw;
      return toNumber(r[gk]);
    };

    if (row.row_type === "AMT_CALC" && row.calc_mode === "MANUAL_OVERRIDE") {
      const qtyRow = row.ref_qty_row_code ? byCode.get(row.ref_qty_row_code) : undefined;
      const policy = row.ref_unit_price_cd ? policyByCode.get(row.ref_unit_price_cd) : undefined;
      if (qtyRow && policy) {
        const qtyResolved = resolve(qtyRow);
        const actualQty = PNL_ACTUAL_MONTH_KEYS.map((key) => toNumber(qtyResolved[key]));
        const actualAmounts = calcAmtByPolicy(
          baseYear,
          actualQty,
          policy,
          allowPromotionForActual(policy, row),
          Boolean(row.vat_included_price),
        );
        for (let i = 0; i < 12; i += 1) {
          const gk = PNL_GOAL_MONTH_KEYS[i];
          const ak = PNL_ACTUAL_MONTH_KEYS[i];
          next[gk] = toNumber(row[gk]);
          next[ak] = actualExplicit.has(ak) ? toNumber(row[ak]) : actualAmounts[i];
        }
      } else {
        for (let i = 0; i < 12; i += 1) {
          const gk = PNL_GOAL_MONTH_KEYS[i];
          const ak = PNL_ACTUAL_MONTH_KEYS[i];
          next[ak] = resolvedActualMonth(row, ak, gk);
        }
      }
    } else if (row.row_type === "AMT_CALC" && row.ref_qty_row_code && row.ref_unit_price_cd) {
      const qtyRow = byCode.get(row.ref_qty_row_code);
      const policy = policyByCode.get(row.ref_unit_price_cd);
      if (qtyRow && policy) {
        const qtyResolved = resolve(qtyRow);
        const goalQty = PNL_GOAL_MONTH_KEYS.map((key) => toNumber(qtyResolved[key]));
        const actualQty = PNL_ACTUAL_MONTH_KEYS.map((key) => toNumber(qtyResolved[key]));
        const actualAmounts = calcAmtByPolicy(
          baseYear,
          actualQty,
          policy,
          allowPromotionForActual(policy, row),
          Boolean(row.vat_included_price),
        );
        const goalAmounts = calcAmtByPolicy(
          baseYear,
          goalQty,
          policy,
          allowPromotionForGoal(policy),
          Boolean(row.vat_included_price),
        );
        for (let i = 0; i < 12; i += 1) {
          next[PNL_ACTUAL_MONTH_KEYS[i]] = actualAmounts[i];
          next[PNL_GOAL_MONTH_KEYS[i]] = goalAmounts[i];
        }
      }
    }

    if (row.row_type === "QTY_INPUT" || row.row_type === "AMT_INPUT") {
      for (let i = 0; i < 12; i += 1) {
        const gk = PNL_GOAL_MONTH_KEYS[i];
        const ak = PNL_ACTUAL_MONTH_KEYS[i];
        next[ak] = resolvedActualMonth(row, ak, gk);
      }
    }

    if (row.row_type === "SUBTOTAL") {
      const targets = (row.formula_targets || "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
      const targetRows = targets.map((code) => byCode.get(code)).filter(Boolean) as PnlResolveRow[];
      if (targetRows.length > 0) {
        const resolvedTargets = targetRows.map((target) => resolve(target));
        if (isOpCostSubtotalManualRow(row)) {
          for (const gk of PNL_GOAL_MONTH_KEYS) {
            next[gk] = resolvedTargets.reduce((sum, target) => sum + toNumber(target[gk]), 0);
          }
          for (const ak of PNL_ACTUAL_MONTH_KEYS) {
            next[ak] = actualExplicit.has(ak)
              ? toNumber(row[ak])
              : resolvedTargets.reduce((sum, target) => sum + toNumber(target[ak]), 0);
          }
        } else {
          for (const key of [...PNL_GOAL_MONTH_KEYS, ...PNL_ACTUAL_MONTH_KEYS]) {
            next[key] = resolvedTargets.reduce((sum, target) => sum + toNumber(target[key]), 0);
          }
        }
      }
    } else if (
      row.row_type === "TOTAL" &&
      row.calc_mode === "MANUAL_OVERRIDE" &&
      isTotalRowEligibleForPartialGoalOverride(row, sorted, policyByCode)
    ) {
      const targets = (row.formula_targets || "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
      const targetRows = targets.map((code) => byCode.get(code)).filter(Boolean) as PnlResolveRow[];
      if (targetRows.length > 0) {
        const resolvedTargets = targetRows.map((target) => resolve(target));
        for (let i = 0; i < 12; i += 1) {
          const gk = PNL_GOAL_MONTH_KEYS[i];
          const ak = PNL_ACTUAL_MONTH_KEYS[i];
          next[ak] = resolvedTargets.reduce((sum, target) => sum + toNumber(target[ak]), 0);
          next[gk] = toNumber(row[gk]);
        }
      }
    } else if ((row.row_type === "TOTAL" || row.row_type === "GRAND_TOTAL") && row.calc_mode !== "MANUAL_OVERRIDE") {
      const targets = (row.formula_targets || "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
      const targetRows = targets.map((code) => byCode.get(code)).filter(Boolean) as PnlResolveRow[];
      if (targetRows.length > 0) {
        const resolvedTargets = targetRows.map((target) => resolve(target));
        for (const key of [...PNL_GOAL_MONTH_KEYS, ...PNL_ACTUAL_MONTH_KEYS]) {
          next[key] = resolvedTargets.reduce((sum, target) => sum + toNumber(target[key]), 0);
        }
      }
    }

    cache.set(row.row_code, next);
    return next;
  };

  for (const row of sorted) {
    const resolved = resolve(row);
    out.set(row.row_code, {
      goalByMonth: PNL_GOAL_MONTH_KEYS.map((k) => toNumber(resolved[k])),
      actualByMonth: PNL_ACTUAL_MONTH_KEYS.map((k) => toNumber(resolved[k])),
    });
  }
  return out;
}

/** Prisma 행 → resolve 입력 (월 필드 숫자화) */
export function prismaRowToResolveInput(row: Record<string, unknown>): PnlResolveRow {
  const next: PnlResolveRow = {
    row_code: String(row.row_code ?? ""),
    row_type: String(row.row_type ?? ""),
    calc_mode: String(row.calc_mode ?? "AUTO"),
    formula_targets: row.formula_targets != null ? String(row.formula_targets) : null,
    ref_qty_row_code: row.ref_qty_row_code != null ? String(row.ref_qty_row_code) : null,
    ref_unit_price_cd: row.ref_unit_price_cd != null ? String(row.ref_unit_price_cd) : null,
    promo_apply_actual: Boolean(row.promo_apply_actual),
    vat_included_price: Boolean(row.vat_included_price),
    actual_explicit_months: row.actual_explicit_months != null ? String(row.actual_explicit_months) : null,
    sort_order: Number(row.sort_order ?? 0),
  };
  for (const k of [...PNL_GOAL_MONTH_KEYS, ...PNL_ACTUAL_MONTH_KEYS]) {
    next[k] = Number(row[k] ?? 0);
  }
  return next;
}
