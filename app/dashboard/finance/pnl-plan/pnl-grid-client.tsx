"use client";

import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import { flushSync } from "react-dom";
import {
  cellNoteFlagKey,
  isPnlCellCompleted,
  PnlCellAuditHost,
  readCellCompletion,
  type PnlCellAuditHostRef,
  type PnlCellTargetPayload,
} from "./_components/pnl-cell-audit";

type DepthType = "AR" | "AP" | "OP_COST" | "PROFIT";
type ViewTab = "goal" | "actual";
type RowType = "QTY_INPUT" | "AMT_INPUT" | "AMT_CALC" | "SUBTOTAL" | "TOTAL" | "GRAND_TOTAL" | "PROFIT_CALC";

type PnlRow = {
  pnl_seq: number;
  base_year: number;
  pnl_type: DepthType;
  row_code: string;
  parent_row_code: string | null;
  grade: string | null;
  category1: string | null;
  category2: string | null;
  category3: string | null;
  biz_detail: string | null;
  biz_group: string | null;
  row_label: string | null;
  client_name: string | null;
  row_type: RowType;
  calc_mode: string;
  formula_targets: string | null;
  ref_qty_row_code: string | null;
  ref_unit_price_cd: string | null;
  promo_apply_actual?: boolean;
  vat_included_price?: boolean;
  /** a_m*가 0일 때 목표로 채우지 않을 월 CSV (a_m01,...) — 저장 후에도 유지 */
  actual_explicit_months?: string | null;
  /** 월 셀 완료 표시 JSON — 서버 TB_PNL_MASTER.cell_completion */
  cell_completion?: unknown;
  sort_order: number;
  prev_year_actual: number;
  company_target: number;
  base_ratio: number;
  [key: string]: unknown;
};

type FeeOption = {
  code: string;
  label: string;
  unitPrice: number;
  bankCd?: string;
  feeCategory?: string;
  serviceType?: string;
  isSliding?: string;
  tiers?: Array<{
    minCount: number;
    maxCount: number;
    price: number;
  }>;
  promotions?: Array<{
    promoSeq: number;
    startDate: string | null;
    endDate: string | null;
    isSliding: string;
    price: number;
    tiers: Array<{
      minCount: number;
      maxCount: number;
      price: number;
    }>;
  }>;
};

type ColumnDef = {
  key: string;
  label: string;
  sticky?: boolean;
};

const goalKeys = Array.from({ length: 12 }, (_, i) => `t_m${String(i + 1).padStart(2, "0")}`);
const actualKeys = Array.from({ length: 12 }, (_, i) => `a_m${String(i + 1).padStart(2, "0")}`);
const PNL_COL_SORT = "__pnl_sort__";
const PNL_COL_ACTIONS = "__pnl_actions__";

type CrmsSheetMonthDetail = {
  col_detail: string;
  col_category: string;
  col_code: string;
  col_client: string;
  col_item: string;
  amount: number;
};
type CrmsSheetRow = { hasAny: boolean; months: Record<string, CrmsSheetMonthDetail | null>; yearSum: number };

/** visible 월 키(t_m* / a_m*)에서 짝이 되는 목표·실적 키와 월 번호(1~12) */
function monthPairFromVisibleKey(key: string): { goalKey: string; actualKey: string; monthNum: number } {
  const m = key.match(/_m(0[1-9]|1[0-2])/i);
  const mm = m ? m[1] : "01";
  const monthNum = Number(mm);
  return { goalKey: `t_m${mm}`, actualKey: `a_m${mm}`, monthNum };
}

/** DB의 actual_explicit_months CSV → 월키 집합 */
function parseActualExplicitMonthsSet(csv: unknown): Set<string> {
  return new Set(
    String(csv ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => actualKeys.includes(s)),
  );
}

/** 목표 금액: 개설(SETUP)은 정책상 프로모션 구간을 수량계획에 반영, 운영(OPERATION) 등은 표준 단가만 */
function allowPromotionForGoal(policy: FeeOption | undefined): boolean {
  if (!policy) return false;
  return String(policy.feeCategory ?? "").toUpperCase() === "SETUP";
}

/** 실적 금액: 개설(SETUP)은 목표와 동일하게 정책 프로모션 구간 적용, 그 외는「프로모션 적용(실적)」체크 시에만 */
function allowPromotionForActual(policy: FeeOption | undefined, row: PnlRow): boolean {
  if (!policy) return false;
  if (String(policy.feeCategory ?? "").toUpperCase() === "SETUP") return true;
  return Boolean(row.promo_apply_actual);
}

/** 목표 탭이면 t_m*, 실적 탭이면 a_m*가 선택에 없을 때 추가 — 실적 탭에서 계산 열이 통째로 빠지는 문제 방지 */
function ensureTabMonthKeysInSelection(cols: string[], tab: ViewTab): string[] {
  const set = new Set(cols);
  const monthKeys = tab === "goal" ? goalKeys : actualKeys;
  if (!monthKeys.some((k) => set.has(k))) {
    monthKeys.forEach((k) => set.add(k));
  }
  return Array.from(set);
}
const textCols = ["grade", "category1", "category2", "category3", "biz_detail", "biz_group", "client_name", "row_label"] as const;
function estimateTextWidth(text: string) {
  return Array.from(text || "").reduce((sum, ch) => {
    const code = ch.charCodeAt(0);
    const isKorean = (code >= 0xac00 && code <= 0xd7a3) || (code >= 0x3131 && code <= 0x318e);
    return sum + (isKorean ? 14 : 8);
  }, 0);
}

function widthFromTexts(texts: string[], min = 72, max = 280) {
  const widest = texts.reduce((maxWidth, text) => Math.max(maxWidth, estimateTextWidth(text || "")), 0);
  const px = widest + 28; // 텍스트폭 + 좌우 패딩
  return Math.max(min, Math.min(max, px));
}

function toNumber(value: unknown) {
  const n = Number(String(value ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function withComma(value: unknown) {
  return toNumber(value).toLocaleString("ko-KR");
}

/** 십자 하이라이트 — 행/열 배경(`styleByType`의 bg-*`)보다 위에 오도록 important */
function crosshairShade(rowHi: boolean, colHi: boolean) {
  if (rowHi && colHi) return " !bg-sky-200";
  if (rowHi || colHi) return " !bg-sky-100";
  return "";
}

/** 엑셀처럼 포커스/TAB 이동 시 값 전체 선택 — 타이핑 시 한 번에 덮어쓰기 */
function selectAllOnFocus(e: FocusEvent<HTMLInputElement>) {
  requestAnimationFrame(() => {
    const t = e.target;
    if (t && !t.disabled && document.activeElement === t && typeof t.select === "function") t.select();
  });
}

/** 이미 포커스된 칸을 다시 클릭할 때만 기본 동작 막기 — 첫 클릭에서 포커스가 막히지 않게 */
function inputMouseDownSelectAll(e: MouseEvent<HTMLInputElement>) {
  if (e.currentTarget.disabled) return;
  // 우클릭 시 입력 포커스 + onFocus(flushSync)가 먼저 돌면 행이 한 칸 밀리는 것처럼 보임 → 컨텍스트 메뉴만 쓸 때는 포커스 막기
  if (e.button === 2) {
    e.preventDefault();
    return;
  }
  if (document.activeElement === e.currentTarget) e.preventDefault();
}

function sumByKeys(row: PnlRow, keys: string[]) {
  return keys.reduce((acc, key) => acc + toNumber(row[key]), 0);
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

function calcSlidingAmount(monthQtyRaw: number, beforeCumRaw: number, tiersRaw: Array<{ minCount: number; maxCount: number; price: number }> = []) {
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
      const count = overlapEnd - overlapStart + 1;
      amount += count * tier.price;
    }
  }

  return amount;
}

function calcAmtByPolicy(
  baseYear: number,
  monthlyQtyValues: number[],
  policy: FeeOption | undefined,
  allowPromotion: boolean,
  isVatIncluded: boolean,
) {
  if (!policy) {
    return monthlyQtyValues.map((qty) => qty * 0);
  }

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
      if (isVatIncluded) {
        amount = Math.round(amount / 1.1);
      }
      if (!isOperationFee) {
        promoCumBySeq.set(promo.promoSeq, promoCum + qty);
        // 프로모션 월이어도 개설(SETUP) 등 연간 누적 구간은 YTD 개수를 맞춰야 이후 일반 단가 슬라이딩이 깨지지 않음
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
    if (isVatIncluded) {
      amount = Math.round(amount / 1.1);
    }
    if (!isOperationFee) {
      standardCum += qty;
    }
    return amount;
  });
}

function toFeeCategoryLabel(value?: string) {
  if (value === "SETUP") return "개설단가";
  if (value === "OPERATION") return "운영단가";
  return value ?? "-";
}

function toBankLabel(value?: string) {
  if (value === "HANA") return "하나은행";
  if (value === "IM") return "iM뱅크";
  if (value === "BUSAN") return "부산은행";
  return value ?? "-";
}

function feeOptionDisplay(option: FeeOption) {
  const bank = toBankLabel(option.bankCd);
  const category = toFeeCategoryLabel(option.feeCategory);
  const service = option.serviceType || option.label;
  return `${bank}/${category}/${service}`;
}

function isImBankOperationUnyongryoPolicy(policy: FeeOption | undefined): boolean {
  if (!policy) return false;
  if (String(policy.bankCd ?? "").toUpperCase() !== "IM") return false;
  if (String(policy.feeCategory ?? "").toUpperCase() !== "OPERATION") return false;
  const blob = `${policy.serviceType ?? ""} ${policy.label ?? ""}`.toLowerCase().replace(/\s+/g, "");
  return blob.includes("운영료") || blob.includes("유지운영");
}

function isOverrideAllowed(row: PnlRow, policyByCode: Map<string, FeeOption>) {
  if (row.row_type === "SUBTOTAL") return false;
  if (row.row_type !== "AMT_CALC") return true;
  if (row.ref_unit_price_cd && isImBankOperationUnyongryoPolicy(policyByCode.get(row.ref_unit_price_cd))) {
    return true;
  }
  const target = `${row.category1 ?? ""} ${row.category2 ?? ""} ${row.category3 ?? ""} ${row.biz_detail ?? ""} ${row.biz_group ?? ""} ${row.row_label ?? ""} ${row.client_name ?? ""}`
    .toLowerCase()
    .replace(/\s+/g, " ");
  return ["대구", "부산", "im", "i m", "i_m", "im뱅크", "아이엠", "i엠뱅크"].some((keyword) => target.includes(keyword));
}

function parseProfitTargets(formulaTargets: string | null | undefined) {
  if (!formulaTargets) return { ar: [] as string[], ap: [] as string[] };
  try {
    const parsed = JSON.parse(formulaTargets) as { ar?: string[]; ap?: string[] };
    return {
      ar: Array.isArray(parsed?.ar) ? parsed.ar : [],
      ap: Array.isArray(parsed?.ap) ? parsed.ap : [],
    };
  } catch {
    return { ar: [], ap: [] };
  }
}

function isTotalRowEligibleForPartialGoalOverride(
  totalRow: PnlRow,
  allRows: PnlRow[],
  policyByCode: Map<string, FeeOption>,
): boolean {
  if (totalRow.row_type !== "TOTAL") return false;
  const codes = (totalRow.formula_targets || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (codes.length === 0) return false;
  const byCode = new Map(allRows.map((r) => [r.row_code, r]));
  const targets = codes.map((c) => byCode.get(c)).filter(Boolean) as PnlRow[];
  if (targets.length !== codes.length) return false;
  if (!targets.every((t) => t.row_type === "AMT_CALC")) return false;
  return targets.every((t) => {
    const cd = t.ref_unit_price_cd;
    if (!cd) return false;
    return isImBankOperationUnyongryoPolicy(policyByCode.get(cd));
  });
}

export default function PnlGridClient({ initialYear }: { initialYear: number }) {
  const [year, setYear] = useState(initialYear);
  const yy = String(year).slice(-2);
  const prevYy = String(year - 1).slice(-2);
  const [viewTab, setViewTab] = useState<ViewTab>("goal");
  const [depthType, setDepthType] = useState<DepthType>("AR");
  const [rows, setRows] = useState<PnlRow[]>([]);
  const [profitArRows, setProfitArRows] = useState<PnlRow[]>([]);
  const [profitApRows, setProfitApRows] = useState<PnlRow[]>([]);
  const [feeOptions, setFeeOptions] = useState<FeeOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [dirty, setDirty] = useState<Record<number, PnlRow>>({});
  const [setupStarted, setSetupStarted] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [showColumnSetting, setShowColumnSetting] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [editRowSeq, setEditRowSeq] = useState<number | null>(null);
  const [selectedColumns, setSelectedColumns] = useState<string[]>([]);
  const [metaLoading, setMetaLoading] = useState(true);
  const [goalEditMode, setGoalEditMode] = useState(false);
  const [monthEditFocus, setMonthEditFocus] = useState<{ pnlSeq: number; key: string } | null>(null);
  const [monthEditDraft, setMonthEditDraft] = useState<string>("");
  const [hoverPnlSeq, setHoverPnlSeq] = useState<number | null>(null);
  const [hoverColKey, setHoverColKey] = useState<string | null>(null);
  const cellAuditRef = useRef<PnlCellAuditHostRef>(null);
  const [form, setForm] = useState({
    grade: "",
    category1: "",
    category2: "",
    category3: "",
    biz_detail: "",
    biz_group: "",
    client_name: "",
    row_label: "",
    row_type: "QTY_INPUT" as RowType,
    formula_targets: [] as string[],
    profit_ar_targets: [] as string[],
    profit_ap_targets: [] as string[],
    ref_qty_row_code: "",
    ref_unit_price_cd: "",
    promo_apply_actual: false,
    vat_included_price: false,
  });
  const [editForm, setEditForm] = useState({
    grade: "",
    category1: "",
    category2: "",
    category3: "",
    biz_detail: "",
    biz_group: "",
    client_name: "",
    row_label: "",
    row_type: "QTY_INPUT" as RowType,
    formula_targets: [] as string[],
    profit_ar_targets: [] as string[],
    profit_ap_targets: [] as string[],
    ref_qty_row_code: "",
    ref_unit_price_cd: "",
    promo_apply_actual: false,
    vat_included_price: false,
  });

  const yearOptions = useMemo(() => {
    const base = new Date().getFullYear();
    return Array.from({ length: 6 }, (_, i) => base - 2 + i);
  }, []);

  const baseColumns: ColumnDef[] = useMemo(
    () => [
      { key: "grade", label: "등급", sticky: true },
      { key: "category1", label: "계정과목", sticky: true },
      { key: "category2", label: "구분", sticky: true },
      { key: "category3", label: "사업상세", sticky: true },
      { key: "biz_detail", label: "사업구분", sticky: true },
      { key: "biz_group", label: "코드", sticky: true },
      { key: "client_name", label: "거래처", sticky: true },
      { key: "row_label", label: "항목", sticky: true },
      { key: "prev_year_actual", label: `${prevYy}년도 실적` },
      { key: "target_sum", label: `${yy}년 목표` },
      { key: "actual_sum", label: `${yy}년 실적` },
      { key: "gap1", label: `${yy}-${prevYy} GAP` },
      { key: "gap1_rate", label: `${yy}-${prevYy} GAP 비율` },
      { key: "company_target", label: "회사목표" },
      { key: "gap2", label: "실적-목표 GAP" },
      { key: "gap2_rate", label: "실적-목표 GAP 비율" },
      { key: "base_ratio", label: `${yy}년비율` },
    ],
    [yy, prevYy],
  );
  const defaultSelectedColumns = useMemo(
    () => [...baseColumns.map((c) => c.key), ...goalKeys, ...actualKeys],
    [baseColumns],
  );

  const readJsonSafe = async (res: Response) => {
    const raw = await res.text();
    if (!raw) return {};
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return {};
    }
  };

  const [cellNoteFlags, setCellNoteFlags] = useState<Record<string, boolean>>({});
  const [cellHistoryFlags, setCellHistoryFlags] = useState<Record<string, boolean>>({});
  const [showCompareModal, setShowCompareModal] = useState(false);
  const [compareDraftGoalActual, setCompareDraftGoalActual] = useState(false);
  const [compareDraftCrms, setCompareDraftCrms] = useState(false);
  const [compareSavedGoalActual, setCompareSavedGoalActual] = useState(false);
  const [compareSavedCrms, setCompareSavedCrms] = useState(false);
  const [crmsSheet, setCrmsSheet] = useState<Record<number, CrmsSheetRow>>({});
  const comparePaneActive = compareSavedGoalActual || compareSavedCrms;

  const loadCellNoteFlags = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/pnl/cell?summary=1&base_year=${encodeURIComponent(String(year))}&pnl_type=${encodeURIComponent(depthType)}`,
      );
      const json = await readJsonSafe(res);
      if (!res.ok) return;
      setCellNoteFlags((json.flags as Record<string, boolean>) || {});
      setCellHistoryFlags((json.historyFlags as Record<string, boolean>) || {});
    } catch {
      setCellNoteFlags({});
      setCellHistoryFlags({});
    }
  }, [year, depthType]);

  const loadCrmsSheet = useCallback(async () => {
    if (!compareSavedCrms) {
      setCrmsSheet({});
      return;
    }
    try {
      const res = await fetch(
        `/api/pnl/crms-mapping?mode=sheet_grid&base_year=${encodeURIComponent(String(year))}&pnl_type=${encodeURIComponent(depthType)}`,
      );
      const json = await readJsonSafe(res);
      if (!res.ok) return;
      const raw = (json.byPnlSeq as Record<string, CrmsSheetRow>) || {};
      const mapped: Record<number, CrmsSheetRow> = {};
      for (const [k, v] of Object.entries(raw)) {
        mapped[Number(k)] = v;
      }
      setCrmsSheet(mapped);
    } catch {
      setCrmsSheet({});
    }
  }, [year, depthType, compareSavedCrms]);

  useEffect(() => {
    void loadCrmsSheet();
  }, [loadCrmsSheet]);

  const loadRows = async () => {
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/pnl?year=${year}&type=${depthType}`);
      const json = await readJsonSafe(res);
      const errMessage = typeof json.message === "string" ? json.message : "조회 실패";
      if (!res.ok) throw new Error(errMessage);
      setRows(Array.isArray(json.rows) ? (json.rows as PnlRow[]) : []);
      setDirty({});
      if (Array.isArray(json.rows) && json.rows.length > 0) setSetupStarted(true);
      void loadCellNoteFlags();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "조회 오류");
    } finally {
      setLoading(false);
    }
  };

  const loadProfitSources = async () => {
    try {
      const [arRes, apRes] = await Promise.all([
        fetch(`/api/pnl?year=${year}&type=AR`),
        fetch(`/api/pnl?year=${year}&type=AP`),
      ]);
      const [arJson, apJson] = await Promise.all([readJsonSafe(arRes), readJsonSafe(apRes)]);
      setProfitArRows(Array.isArray(arJson.rows) ? (arJson.rows as PnlRow[]) : []);
      setProfitApRows(Array.isArray(apJson.rows) ? (apJson.rows as PnlRow[]) : []);
    } catch {
      setProfitArRows([]);
      setProfitApRows([]);
    }
  };

  const loadMeta = async () => {
    setMetaLoading(true);
    try {
      const res = await fetch(`/api/pnl?mode=meta&viewTab=${viewTab}&depthType=${depthType}`);
      const json = await readJsonSafe(res);
      if (!res.ok) {
        setMessage((json.message as string) || "항목 설정 메타 조회 실패");
        setSelectedColumns(defaultSelectedColumns);
        return;
      }
      setFeeOptions(Array.isArray(json.feeOptions) ? (json.feeOptions as FeeOption[]) : []);
      const preset = Array.isArray(json.selectedColumns) ? (json.selectedColumns as string[]) : null;
      const baseCols = preset && preset.length > 0 ? [...preset] : [...defaultSelectedColumns];
      setSelectedColumns(ensureTabMonthKeysInSelection(baseCols, viewTab));
    } catch {
      setMessage("항목 설정 메타 조회 중 오류가 발생했습니다.");
      setSelectedColumns(defaultSelectedColumns);
    } finally {
      setMetaLoading(false);
    }
  };

  useEffect(() => {
    void loadMeta();
  }, [viewTab, depthType, defaultSelectedColumns]);

  useEffect(() => {
    void loadRows();
  }, [year, depthType]);

  useEffect(() => {
    void loadProfitSources();
  }, [year]);

  const effectiveRows = useMemo(() => {
    const sorted = [...rows].sort((a, b) => a.sort_order - b.sort_order);
    const byCode = new Map(sorted.map((row) => [row.row_code, row]));
    const profitArByCode = new Map(profitArRows.map((row) => [row.row_code, row]));
    const profitApByCode = new Map(profitApRows.map((row) => [row.row_code, row]));
    const policyByCode = new Map(feeOptions.map((item) => [item.code, item]));
    const cache = new Map<string, PnlRow>();

    const resolve = (row: PnlRow): PnlRow => {
      if (cache.has(row.row_code)) return cache.get(row.row_code)!;
      const actualExplicit = parseActualExplicitMonthsSet(row.actual_explicit_months);
      let next = { ...row } as PnlRow;

      const resolvedActualMonth = (r: PnlRow, ak: string, gk: string) => {
        const raw = toNumber(r[ak]);
        if (actualExplicit.has(ak)) return raw;
        if (raw !== 0) return raw;
        return toNumber(r[gk]);
      };

      if (row.row_type === "AMT_CALC" && row.calc_mode === "MANUAL_OVERRIDE") {
        const qtyRow = row.ref_qty_row_code ? byCode.get(row.ref_qty_row_code) : undefined;
        const policy = row.ref_unit_price_cd ? policyByCode.get(row.ref_unit_price_cd) : undefined;
        if (qtyRow && policy) {
          // 목표만 수기(MANUAL)여도 실적 금액은 참조 개수→단가 계산 유지. 실적 월을 직접 고친 경우만 actual_explicit_months에 있으면 DB값 사용.
          const qtyResolved = resolve(qtyRow);
          const actualQty = actualKeys.map((key) => toNumber(qtyResolved[key]));
          const actualAmounts = calcAmtByPolicy(
            year,
            actualQty,
            policy,
            allowPromotionForActual(policy, row),
            Boolean(row.vat_included_price),
          );
          for (let i = 0; i < 12; i += 1) {
            const gk = goalKeys[i];
            const ak = actualKeys[i];
            next[gk] = toNumber(row[gk]);
            next[ak] = actualExplicit.has(ak) ? toNumber(row[ak]) : actualAmounts[i];
          }
        } else {
          for (let i = 0; i < 12; i += 1) {
            const gk = goalKeys[i];
            const ak = actualKeys[i];
            next[ak] = resolvedActualMonth(row, ak, gk);
          }
        }
      } else if (row.row_type === "AMT_CALC" && row.ref_qty_row_code && row.ref_unit_price_cd) {
        const qtyRow = byCode.get(row.ref_qty_row_code);
        const policy = policyByCode.get(row.ref_unit_price_cd);
        if (qtyRow && policy) {
          const qtyResolved = resolve(qtyRow);
          const goalQty = goalKeys.map((key) => toNumber(qtyResolved[key]));
          const actualQty = actualKeys.map((key) => toNumber(qtyResolved[key]));
          const actualAmounts = calcAmtByPolicy(
            year,
            actualQty,
            policy,
            allowPromotionForActual(policy, row),
            Boolean(row.vat_included_price),
          );
          for (let i = 0; i < 12; i += 1) {
            next[actualKeys[i]] = actualAmounts[i];
          }
          const goalAmounts = calcAmtByPolicy(
            year,
            goalQty,
            policy,
            allowPromotionForGoal(policy),
            Boolean(row.vat_included_price),
          );
          for (let i = 0; i < 12; i += 1) {
            next[goalKeys[i]] = goalAmounts[i];
          }
        }
      }
      if (row.row_type === "QTY_INPUT" || row.row_type === "AMT_INPUT") {
        for (let i = 0; i < 12; i += 1) {
          const gk = goalKeys[i];
          const ak = actualKeys[i];
          next[ak] = resolvedActualMonth(row, ak, gk);
        }
      }

      if (row.row_type === "SUBTOTAL") {
        const targets = (row.formula_targets || "")
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean);
        const targetRows = targets.map((code) => byCode.get(code)).filter(Boolean) as PnlRow[];
        if (targetRows.length > 0) {
          const resolvedTargets = targetRows.map((target) => resolve(target));
          for (const key of [...goalKeys, ...actualKeys]) {
            next[key] = resolvedTargets.reduce((sum, target) => sum + toNumber(target[key]), 0);
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
        const targetRows = targets.map((code) => byCode.get(code)).filter(Boolean) as PnlRow[];
        if (targetRows.length > 0) {
          const resolvedTargets = targetRows.map((target) => resolve(target));
          for (let i = 0; i < 12; i += 1) {
            const gk = goalKeys[i];
            const ak = actualKeys[i];
            next[ak] = resolvedTargets.reduce((sum, target) => sum + toNumber(target[ak]), 0);
            next[gk] = toNumber(row[gk]);
          }
        }
      } else if ((row.row_type === "TOTAL" || row.row_type === "GRAND_TOTAL") && row.calc_mode !== "MANUAL_OVERRIDE") {
        const targets = (row.formula_targets || "")
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean);
        const targetRows = targets.map((code) => byCode.get(code)).filter(Boolean) as PnlRow[];
        if (targetRows.length > 0) {
          const resolvedTargets = targetRows.map((target) => resolve(target));
          for (const key of [...goalKeys, ...actualKeys]) {
            next[key] = resolvedTargets.reduce((sum, target) => sum + toNumber(target[key]), 0);
          }
        }
      }

      if (row.row_type === "PROFIT_CALC" && row.calc_mode !== "MANUAL_OVERRIDE") {
        const targets = parseProfitTargets(row.formula_targets);
        const arTargets = targets.ar.map((code) => profitArByCode.get(code)).filter(Boolean) as PnlRow[];
        const apTargets = targets.ap.map((code) => profitApByCode.get(code)).filter(Boolean) as PnlRow[];
        for (const key of [...goalKeys, ...actualKeys]) {
          const arSum = arTargets.reduce((sum, target) => sum + toNumber(target[key]), 0);
          const apSum = apTargets.reduce((sum, target) => sum + toNumber(target[key]), 0);
          next[key] = arSum - apSum;
        }
      }

      cache.set(row.row_code, next);
      return next;
    };

    return sorted.map(resolve);
  }, [rows, feeOptions, year, profitArRows, profitApRows]);

  const patchRow = (pnlSeq: number, patch: Partial<PnlRow>) => {
    setRows((prev) => {
      const row = prev.find((r) => r.pnl_seq === pnlSeq);
      if (!row) {
        return prev.map((r) => (r.pnl_seq === pnlSeq ? { ...r, ...patch } : r));
      }
      let merged: Partial<PnlRow> = { ...patch };
      if (viewTab === "actual") {
        const touched = Object.keys(patch).filter((k) => actualKeys.includes(k));
        if (touched.length > 0) {
          const enteringManualAmtFromAuto =
            row.row_type === "AMT_CALC" &&
            row.calc_mode !== "MANUAL_OVERRIDE" &&
            patch.calc_mode === "MANUAL_OVERRIDE";

          const set = new Set(
            String(row.actual_explicit_months ?? "")
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean),
          );
          if (enteringManualAmtFromAuto) {
            // AUTO→MANUAL 시드(전월 복사): explicit을 건드리지 않음 → resolve에서 실적 금액은 계산값 우선
          } else if (
            row.row_type === "AMT_CALC" &&
            (row.calc_mode === "MANUAL_OVERRIDE" || patch.calc_mode === "MANUAL_OVERRIDE")
          ) {
            for (const m of touched) {
              set.add(m);
            }
            merged.actual_explicit_months = set.size > 0 ? [...set].sort().join(",") : null;
          } else {
            for (const m of touched) {
              const v = toNumber((patch as Record<string, unknown>)[m]);
              if (v !== 0) set.delete(m);
              else set.add(m);
            }
            merged.actual_explicit_months = set.size > 0 ? [...set].sort().join(",") : null;
          }
        }
      }
      const next = prev.map((r) => (r.pnl_seq === pnlSeq ? { ...r, ...merged } : r));
      const target = next.find((r) => r.pnl_seq === pnlSeq);
      if (target) setDirty((prevDirty) => ({ ...prevDirty, [pnlSeq]: target }));
      return next;
    });
  };

  const addRow = async () => {
    const payload = {
      ...form,
      baseYear: year,
      pnlType: depthType,
      formula_targets:
        form.row_type === "PROFIT_CALC"
          ? JSON.stringify({
              ar: form.profit_ar_targets,
              ap: form.profit_ap_targets,
            })
          : form.formula_targets.join(","),
      ref_qty_row_code: form.ref_qty_row_code || null,
      ref_unit_price_cd: form.ref_unit_price_cd || null,
      promo_apply_actual: form.promo_apply_actual,
      vat_included_price: form.vat_included_price,
    };
    const res = await fetch("/api/pnl", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json = await readJsonSafe(res);
    if (!res.ok) {
      setMessage(typeof json.message === "string" ? json.message : "행 추가 실패");
      return;
    }
    setShowAdd(false);
    setForm({
      grade: "",
      category1: "",
      category2: "",
      category3: "",
      biz_detail: "",
      biz_group: "",
      client_name: "",
      row_label: "",
      row_type: "QTY_INPUT",
      formula_targets: [],
      profit_ar_targets: [],
      profit_ap_targets: [],
      ref_qty_row_code: "",
      ref_unit_price_cd: "",
      promo_apply_actual: false,
      vat_included_price: false,
    });
    await loadRows();
  };

  const saveChanges = async () => {
    const updates = Object.values(dirty);
    if (updates.length === 0) return;
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/pnl", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ updates }),
      });
      const json = await readJsonSafe(res);
      const errMessage = typeof json.message === "string" ? json.message : "저장 실패";
      if (!res.ok) throw new Error(errMessage);
      setMessage(typeof json.message === "string" ? json.message : "저장되었습니다.");
      await loadRows();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "저장 오류");
    } finally {
      setSaving(false);
    }
  };

  const saveColumnSetting = async () => {
    try {
      const res = await fetch("/api/pnl", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "columns", viewTab, depthType, selectedColumns }),
      });
      const json = await readJsonSafe(res);
      setMessage((json.message as string) || (res.ok ? "항목 설정 저장 완료" : "항목 설정 저장 실패"));
      setShowColumnSetting(false);
    } catch {
      setMessage("항목 설정 저장 중 오류가 발생했습니다.");
    }
  };

  const deleteRow = async (row: PnlRow) => {
    const label = row.row_label?.trim() || row.row_code || "이름 없음";
    const ok = confirm(
      `이 작업은 되돌릴 수 없습니다.\n\n` +
        `삭제 대상: ${label}\n` +
        `행 코드: ${row.row_code}\n\n` +
        `정말 DB에서 이 행을 삭제하시겠습니까?`,
    );
    if (!ok) return;
    const res = await fetch(`/api/pnl?pnlSeq=${row.pnl_seq}`, { method: "DELETE" });
    const json = await readJsonSafe(res);
    if (!res.ok) {
      setMessage(typeof json.message === "string" ? json.message : "삭제 실패");
      return;
    }
    setMessage(typeof json.message === "string" ? json.message : "삭제되었습니다.");
    await loadRows();
  };

  const openEditModal = (row: PnlRow) => {
    const profitTargets = parseProfitTargets(row.formula_targets);
    setEditRowSeq(row.pnl_seq);
    setEditForm({
      grade: String(row.grade ?? ""),
      category1: String(row.category1 ?? ""),
      category2: String(row.category2 ?? ""),
      category3: String(row.category3 ?? ""),
      biz_detail: String(row.biz_detail ?? ""),
      biz_group: String(row.biz_group ?? ""),
      client_name: String(row.client_name ?? ""),
      row_label: String(row.row_label ?? ""),
      row_type: row.row_type,
      formula_targets: (row.formula_targets || "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
      profit_ar_targets: profitTargets.ar,
      profit_ap_targets: profitTargets.ap,
      ref_qty_row_code: String(row.ref_qty_row_code ?? ""),
      ref_unit_price_cd: String(row.ref_unit_price_cd ?? ""),
      promo_apply_actual: Boolean(row.promo_apply_actual),
      vat_included_price: Boolean(row.vat_included_price),
    });
    setShowEdit(true);
  };

  const applyEditRow = () => {
    if (!editRowSeq) return;
    patchRow(editRowSeq, {
      grade: editForm.grade || null,
      category1: editForm.category1 || null,
      category2: editForm.category2 || null,
      category3: editForm.category3 || null,
      biz_detail: editForm.biz_detail || null,
      biz_group: editForm.biz_group || null,
      client_name: editForm.client_name || null,
      row_label: editForm.row_label || null,
      row_type: editForm.row_type,
      formula_targets:
        editForm.row_type === "PROFIT_CALC"
          ? JSON.stringify({
              ar: editForm.profit_ar_targets,
              ap: editForm.profit_ap_targets,
            })
          : editForm.row_type === "SUBTOTAL" || editForm.row_type === "TOTAL" || editForm.row_type === "GRAND_TOTAL"
          ? editForm.formula_targets.join(",")
          : null,
      ref_qty_row_code: editForm.row_type === "AMT_CALC" ? editForm.ref_qty_row_code || null : null,
      ref_unit_price_cd: editForm.row_type === "AMT_CALC" ? editForm.ref_unit_price_cd || null : null,
      promo_apply_actual: editForm.row_type === "AMT_CALC" ? editForm.promo_apply_actual : false,
      vat_included_price: editForm.row_type === "AMT_CALC" ? editForm.vat_included_price : false,
    });
    setShowEdit(false);
    setEditRowSeq(null);
    setMessage("행 수정 내용이 반영되었습니다. 저장 버튼을 눌러 확정하세요.");
  };

  const moveRow = (pnlSeq: number, direction: "up" | "down") => {
    setRows((prev) => {
      const sorted = [...prev].sort((a, b) => a.sort_order - b.sort_order);
      const idx = sorted.findIndex((row) => row.pnl_seq === pnlSeq);
      if (idx < 0) return prev;
      const targetIdx = direction === "up" ? idx - 1 : idx + 1;
      if (targetIdx < 0 || targetIdx >= sorted.length) return prev;

      [sorted[idx], sorted[targetIdx]] = [sorted[targetIdx], sorted[idx]];
      const reordered = sorted.map((row, orderIdx) => ({
        ...row,
        sort_order: orderIdx + 1,
      }));
      reordered.forEach((row) => {
        setDirty((prevDirty) => ({ ...prevDirty, [row.pnl_seq]: row }));
      });
      return reordered;
    });
  };

  const currentMonthKeys = viewTab === "goal" ? goalKeys : actualKeys;
  const monthHeaderSuffix = viewTab === "goal" ? "목표" : "실적";
  const qtyRows = rows.filter((row) => row.row_type === "QTY_INPUT");
  const canEditGoal = viewTab === "goal" ? goalEditMode : true;
  const showOrderActions = viewTab === "goal" && goalEditMode;
  const showOrderActionsEffective = showOrderActions && !comparePaneActive;
  const hasPromoByCode = useMemo(
    () =>
      new Map(
        feeOptions.map((item) => [
          item.code,
          Array.isArray(item.promotions) && item.promotions.length > 0,
        ]),
      ),
    [feeOptions],
  );
  const policyByCode = useMemo(() => new Map(feeOptions.map((item) => [item.code, item])), [feeOptions]);
  const stickyWidths = useMemo(() => {
    const headers = ["등급", "계정과목", "구분", "사업상세", "사업구분", "코드", "거래처", "항목"];
    const keyMap: Array<(row: PnlRow) => string> = [
      (r) => String(r.grade ?? ""),
      (r) => String(r.category1 ?? ""),
      (r) => String(r.category2 ?? ""),
      (r) => String(r.category3 ?? ""),
      (r) => String(r.biz_detail ?? ""),
      (r) => String(r.biz_group ?? ""),
      (r) => String(r.client_name ?? ""),
      (r) => String(r.row_label ?? ""),
    ];
    const minByColumn = [44, 72, 72, 76, 76, 64, 80, 120];
    return headers.map((header, idx) => {
      const values = effectiveRows.map((row) => keyMap[idx](row));
      const dynamicWidth = widthFromTexts([header, ...values], minByColumn[idx], idx === 7 ? 460 : 220);
      if (idx === 0) return Math.min(52, dynamicWidth); // 등급 컬럼은 좁게 고정
      return dynamicWidth;
    });
  }, [effectiveRows]);
  const stickyLefts = useMemo(
    () => stickyWidths.map((_, idx) => stickyWidths.slice(0, idx).reduce((sum, width) => sum + width, 0)),
    [stickyWidths],
  );
  const prevYearWidth = useMemo(() => {
    const values = effectiveRows.map((row) => withComma(row.prev_year_actual));
    return widthFromTexts([`${prevYy}년도 실적`, ...values], 110, 180);
  }, [effectiveRows, prevYy]);
  const prevYearLeft = useMemo(() => stickyWidths.reduce((sum, width) => sum + width, 0), [stickyWidths]);
  const monthColWidth = useMemo(() => {
    const allMonthValues = effectiveRows.flatMap((row) =>
      [...goalKeys, ...actualKeys].map((key) => withComma(row[key])),
    );
    return widthFromTexts([`12월 ${monthHeaderSuffix}`, ...allMonthValues], 94, 170);
  }, [effectiveRows, monthHeaderSuffix]);

  const stickyKeyOrder = ["grade", "category1", "category2", "category3", "biz_detail", "biz_group", "client_name", "row_label"];
  const stickyWidthMap = useMemo(() => {
    const map: Record<string, number> = {};
    stickyKeyOrder.forEach((key, idx) => {
      map[key] = stickyWidths[idx];
    });
    return map;
  }, [stickyWidths]);
  const visibleBaseColumns = useMemo(
    () =>
      baseColumns.filter((col) =>
        (selectedColumns.length > 0 ? selectedColumns : defaultSelectedColumns).includes(col.key),
      ),
    [baseColumns, selectedColumns, defaultSelectedColumns],
  );
  const visibleMonthKeys = useMemo(() => {
    const pool = selectedColumns.length > 0 ? selectedColumns : defaultSelectedColumns;
    const picked = currentMonthKeys.filter((key) => pool.includes(key));
    if (picked.length === 0) return [...currentMonthKeys];
    return picked;
  }, [currentMonthKeys, selectedColumns, defaultSelectedColumns]);
  const stickyLeftMap = useMemo(() => {
    const map: Record<string, number> = {};
    let left = 0;
    for (const col of visibleBaseColumns) {
      if (!stickyKeyOrder.includes(col.key)) continue;
      map[col.key] = left;
      left += stickyWidthMap[col.key] ?? 100;
    }
    return map;
  }, [visibleBaseColumns, stickyWidthMap]);
  const compareLabelColW = 40;
  const COMPARE_SUMMARY_KEYS = ["row_label", "target_sum", "actual_sum"] as const;
  const compareBaseSplit = useMemo((): {
    before: ColumnDef[];
    trio: ColumnDef[];
    after: ColumnDef[];
    trioColSpan: number;
  } => {
    const cols = visibleBaseColumns;
    const trioOrdered: ColumnDef[] = [];
    for (const k of COMPARE_SUMMARY_KEYS) {
      const c = cols.find((x) => x.key === k);
      if (c) trioOrdered.push(c);
    }
    if (trioOrdered.length === 0) {
      return { before: cols, trio: [], after: [], trioColSpan: 0 };
    }
    const idxs = trioOrdered.map((t) => cols.findIndex((c) => c.key === t.key));
    const lo = Math.min(...idxs);
    const hi = Math.max(...idxs);
    return {
      before: cols.slice(0, lo),
      trio: trioOrdered,
      after: cols.slice(hi + 1),
      trioColSpan: trioOrdered.length,
    };
  }, [visibleBaseColumns]);
  const compareLabelLeft = useMemo(() => {
    let w = 0;
    for (const col of visibleBaseColumns) {
      if (stickyKeyOrder.includes(col.key)) w += stickyWidthMap[col.key] ?? 100;
      else if (col.key === "prev_year_actual") w += prevYearWidth;
      else w += monthColWidth;
    }
    return w;
  }, [visibleBaseColumns, stickyWidthMap, prevYearWidth, monthColWidth]);
  const tableTrailingColSpan =
    visibleBaseColumns.length +
    (comparePaneActive ? 1 : 0) +
    visibleMonthKeys.length +
    (showOrderActionsEffective ? 2 : 0);

  type CompareKind = "tab" | "goal" | "actual" | "crms";
  const compareLayersForRow = useCallback(
    (row: PnlRow): { label: string; kind: CompareKind }[] => {
      if (!comparePaneActive) return [{ label: "", kind: "tab" }];
      const crmsOn = compareSavedCrms && Boolean(crmsSheet[row.pnl_seq]?.hasAny);
      if (compareSavedGoalActual && crmsOn) {
        return [
          { label: "목표", kind: "goal" },
          { label: "실적", kind: "actual" },
          { label: "CRMS", kind: "crms" },
        ];
      }
      if (compareSavedGoalActual) {
        return [
          { label: "목표", kind: "goal" },
          { label: "실적", kind: "actual" },
        ];
      }
      if (crmsOn) {
        return [
          { label: viewTab === "goal" ? "목표" : "실적", kind: "tab" },
          { label: "CRMS", kind: "crms" },
        ];
      }
      return [{ label: viewTab === "goal" ? "목표" : "실적", kind: "tab" }];
    },
    [comparePaneActive, compareSavedGoalActual, compareSavedCrms, crmsSheet, viewTab],
  );

  const buildCellAuditPayload = useCallback((row: PnlRow, key: string, monthIdx: number): PnlCellTargetPayload => {
    return {
      pnl_seq: row.pnl_seq,
      cell_key: key,
      monthLabel: `${monthIdx + 1}월`,
      cell_completion: readCellCompletion(row),
      snap: {
        category3: row.category3,
        category2: row.category2,
        biz_group: row.biz_group,
        client_name: row.client_name,
        row_label: row.row_label,
        biz_detail: row.biz_detail,
        goalVal: toNumber(row[goalKeys[monthIdx]]),
        actualVal: toNumber(row[actualKeys[monthIdx]]),
      },
    };
  }, []);

  return (
    <div className="min-w-0 space-y-4">
      <PnlCellAuditHost
        ref={cellAuditRef}
        patchRow={patchRow}
        setBanner={setMessage}
        onCellNotesMutated={loadCellNoteFlags}
        mappingSheet={{ year, pnlType: depthType }}
      />
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h1 className="text-2xl font-bold text-slate-900">{year}년 손익계획</h1>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={year}
            onChange={(e) => setYear(toNumber(e.target.value) || initialYear)}
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
          >
            {yearOptions.map((option) => (
              <option key={option} value={option}>
                {option}년
              </option>
            ))}
          </select>
          <button
            type="button"
            className={`rounded-md px-3 py-1.5 text-sm font-semibold ${viewTab === "goal" ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-700"}`}
            onClick={() => setViewTab("goal")}
          >
            목표
          </button>
          <button
            type="button"
            className={`rounded-md px-3 py-1.5 text-sm font-semibold ${viewTab === "actual" ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-700"}`}
            onClick={() => {
              setViewTab("actual");
              setGoalEditMode(false);
            }}
          >
            실적
          </button>
          <button
            type="button"
            disabled={viewTab !== "goal"}
            title={viewTab !== "goal" ? "목표 탭에서만 사용할 수 있습니다." : undefined}
            className={`rounded-md px-3 py-1.5 text-sm font-semibold ${
              viewTab !== "goal"
                ? "cursor-not-allowed bg-slate-100 text-slate-400"
                : goalEditMode
                  ? "bg-amber-600 text-white"
                  : "bg-slate-200 text-slate-700"
            }`}
            onClick={() => {
              if (viewTab !== "goal") return;
              setGoalEditMode((prev) => !prev);
            }}
          >
            목표 편집 {goalEditMode ? "ON" : "OFF"}
          </button>
        </div>
      </div>

      {message ? <p className="text-sm text-slate-700">{message}</p> : null}

      {rows.length === 0 && !loading && !setupStarted ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-10 text-center">
          <button
            type="button"
            onClick={() => setSetupStarted(true)}
            className="rounded-lg bg-indigo-600 px-6 py-3 text-base font-semibold text-white hover:bg-indigo-700"
          >
            목표 설정
          </button>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <div className="flex flex-wrap items-center gap-2">
              {[
                { key: "AR", label: "AR" },
                { key: "AP", label: "AP" },
                { key: "OP_COST", label: "부서운영비" },
                { key: "PROFIT", label: "영업이익" },
              ].map((item) => (
                <button
                  key={item.key}
                  type="button"
                  className={`rounded-md px-3 py-1.5 text-sm font-semibold ${depthType === item.key ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-700"}`}
                  onClick={() => setDepthType(item.key as DepthType)}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                className={`rounded-md border px-3 py-1.5 text-sm font-semibold ${
                  comparePaneActive ? "border-indigo-400 bg-indigo-50 text-indigo-800" : "border-slate-300 text-slate-700"
                }`}
                onClick={() => {
                  setCompareDraftGoalActual(compareSavedGoalActual);
                  setCompareDraftCrms(compareSavedCrms);
                  setShowCompareModal(true);
                }}
              >
                같이보기
              </button>
              <button
                type="button"
                className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-700"
                onClick={() => setShowColumnSetting(true)}
              >
                항목 설정
              </button>
              <button type="button" className="rounded-md bg-slate-800 px-3 py-1.5 text-sm font-semibold text-white" onClick={() => setShowAdd(true)}>
                행 추가
              </button>
              <button
                type="button"
                disabled={saving || Object.keys(dirty).length === 0}
                className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-emerald-300"
                onClick={saveChanges}
              >
                {saving ? "저장 중..." : `저장 (${Object.keys(dirty).length})`}
              </button>
            </div>
          </div>

          <div
            className="h-[62vh] max-h-[720px] min-h-[280px] overflow-auto rounded-lg border border-slate-200"
            onMouseLeave={() => {
              setHoverPnlSeq(null);
              setHoverColKey(null);
            }}
          >
            {metaLoading ? (
              <div className="flex h-full items-center justify-center bg-slate-50 text-sm text-slate-500">
                항목 설정 불러오는 중...
              </div>
            ) : (
              <table className="w-max text-[11px] leading-tight">
              <thead className="bg-slate-100" onMouseEnter={() => setHoverPnlSeq(null)}>
                <tr>
                  {visibleBaseColumns.map((column) => (
                    <th
                      key={column.key}
                      onMouseEnter={() => setHoverColKey(column.key)}
                      className={`${
                        stickyKeyOrder.includes(column.key) ? "px-0 py-0.5" : "px-1.5 py-1"
                      } font-semibold text-slate-700 ${
                        stickyKeyOrder.includes(column.key) ? "text-center" : "text-right"
                      } ${
                        stickyKeyOrder.includes(column.key)
                          ? `sticky top-0 z-50 border-b border-r border-slate-200 shadow-[1px_0_0_0_rgba(226,232,240,0.9)] ${hoverColKey === column.key ? "!bg-sky-100" : "bg-slate-100"}`
                          : `sticky top-0 z-40 border-b border-slate-200 ${hoverColKey === column.key ? "!bg-sky-100" : "bg-slate-100"}`
                      }`}
                      style={
                        stickyKeyOrder.includes(column.key)
                          ? {
                              left: stickyLeftMap[column.key],
                              minWidth: stickyWidthMap[column.key] ?? 100,
                              width: stickyWidthMap[column.key] ?? 100,
                            }
                          : column.key === "prev_year_actual"
                            ? { minWidth: prevYearWidth, width: prevYearWidth }
                            : { minWidth: monthColWidth, width: monthColWidth }
                      }
                    >
                      {column.label}
                    </th>
                  ))}
                  {comparePaneActive ? (
                    <th
                      className="sticky top-0 z-[42] border-b border-r border-l-2 border-l-slate-400 border-slate-200 bg-slate-100 px-1 py-1 text-center text-[10px] font-semibold text-slate-700 shadow-[2px_0_6px_rgba(15,23,42,0.1)]"
                      style={{ left: compareLabelLeft, minWidth: compareLabelColW, width: compareLabelColW }}
                    >
                      구분
                    </th>
                  ) : null}
                  {visibleMonthKeys.map((key, monthColIdx) => (
                    <th
                      key={key}
                      onMouseEnter={() => setHoverColKey(key)}
                      className={`sticky top-0 z-40 border-b border-slate-200 px-1.5 py-1 text-right font-semibold text-slate-700 ${
                        !comparePaneActive && monthColIdx === 0 ? "border-l-2 border-l-slate-400" : ""
                      } ${hoverColKey === key ? "!bg-sky-100" : "bg-slate-100"}`}
                      style={{ minWidth: monthColWidth, width: monthColWidth }}
                    >
                      {Number(String(key).slice(-2))}월 {monthHeaderSuffix}
                    </th>
                  ))}
                  {showOrderActionsEffective ? (
                    <>
                      <th
                        onMouseEnter={() => setHoverColKey(PNL_COL_SORT)}
                        className={`sticky top-0 z-40 min-w-[32px] border-b border-slate-200 px-1 py-1 text-center font-semibold text-slate-700 ${
                          hoverColKey === PNL_COL_SORT ? "!bg-sky-100" : "bg-slate-100"
                        }`}
                      >
                        순서
                      </th>
                      <th
                        onMouseEnter={() => setHoverColKey(PNL_COL_ACTIONS)}
                        className={`sticky top-0 z-40 min-w-[58px] border-b border-slate-200 px-1 py-1 text-center font-semibold text-slate-700 ${
                          hoverColKey === PNL_COL_ACTIONS ? "!bg-sky-100" : "bg-slate-100"
                        }`}
                      >
                        작업
                      </th>
                    </>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td className="px-4 py-6 text-sm text-slate-500" colSpan={tableTrailingColSpan}>불러오는 중...</td>
                  </tr>
                ) : (() => {
                  const summaryStreak: Record<string, number> = {};
                  return effectiveRows.map((row, index) => {
                  const zebra = index % 2 === 0 ? "bg-white" : "bg-slate-50";
                  const summaryTypes = new Set(["SUBTOTAL", "TOTAL", "GRAND_TOTAL", "PROFIT_CALC"]);
                  const isSummary = summaryTypes.has(row.row_type);
                  if (isSummary) {
                    summaryStreak[row.row_type] = (summaryStreak[row.row_type] ?? 0) + 1;
                  } else {
                    Object.keys(summaryStreak).forEach((key) => {
                      summaryStreak[key] = 0;
                    });
                  }
                  const toneIdx = Math.max(1, summaryStreak[row.row_type] ?? 1);
                  const subtotalTone = toneIdx % 2 === 1 ? "bg-violet-100" : "bg-violet-200";
                  const totalTone = toneIdx % 2 === 1 ? "bg-amber-100" : "bg-amber-200";
                  const grandTone = toneIdx % 2 === 1 ? "bg-cyan-100" : "bg-cyan-200";
                  const profitTone = toneIdx % 2 === 1 ? "bg-lime-100" : "bg-lime-200";
                  const styleByType =
                    row.row_type === "QTY_INPUT"
                      ? "bg-white"
                      : row.row_type === "AMT_INPUT"
                        ? "bg-slate-50"
                      : row.row_type === "AMT_CALC"
                        ? "bg-slate-100"
                        : row.row_type === "SUBTOTAL"
                          ? `${subtotalTone} font-semibold`
                          : row.row_type === "TOTAL"
                            ? `${totalTone} font-bold`
                            : row.row_type === "GRAND_TOTAL"
                              ? `${grandTone} font-bold`
                              : row.row_type === "PROFIT_CALC"
                                ? `font-bold ${profitTone}`
                              : zebra;
                  const toneDown = viewTab === "actual" ? "text-slate-600" : "text-slate-800";
                  const estimateAmountHighlight =
                    String(row.row_label ?? "").includes("추정") &&
                    (row.row_type === "AMT_INPUT" || row.row_type === "AMT_CALC");
                  const estimateCls = estimateAmountHighlight ? "font-bold text-red-600" : "";
                  const rowHi = hoverPnlSeq === row.pnl_seq;

                  const prev = toNumber(row.prev_year_actual);
                  const targetSum = sumByKeys(row, goalKeys);
                  const actualSum = sumByKeys(row, actualKeys);
                  const gap1 = targetSum - prev;
                  const gap1Rate = prev === 0 ? 0 : (targetSum / prev) * 100;
                  const gap2 = actualSum - targetSum;
                  const gap2Rate = targetSum === 0 ? 0 : (actualSum / targetSum) * 100;
                  const eligibleTotalPartialGoal =
                    row.row_type === "TOTAL" && isTotalRowEligibleForPartialGoalOverride(row, rows, policyByCode);
                  const monthPnlDisabled =
                    (!canEditGoal && viewTab === "goal") ||
                    row.row_type === "SUBTOTAL" ||
                    (eligibleTotalPartialGoal && viewTab === "actual") ||
                    comparePaneActive;
                  const layers = compareLayersForRow(row);
                  const subCount = layers.length;
                  const readOnlyGrid = comparePaneActive;
                  const useRowSpan = comparePaneActive && subCount > 1;
                  const tripleCrms = comparePaneActive && subCount === 3;
                  const dualTabCrms =
                    comparePaneActive && subCount === 2 && layers[0]?.kind === "tab" && layers[1]?.kind === "crms";
                  const orderColRowSpan = useRowSpan ? subCount : undefined;
                  return (
                    <Fragment key={row.pnl_seq}>
                      {layers.map((layer, si) => {
                        const isFirst = si === 0;
                        const subBorder = si === 0 ? "border-t border-slate-200" : "border-t border-slate-100";
                        const subEnd =
                          comparePaneActive && subCount > 1 && si === subCount - 1 ? "border-b-2 border-slate-300" : "";
                        return (
                    <tr
                      key={`${row.pnl_seq}-${si}`}
                      onMouseEnter={() => setHoverPnlSeq(row.pnl_seq)}
                      className={`${subBorder} ${subEnd} ${styleByType} ${estimateAmountHighlight ? estimateCls : toneDown}`}
                    >
                      {(() => {
                        if (!isFirst && useRowSpan && layer.kind === "crms") {
                          const useTrioSpan =
                            (tripleCrms || dualTabCrms) && compareBaseSplit.trioColSpan > 0;
                          const trioSpan = useTrioSpan ? compareBaseSplit.trioColSpan : visibleBaseColumns.length;
                          return (
                            <td
                              key={`${row.pnl_seq}-crms-base-span`}
                              colSpan={trioSpan}
                              className={`border-r border-slate-200 px-2 py-0.5 text-left align-middle text-[10px] text-slate-800 ${styleByType}${crosshairShade(rowHi, false)}`}
                            >
                              <span className="font-semibold">
                                {row.row_label ?? row.row_code} : CRMS합계 {withComma(crmsSheet[row.pnl_seq]?.yearSum ?? 0)}
                              </span>
                            </td>
                          );
                        }
                        return visibleBaseColumns.map((column) => {
                        if (!isFirst && useRowSpan) return null;
                        const inTrio = compareBaseSplit.trio.some((t) => t.key === column.key);
                        let rs: number | undefined;
                        if (comparePaneActive && subCount > 1) {
                          if (tripleCrms) rs = inTrio ? 2 : 3;
                          else if (dualTabCrms) rs = inTrio ? 1 : 2;
                          else rs = subCount;
                        }
                        const isSticky = stickyKeyOrder.includes(column.key);
                        const colHi = hoverColKey === column.key;
                        const tdClass = `${isSticky ? "px-0" : "px-1.5"} py-0.5 ${isSticky ? `sticky ${rowHi ? "z-[36]" : "z-[35]"} border-r border-slate-200 shadow-[1px_0_0_0_rgba(226,232,240,0.9)]` : ""} ${styleByType}${crosshairShade(rowHi, colHi)}`;
                        const tdStyle = isSticky
                          ? {
                              left: stickyLeftMap[column.key],
                              minWidth: stickyWidthMap[column.key] ?? 100,
                              width: stickyWidthMap[column.key] ?? 100,
                            }
                          : column.key === "prev_year_actual"
                            ? { minWidth: prevYearWidth, width: prevYearWidth }
                            : undefined;

                        if (textCols.includes(column.key as (typeof textCols)[number])) {
                          return (
                            <td
                              key={`${row.pnl_seq}-${column.key}-${si}`}
                              rowSpan={rs}
                              className={`${tdClass} text-center`}
                              style={tdStyle}
                              onMouseEnter={() => setHoverColKey(column.key)}
                            >
                              <input
                                value={String(row[column.key] ?? "")}
                                onChange={(e) => patchRow(row.pnl_seq, { [column.key]: e.target.value } as Partial<PnlRow>)}
                                disabled={(!canEditGoal && viewTab === "goal") || readOnlyGrid}
                                onMouseEnter={() => {
                                  setHoverPnlSeq(row.pnl_seq);
                                  setHoverColKey(column.key);
                                }}
                                onMouseDown={inputMouseDownSelectAll}
                                onFocus={selectAllOnFocus}
                                className={`min-w-0 w-full bg-transparent px-0 text-center outline-none ${estimateCls}${estimateAmountHighlight ? " disabled:text-red-400" : ""}`}
                              />
                            </td>
                          );
                        }

                        const cellMap: Record<string, ReactNode> = {
                          prev_year_actual: withComma(prev),
                          target_sum: withComma(targetSum),
                          actual_sum: withComma(actualSum),
                          gap1: withComma(gap1),
                          gap1_rate: `${gap1Rate.toFixed(2)}%`,
                          company_target: (
                            <input
                              value={withComma(row.company_target)}
                              onChange={(e) => patchRow(row.pnl_seq, { company_target: toNumber(e.target.value) })}
                              disabled={(!canEditGoal && viewTab === "goal") || readOnlyGrid}
                              onMouseEnter={() => {
                                setHoverPnlSeq(row.pnl_seq);
                                setHoverColKey("company_target");
                              }}
                              onMouseDown={inputMouseDownSelectAll}
                              onFocus={selectAllOnFocus}
                              className={`w-full bg-transparent text-right outline-none disabled:cursor-not-allowed ${estimateAmountHighlight ? "disabled:text-red-400" : "disabled:text-slate-400"} ${estimateCls}`}
                            />
                          ),
                          gap2: withComma(gap2),
                          gap2_rate: `${gap2Rate.toFixed(2)}%`,
                          base_ratio: `${toNumber(row.base_ratio).toFixed(2)}%`,
                        };

                        return (
                          <td
                            key={`${row.pnl_seq}-${column.key}-${si}`}
                            rowSpan={rs}
                            className={`${tdClass} text-right ${estimateCls}`}
                            style={tdStyle}
                            onMouseEnter={() => setHoverColKey(column.key)}
                          >
                            {cellMap[column.key] ?? ""}
                          </td>
                        );
                      });
                      })()}

                      {comparePaneActive ? (
                        <td
                          style={{
                            left: compareLabelLeft,
                            minWidth: compareLabelColW,
                            width: compareLabelColW,
                          }}
                          className={`sticky z-[42] whitespace-nowrap border-r border-l-2 border-l-slate-400 border-slate-200 px-0.5 py-0.5 text-center align-middle text-[10px] font-semibold text-slate-700 shadow-[2px_0_6px_rgba(15,23,42,0.1)] ${styleByType}${crosshairShade(rowHi, false)}`}
                        >
                          {layer.label}
                        </td>
                      ) : null}

                      {visibleMonthKeys.map((key, monthIdx) => {
                        const { goalKey, actualKey, monthNum } = monthPairFromVisibleKey(key);
                        const calMonthIdx = monthNum - 1;
                        const auditKey = layer.kind === "goal" ? goalKey : layer.kind === "actual" ? actualKey : key;
                        const colHiMonth = hoverColKey === key;
                        const isActualTab = viewTab === "actual";
                        const placeholderGoal =
                          isActualTab && toNumber(row[key]) === 0 ? withComma(row[goalKey]) : "";
                        const monthFocused =
                          !readOnlyGrid &&
                          monthEditFocus?.pnlSeq === row.pnl_seq &&
                          monthEditFocus?.key === auditKey;
                        const valForLayer =
                          layer.kind === "goal"
                            ? toNumber(row[goalKey])
                            : layer.kind === "actual"
                              ? toNumber(row[actualKey])
                              : toNumber(row[key]);
                        const monthDisplayValue = monthFocused ? monthEditDraft : withComma(valForLayer);
                        const monthCellDone = isPnlCellCompleted(row, auditKey);
                        const cellNoteKey = cellNoteFlagKey(row.pnl_seq, auditKey);
                        const hasCellNotes = Boolean(cellNoteFlags[cellNoteKey]);
                        const hasCellHistory = Boolean(cellHistoryFlags[cellNoteKey]);
                        const monthLeftRule =
                          !comparePaneActive && monthIdx === 0 ? "border-l-2 border-l-slate-400" : "";
                        return (
                          <td
                            key={`${row.pnl_seq}-${key}-${si}`}
                            className={`relative ${rowHi ? "z-[1]" : "z-0"} px-1.5 py-0.5 text-right ${monthLeftRule} ${styleByType}${crosshairShade(rowHi, colHiMonth)}`}
                            onMouseEnter={() => setHoverColKey(key)}
                            onMouseDown={(e) => {
                              if (e.button === 2) e.preventDefault();
                            }}
                            onContextMenu={(e) => {
                              if (layer.kind === "crms" || readOnlyGrid) return;
                              e.preventDefault();
                              e.stopPropagation();
                              cellAuditRef.current?.openContextMenu(e, buildCellAuditPayload(row, auditKey, calMonthIdx));
                            }}
                          >
                            {layer.kind === "crms" ? (
                              (() => {
                                const cx = crmsSheet[row.pnl_seq]?.months[String(monthNum)] ?? null;
                                if (!cx) return <span className="text-slate-400">—</span>;
                                const tip = [cx.col_detail, cx.col_category, cx.col_code, cx.col_client, cx.col_item]
                                  .filter(Boolean)
                                  .join(" · ");
                                return (
                                  <span className="tabular-nums font-medium text-slate-900" title={tip || undefined}>
                                    {withComma(cx.amount)}
                                  </span>
                                );
                              })()
                            ) : (
                              <>
                            {hasCellHistory ? (
                              <span
                                className="pointer-events-none absolute left-0 top-0 z-[2] border-r-[6px] border-r-transparent border-t-[6px] border-t-emerald-600 drop-shadow-[0_0_1px_rgba(0,0,0,0.35)]"
                                title="타임라인 이력 있음"
                                aria-hidden
                              />
                            ) : null}
                            {hasCellNotes ? (
                              <span
                                className="pointer-events-none absolute right-0 top-0 z-[2] border-l-[6px] border-l-transparent border-t-[6px] border-t-red-500 drop-shadow-[0_0_1px_rgba(0,0,0,0.35)]"
                                title="비고 있음"
                                aria-hidden
                              />
                            ) : null}
                            <input
                                value={monthDisplayValue}
                                placeholder={placeholderGoal}
                                onContextMenu={(e) => {
                                  if (layer.kind === "crms" || readOnlyGrid) return;
                                  e.preventDefault();
                                  e.stopPropagation();
                                  cellAuditRef.current?.openContextMenu(e, buildCellAuditPayload(row, auditKey, calMonthIdx));
                                }}
                                onMouseEnter={() => {
                                  setHoverPnlSeq(row.pnl_seq);
                                  setHoverColKey(key);
                                }}
                                onMouseDown={monthPnlDisabled ? undefined : inputMouseDownSelectAll}
                                onFocus={(e) => {
                                  if (monthPnlDisabled) return;
                                  const el = e.currentTarget;
                                  // 표시값이 콤마 포함(withComma) → 포커스 직후 숫자만(draft)으로 바뀌므로,
                                  // 비동기 select()는 리렌더 전에 돌아 선택이 무효화됨 → TAB 후 첫 입력이 덧붙음.
                                  flushSync(() => {
                                    setMonthEditFocus({ pnlSeq: row.pnl_seq, key: auditKey });
                                    setMonthEditDraft(String(Math.trunc(valForLayer)));
                                  });
                                  if (!el.disabled && document.activeElement === el) el.select();
                                  requestAnimationFrame(() => {
                                    if (!el.disabled && document.activeElement === el) el.select();
                                  });
                                }}
                                onBlur={() => {
                                  setMonthEditFocus(null);
                                  setMonthEditDraft("");
                                }}
                                onDoubleClick={() => {
                                  if (row.row_type === "SUBTOTAL") {
                                    setMessage("소계는 수정할 수 없습니다.");
                                    return;
                                  }
                                  if (eligibleTotalPartialGoal && viewTab === "goal") {
                                    if (row.calc_mode !== "MANUAL_OVERRIDE") {
                                      const seed: Partial<PnlRow> = { calc_mode: "MANUAL_OVERRIDE" };
                                      for (const gk of goalKeys) (seed as Record<string, number>)[gk] = toNumber(row[gk]);
                                      patchRow(row.pnl_seq, seed);
                                    }
                                    return;
                                  }
                                  if (row.row_type === "AMT_CALC" && isOverrideAllowed(row, policyByCode)) {
                                    if (row.calc_mode !== "MANUAL_OVERRIDE") {
                                      const seed: Partial<PnlRow> = { calc_mode: "MANUAL_OVERRIDE" };
                                      for (const gk of goalKeys) (seed as Record<string, number>)[gk] = toNumber(row[gk]);
                                      for (const ak of actualKeys) (seed as Record<string, number>)[ak] = toNumber(row[ak]);
                                      patchRow(row.pnl_seq, seed);
                                    }
                                    return;
                                  }
                                  if (isOverrideAllowed(row, policyByCode)) {
                                    patchRow(row.pnl_seq, { calc_mode: "MANUAL_OVERRIDE" });
                                  } else {
                                    setMessage("해당 항목은 자동 계산되며 예외 수기 편집 대상이 아닙니다.");
                                  }
                                }}
                                onChange={(e) => {
                                  const digitsOnly = e.target.value.replace(/\D/g, "");
                                  if (monthFocused) setMonthEditDraft(digitsOnly);
                                  const v = toNumber(digitsOnly);
                                  if (eligibleTotalPartialGoal && viewTab === "goal" && goalKeys.includes(auditKey)) {
                                    if (row.calc_mode !== "MANUAL_OVERRIDE") {
                                      const patch: Partial<PnlRow> = { calc_mode: "MANUAL_OVERRIDE" };
                                      for (const gk of goalKeys) (patch as Record<string, number>)[gk] = toNumber(row[gk]);
                                      (patch as Record<string, number>)[auditKey] = v;
                                      patchRow(row.pnl_seq, patch);
                                    } else {
                                      patchRow(row.pnl_seq, { [auditKey]: v } as Partial<PnlRow>);
                                    }
                                    return;
                                  }
                                  if (
                                    row.row_type === "AMT_CALC" &&
                                    row.calc_mode !== "MANUAL_OVERRIDE" &&
                                    ((viewTab === "actual" && actualKeys.includes(auditKey)) ||
                                      (viewTab === "goal" &&
                                        goalKeys.includes(auditKey) &&
                                        isOverrideAllowed(row, policyByCode)))
                                  ) {
                                    const patch: Partial<PnlRow> = { calc_mode: "MANUAL_OVERRIDE" };
                                    for (const gk of goalKeys) (patch as Record<string, number>)[gk] = toNumber(row[gk]);
                                    for (const ak of actualKeys) (patch as Record<string, number>)[ak] = toNumber(row[ak]);
                                    (patch as Record<string, number>)[auditKey] = v;
                                    patchRow(row.pnl_seq, patch);
                                    return;
                                  }
                                  patchRow(row.pnl_seq, { [auditKey]: v } as Partial<PnlRow>);
                                }}
                                disabled={monthPnlDisabled}
                                className={`w-full text-right text-[11px] outline-none placeholder:text-slate-400 ${
                                  monthCellDone
                                    ? "bg-transparent font-semibold text-blue-600 disabled:text-blue-400"
                                    : estimateAmountHighlight
                                      ? "font-bold bg-transparent text-red-600 disabled:text-red-400"
                                      : isSummary
                                        ? `bg-transparent ${viewTab === "actual" ? "text-slate-600" : "text-slate-800"}`
                                        : viewTab === "actual"
                                          ? "bg-transparent text-slate-600"
                                          : "bg-transparent text-slate-800"
                                }`}
                              />
                            </>
                            )}
                          </td>
                        );
                      })}
                      {showOrderActionsEffective && isFirst ? (
                        <>
                          <td
                            rowSpan={orderColRowSpan}
                            className={`px-1 py-0.5 text-center ${styleByType}${crosshairShade(rowHi, hoverColKey === PNL_COL_SORT)}`}
                            onMouseEnter={() => setHoverColKey(PNL_COL_SORT)}
                          >
                            <div className="inline-flex flex-col items-center gap-0 leading-none">
                              <button
                                type="button"
                                onClick={() => moveRow(row.pnl_seq, "up")}
                                disabled={index === 0}
                                className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-sm border border-slate-300 bg-white p-0 text-[8px] leading-none text-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
                                title="위로 이동"
                              >
                                ▲
                              </button>
                              <button
                                type="button"
                                onClick={() => moveRow(row.pnl_seq, "down")}
                                disabled={index === effectiveRows.length - 1}
                                className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-sm border border-slate-300 bg-white p-0 text-[8px] leading-none text-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
                                title="아래로 이동"
                              >
                                ▼
                              </button>
                            </div>
                          </td>
                          <td
                            rowSpan={orderColRowSpan}
                            className={`px-1 py-0.5 text-center ${styleByType}${crosshairShade(rowHi, hoverColKey === PNL_COL_ACTIONS)}`}
                            onMouseEnter={() => setHoverColKey(PNL_COL_ACTIONS)}
                          >
                            <button
                              type="button"
                              onClick={() => openEditModal(row)}
                              className="mr-0.5 inline-flex h-4.5 w-4.5 items-center justify-center rounded border border-indigo-200 bg-indigo-50 p-0 text-[9px] text-indigo-600 hover:bg-indigo-100"
                              title="행 수정"
                            >
                              ✎
                            </button>
                            <button
                              type="button"
                              onClick={() => deleteRow(row)}
                              className="inline-flex h-4.5 w-4.5 items-center justify-center rounded border border-rose-200 bg-rose-50 p-0 text-[9px] text-rose-600 hover:bg-rose-100"
                              title="행 삭제"
                            >
                              x
                            </button>
                          </td>
                        </>
                      ) : null}
                    </tr>
                        );
                      })}
                    </Fragment>
                  );
                  });
                })()}
                {!loading && effectiveRows.length === 0 ? (
                  <tr>
                    <td className="px-4 py-8 text-center text-sm text-slate-500" colSpan={tableTrailingColSpan}>
                      아직 추가된 행이 없습니다. 상단의 <span className="font-semibold">행 추가</span> 버튼으로 시작하세요.
                    </td>
                  </tr>
                ) : null}
              </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {showAdd ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={() => setShowAdd(false)}>
          <div className="w-full max-w-4xl rounded-lg bg-white p-3" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-2 text-sm font-bold">행 추가</h3>
            <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-4">
              {([
                ["grade", "등급"],
                ["category1", "계정과목"],
                ["category2", "구분"],
                ["category3", "사업상세"],
                ["biz_detail", "사업구분"],
                ["biz_group", "코드"],
                ["client_name", "거래처"],
                ["row_label", "항목"],
              ] as const).map(([key, label]) => (
                <label key={key} className="text-[11px] font-medium text-slate-600">
                  {label}
                  <input
                    value={form[key as keyof typeof form] as string}
                    onChange={(e) => setForm((prev) => ({ ...prev, [key]: e.target.value }))}
                    className="mt-1 h-8 w-full rounded border border-slate-300 px-2 py-1 text-sm font-normal outline-none focus:border-indigo-400"
                  />
                </label>
              ))}
              <label className="text-[11px] font-medium text-slate-600">
                행 타입
                <select
                  value={form.row_type}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      row_type: e.target.value as RowType,
                      formula_targets: [],
                      profit_ar_targets: [],
                      profit_ap_targets: [],
                      ref_qty_row_code: "",
                      ref_unit_price_cd: "",
                      promo_apply_actual: false,
                      vat_included_price: false,
                    }))
                  }
                  className="mt-1 h-8 w-full rounded border border-slate-300 px-2 py-1 text-sm font-normal outline-none focus:border-indigo-400"
                >
                  <option value="QTY_INPUT">개수 입력 행</option>
                  <option value="AMT_INPUT">금액 입력 행</option>
                  <option value="AMT_CALC">금액 계산 행</option>
                  <option value="SUBTOTAL">소계 계산 행</option>
                  <option value="TOTAL">합계 계산 행</option>
                  <option value="GRAND_TOTAL">총계 계산 행</option>
                  <option value="PROFIT_CALC">이익 계산 행</option>
                </select>
              </label>
              {form.row_type === "AMT_CALC" ? (
                <>
                  <label className="text-[11px] font-medium text-slate-600">
                    참조 개수행
                    <select
                      value={form.ref_qty_row_code}
                      onChange={(e) => setForm((prev) => ({ ...prev, ref_qty_row_code: e.target.value }))}
                      className="mt-1 h-8 w-full rounded border border-slate-300 px-2 py-1 text-sm font-normal outline-none focus:border-indigo-400"
                    >
                      <option value="">선택</option>
                      {qtyRows.map((row) => (
                        <option key={row.row_code} value={row.row_code}>
                          {row.row_label || row.row_code}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-[11px] font-medium text-slate-600">
                    단가 코드
                    <select
                      value={form.ref_unit_price_cd}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          ref_unit_price_cd: e.target.value,
                          promo_apply_actual: hasPromoByCode.get(e.target.value) ? prev.promo_apply_actual : false,
                        }))
                      }
                      className="mt-1 h-8 w-full rounded border border-slate-300 px-2 py-1 text-sm font-normal outline-none focus:border-indigo-400"
                    >
                      <option value="">선택</option>
                      {feeOptions.map((option) => (
                        <option key={option.code} value={option.code}>
                          {feeOptionDisplay(option)} ({withComma(option.unitPrice)})
                        </option>
                      ))}
                    </select>
                  </label>
                  {hasPromoByCode.get(form.ref_unit_price_cd) ? (
                    <label className="mt-6 inline-flex items-center gap-1 text-[11px] font-medium text-slate-700">
                      <input
                        type="checkbox"
                        checked={form.promo_apply_actual}
                        onChange={(e) => setForm((prev) => ({ ...prev, promo_apply_actual: e.target.checked }))}
                      />
                      프로모션 적용(실적)
                    </label>
                  ) : null}
                  <label className="mt-6 inline-flex items-center gap-1 text-[11px] font-medium text-slate-700">
                    <input
                      type="checkbox"
                      checked={form.vat_included_price}
                      onChange={(e) => setForm((prev) => ({ ...prev, vat_included_price: e.target.checked }))}
                    />
                    부가세 포함 단가
                  </label>
                </>
              ) : null}
              {(form.row_type === "SUBTOTAL" || form.row_type === "TOTAL" || form.row_type === "GRAND_TOTAL") ? (
                <label className="text-[11px] font-medium text-slate-600 sm:col-span-3 lg:col-span-4">
                  계산 대상 행
                  <div className="mt-1 max-h-28 overflow-auto rounded border border-slate-300 p-2">
                    {rows.map((row) => (
                      <label key={row.row_code} className="mr-3 inline-flex items-center gap-1 text-[11px] font-normal text-slate-700">
                        <input
                          type="checkbox"
                          checked={form.formula_targets.includes(row.row_code)}
                          onChange={(e) => {
                            setForm((prev) => ({
                              ...prev,
                              formula_targets: e.target.checked
                                ? [...prev.formula_targets, row.row_code]
                                : prev.formula_targets.filter((code) => code !== row.row_code),
                            }));
                          }}
                        />
                        {row.row_label || row.row_code}
                      </label>
                    ))}
                  </div>
                </label>
              ) : null}
              {form.row_type === "PROFIT_CALC" ? (
                <>
                  <label className="text-[11px] font-medium text-slate-600 sm:col-span-3 lg:col-span-2">
                    매출(AR) 행 선택
                    <div className="mt-1 max-h-28 overflow-auto rounded border border-slate-300 p-2">
                      {profitArRows.map((row) => (
                        <label key={`ar-${row.row_code}`} className="mr-3 inline-flex items-center gap-1 text-[11px] font-normal text-slate-700">
                          <input
                            type="checkbox"
                            checked={form.profit_ar_targets.includes(row.row_code)}
                            onChange={(e) =>
                              setForm((prev) => ({
                                ...prev,
                                profit_ar_targets: e.target.checked
                                  ? [...prev.profit_ar_targets, row.row_code]
                                  : prev.profit_ar_targets.filter((code) => code !== row.row_code),
                              }))
                            }
                          />
                          {row.row_label || row.row_code}
                        </label>
                      ))}
                    </div>
                  </label>
                  <label className="text-[11px] font-medium text-slate-600 sm:col-span-3 lg:col-span-2">
                    매입(AP) 행 선택
                    <div className="mt-1 max-h-28 overflow-auto rounded border border-slate-300 p-2">
                      {profitApRows.map((row) => (
                        <label key={`ap-${row.row_code}`} className="mr-3 inline-flex items-center gap-1 text-[11px] font-normal text-slate-700">
                          <input
                            type="checkbox"
                            checked={form.profit_ap_targets.includes(row.row_code)}
                            onChange={(e) =>
                              setForm((prev) => ({
                                ...prev,
                                profit_ap_targets: e.target.checked
                                  ? [...prev.profit_ap_targets, row.row_code]
                                  : prev.profit_ap_targets.filter((code) => code !== row.row_code),
                              }))
                            }
                          />
                          {row.row_label || row.row_code}
                        </label>
                      ))}
                    </div>
                  </label>
                </>
              ) : null}
            </div>
            <div className="mt-3 flex justify-end gap-2">
              <button type="button" className="rounded border border-slate-300 px-3 py-1 text-xs" onClick={() => setShowAdd(false)}>취소</button>
              <button type="button" className="rounded bg-indigo-600 px-3 py-1 text-xs font-semibold text-white" onClick={addRow}>저장</button>
            </div>
          </div>
        </div>
      ) : null}

      {showColumnSetting ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={() => setShowColumnSetting(false)}>
          <div className="w-full max-w-3xl rounded-lg bg-white p-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-3 text-base font-bold">항목 설정</h3>
            <p className="mb-3 text-xs text-slate-500">체크한 항목만 그리드에 표시됩니다. 사용자별로 저장됩니다.</p>
            <div className="max-h-72 overflow-auto rounded border border-slate-200 p-3">
              {[
                ...baseColumns.map((c) => ({ key: c.key, label: c.label })),
                ...goalKeys.map((k) => ({ key: k, label: `${Number(k.slice(-2))}월 목표` })),
                ...actualKeys.map((k) => ({ key: k, label: `${Number(k.slice(-2))}월 실적` })),
              ].map((item) => (
                <label key={item.key} className="mr-3 inline-flex items-center gap-1 py-1 text-xs text-slate-700">
                  <input
                    type="checkbox"
                    checked={selectedColumns.includes(item.key)}
                    onChange={(e) =>
                      setSelectedColumns((prev) =>
                        e.target.checked ? [...prev, item.key] : prev.filter((key) => key !== item.key),
                      )
                    }
                  />
                  {item.label}
                </label>
              ))}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className="rounded border border-slate-300 px-3 py-1.5 text-sm" onClick={() => setShowColumnSetting(false)}>취소</button>
              <button type="button" className="rounded bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white" onClick={saveColumnSetting}>저장</button>
            </div>
          </div>
        </div>
      ) : null}

      {showCompareModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={() => setShowCompareModal(false)}>
          <div className="w-full max-w-md rounded-lg bg-white p-4 shadow-lg" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-3 text-base font-bold text-slate-900">같이보기</h3>
            <div className="space-y-2 text-sm text-slate-800">
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={compareDraftGoalActual}
                  onChange={(e) => setCompareDraftGoalActual(e.target.checked)}
                />
                실적/목표 같이보기
              </label>
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={compareDraftCrms}
                  onChange={(e) => setCompareDraftCrms(e.target.checked)}
                />
                CRMS 같이보기
              </label>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                className="rounded border border-slate-300 px-3 py-1.5 text-sm"
                onClick={() => setShowCompareModal(false)}
              >
                취소
              </button>
              <button
                type="button"
                className="rounded bg-slate-900 px-3 py-1.5 text-sm font-semibold text-white"
                onClick={() => {
                  setCompareSavedGoalActual(compareDraftGoalActual);
                  setCompareSavedCrms(compareDraftCrms);
                  setShowCompareModal(false);
                }}
              >
                저장
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showEdit ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={() => setShowEdit(false)}>
          <div className="w-full max-w-4xl rounded-lg bg-white p-3" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-2 text-sm font-bold">행 수정</h3>
            <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-4">
              {([
                ["grade", "등급"],
                ["category1", "계정과목"],
                ["category2", "구분"],
                ["category3", "사업상세"],
                ["biz_detail", "사업구분"],
                ["biz_group", "코드"],
                ["client_name", "거래처"],
                ["row_label", "항목"],
              ] as const).map(([key, label]) => (
                <label key={key} className="text-[11px] font-medium text-slate-600">
                  {label}
                  <input
                    value={editForm[key as keyof typeof editForm] as string}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, [key]: e.target.value }))}
                    className="mt-1 h-8 w-full rounded border border-slate-300 px-2 py-1 text-sm font-normal outline-none focus:border-indigo-400"
                  />
                </label>
              ))}

              <label className="text-[11px] font-medium text-slate-600">
                행 타입
                <select
                  value={editForm.row_type}
                  onChange={(e) =>
                    setEditForm((prev) => ({
                      ...prev,
                      row_type: e.target.value as RowType,
                      formula_targets: [],
                      profit_ar_targets: [],
                      profit_ap_targets: [],
                      ref_qty_row_code: "",
                      ref_unit_price_cd: "",
                      promo_apply_actual: false,
                      vat_included_price: false,
                    }))
                  }
                  className="mt-1 h-8 w-full rounded border border-slate-300 px-2 py-1 text-sm font-normal outline-none focus:border-indigo-400"
                >
                  <option value="QTY_INPUT">개수 입력 행</option>
                  <option value="AMT_INPUT">금액 입력 행</option>
                  <option value="AMT_CALC">금액 계산 행</option>
                  <option value="SUBTOTAL">소계 계산 행</option>
                  <option value="TOTAL">합계 계산 행</option>
                  <option value="GRAND_TOTAL">총계 계산 행</option>
                  <option value="PROFIT_CALC">이익 계산 행</option>
                </select>
              </label>
              {editForm.row_type === "AMT_CALC" ? (
                <>
                  <label className="text-[11px] font-medium text-slate-600">
                    참조 개수행
                    <select
                      value={editForm.ref_qty_row_code}
                      onChange={(e) => setEditForm((prev) => ({ ...prev, ref_qty_row_code: e.target.value }))}
                      className="mt-1 h-8 w-full rounded border border-slate-300 px-2 py-1 text-sm font-normal outline-none focus:border-indigo-400"
                    >
                      <option value="">선택</option>
                      {qtyRows.map((row) => (
                        <option key={row.row_code} value={row.row_code}>
                          {row.row_label || row.row_code}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-[11px] font-medium text-slate-600">
                    단가 코드
                    <select
                      value={editForm.ref_unit_price_cd}
                      onChange={(e) =>
                        setEditForm((prev) => ({
                          ...prev,
                          ref_unit_price_cd: e.target.value,
                          promo_apply_actual: hasPromoByCode.get(e.target.value) ? prev.promo_apply_actual : false,
                        }))
                      }
                      className="mt-1 h-8 w-full rounded border border-slate-300 px-2 py-1 text-sm font-normal outline-none focus:border-indigo-400"
                    >
                      <option value="">선택</option>
                      {feeOptions.map((option) => (
                        <option key={option.code} value={option.code}>
                          {feeOptionDisplay(option)} ({withComma(option.unitPrice)})
                        </option>
                      ))}
                    </select>
                  </label>
                  {hasPromoByCode.get(editForm.ref_unit_price_cd) ? (
                    <label className="mt-6 inline-flex items-center gap-1 text-[11px] font-medium text-slate-700">
                      <input
                        type="checkbox"
                        checked={editForm.promo_apply_actual}
                        onChange={(e) => setEditForm((prev) => ({ ...prev, promo_apply_actual: e.target.checked }))}
                      />
                      프로모션 적용(실적)
                    </label>
                  ) : null}
                  <label className="mt-6 inline-flex items-center gap-1 text-[11px] font-medium text-slate-700">
                    <input
                      type="checkbox"
                      checked={editForm.vat_included_price}
                      onChange={(e) => setEditForm((prev) => ({ ...prev, vat_included_price: e.target.checked }))}
                    />
                    부가세 포함 단가
                  </label>
                </>
              ) : null}
              {(editForm.row_type === "SUBTOTAL" || editForm.row_type === "TOTAL" || editForm.row_type === "GRAND_TOTAL") ? (
                <label className="text-[11px] font-medium text-slate-600 sm:col-span-3 lg:col-span-4">
                  계산 대상 행
                  <div className="mt-1 max-h-28 overflow-auto rounded border border-slate-300 p-2">
                    {rows.map((row) => (
                      <label key={row.row_code} className="mr-3 inline-flex items-center gap-1 text-[11px] font-normal text-slate-700">
                        <input
                          type="checkbox"
                          checked={editForm.formula_targets.includes(row.row_code)}
                          onChange={(e) =>
                            setEditForm((prev) => ({
                              ...prev,
                              formula_targets: e.target.checked
                                ? [...prev.formula_targets, row.row_code]
                                : prev.formula_targets.filter((code) => code !== row.row_code),
                            }))
                          }
                        />
                        {row.row_label || row.row_code}
                      </label>
                    ))}
                  </div>
                </label>
              ) : null}
              {editForm.row_type === "PROFIT_CALC" ? (
                <>
                  <label className="text-[11px] font-medium text-slate-600 sm:col-span-3 lg:col-span-2">
                    매출(AR) 행 선택
                    <div className="mt-1 max-h-28 overflow-auto rounded border border-slate-300 p-2">
                      {profitArRows.map((row) => (
                        <label key={`edit-ar-${row.row_code}`} className="mr-3 inline-flex items-center gap-1 text-[11px] font-normal text-slate-700">
                          <input
                            type="checkbox"
                            checked={editForm.profit_ar_targets.includes(row.row_code)}
                            onChange={(e) =>
                              setEditForm((prev) => ({
                                ...prev,
                                profit_ar_targets: e.target.checked
                                  ? [...prev.profit_ar_targets, row.row_code]
                                  : prev.profit_ar_targets.filter((code) => code !== row.row_code),
                              }))
                            }
                          />
                          {row.row_label || row.row_code}
                        </label>
                      ))}
                    </div>
                  </label>
                  <label className="text-[11px] font-medium text-slate-600 sm:col-span-3 lg:col-span-2">
                    매입(AP) 행 선택
                    <div className="mt-1 max-h-28 overflow-auto rounded border border-slate-300 p-2">
                      {profitApRows.map((row) => (
                        <label key={`edit-ap-${row.row_code}`} className="mr-3 inline-flex items-center gap-1 text-[11px] font-normal text-slate-700">
                          <input
                            type="checkbox"
                            checked={editForm.profit_ap_targets.includes(row.row_code)}
                            onChange={(e) =>
                              setEditForm((prev) => ({
                                ...prev,
                                profit_ap_targets: e.target.checked
                                  ? [...prev.profit_ap_targets, row.row_code]
                                  : prev.profit_ap_targets.filter((code) => code !== row.row_code),
                              }))
                            }
                          />
                          {row.row_label || row.row_code}
                        </label>
                      ))}
                    </div>
                  </label>
                </>
              ) : null}
            </div>
            <div className="mt-3 flex justify-end gap-2">
              <button type="button" className="rounded border border-slate-300 px-3 py-1 text-xs" onClick={() => setShowEdit(false)}>
                취소
              </button>
              <button type="button" className="rounded bg-indigo-600 px-3 py-1 text-xs font-semibold text-white" onClick={applyEditRow}>
                적용
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
