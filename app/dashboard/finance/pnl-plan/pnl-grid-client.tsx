"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";

type DepthType = "AR" | "AP" | "OP_COST";
type ViewTab = "goal" | "actual";
type RowType = "QTY_INPUT" | "AMT_CALC" | "SUBTOTAL" | "TOTAL" | "GRAND_TOTAL";

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
};

type ColumnDef = {
  key: string;
  label: string;
  sticky?: boolean;
};

const goalKeys = Array.from({ length: 12 }, (_, i) => `t_m${String(i + 1).padStart(2, "0")}`);
const actualKeys = Array.from({ length: 12 }, (_, i) => `a_m${String(i + 1).padStart(2, "0")}`);
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

function sumByKeys(row: PnlRow, keys: string[]) {
  return keys.reduce((acc, key) => acc + toNumber(row[key]), 0);
}

function isOverrideAllowed(row: PnlRow) {
  if (row.row_type !== "AMT_CALC") return true;
  const target = `${row.category3 ?? ""} ${row.biz_group ?? ""} ${row.row_label ?? ""}`.toLowerCase();
  return ["대구", "부산", "im", "i m", "i_m"].some((keyword) => target.includes(keyword));
}

export default function PnlGridClient({ initialYear }: { initialYear: number }) {
  const [year, setYear] = useState(initialYear);
  const yy = String(year).slice(-2);
  const prevYy = String(year - 1).slice(-2);
  const [viewTab, setViewTab] = useState<ViewTab>("goal");
  const [depthType, setDepthType] = useState<DepthType>("AR");
  const [rows, setRows] = useState<PnlRow[]>([]);
  const [feeOptions, setFeeOptions] = useState<FeeOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [dirty, setDirty] = useState<Record<number, PnlRow>>({});
  const [setupStarted, setSetupStarted] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [showColumnSetting, setShowColumnSetting] = useState(false);
  const [selectedColumns, setSelectedColumns] = useState<string[]>([]);
  const [goalEditMode, setGoalEditMode] = useState(false);
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
    ref_qty_row_code: "",
    ref_unit_price_cd: "",
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

  const readJsonSafe = async (res: Response) => {
    const raw = await res.text();
    if (!raw) return {};
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return {};
    }
  };

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
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "조회 오류");
    } finally {
      setLoading(false);
    }
  };

  const loadMeta = async () => {
    try {
      const res = await fetch(`/api/pnl?mode=meta&viewTab=${viewTab}&depthType=${depthType}`);
      const json = await readJsonSafe(res);
      if (!res.ok) {
        setMessage((json.message as string) || "항목 설정 메타 조회 실패");
        return;
      }
      setFeeOptions(Array.isArray(json.feeOptions) ? (json.feeOptions as FeeOption[]) : []);
      const preset = Array.isArray(json.selectedColumns) ? (json.selectedColumns as string[]) : null;
      const defaultCols = [...baseColumns.map((c) => c.key), ...goalKeys];
      setSelectedColumns(preset && preset.length > 0 ? preset : defaultCols);
    } catch {
      setMessage("항목 설정 메타 조회 중 오류가 발생했습니다.");
    }
  };

  useEffect(() => {
    void loadMeta();
  }, [baseColumns, viewTab, depthType]);

  useEffect(() => {
    void loadRows();
  }, [year, depthType]);

  const effectiveRows = useMemo(() => {
    const sorted = [...rows].sort((a, b) => a.sort_order - b.sort_order);
    const byCode = new Map(sorted.map((row) => [row.row_code, row]));
    const priceByCode = new Map(feeOptions.map((item) => [item.code, item.unitPrice]));
    const cache = new Map<string, PnlRow>();

    const resolve = (row: PnlRow): PnlRow => {
      if (cache.has(row.row_code)) return cache.get(row.row_code)!;
      let next = { ...row } as PnlRow;

      if (row.row_type === "AMT_CALC" && row.calc_mode !== "MANUAL_OVERRIDE" && row.ref_qty_row_code && row.ref_unit_price_cd) {
        const qtyRow = byCode.get(row.ref_qty_row_code);
        const unitPrice = toNumber(priceByCode.get(row.ref_unit_price_cd));
        if (qtyRow && unitPrice > 0) {
          for (let i = 0; i < 12; i += 1) {
            const gk = goalKeys[i];
            const ak = actualKeys[i];
            next[gk] = toNumber(qtyRow[gk]) * unitPrice;
            next[ak] = toNumber(qtyRow[ak]) * unitPrice;
          }
          next.company_target = sumByKeys(next, goalKeys);
        }
      }

      if ((row.row_type === "SUBTOTAL" || row.row_type === "TOTAL" || row.row_type === "GRAND_TOTAL") && row.calc_mode !== "MANUAL_OVERRIDE") {
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
          next.company_target = resolvedTargets.reduce((sum, target) => sum + toNumber(target.company_target), 0);
        }
      }

      cache.set(row.row_code, next);
      return next;
    };

    return sorted.map(resolve);
  }, [rows, feeOptions, viewTab]);

  const patchRow = (pnlSeq: number, patch: Partial<PnlRow>) => {
    setRows((prev) => {
      const next = prev.map((row) => (row.pnl_seq === pnlSeq ? { ...row, ...patch } : row));
      const target = next.find((row) => row.pnl_seq === pnlSeq);
      if (target) setDirty((prevDirty) => ({ ...prevDirty, [pnlSeq]: target }));
      return next;
    });
  };

  const addRow = async () => {
    const payload = {
      ...form,
      baseYear: year,
      pnlType: depthType,
      formula_targets: form.formula_targets.join(","),
      ref_qty_row_code: form.ref_qty_row_code || null,
      ref_unit_price_cd: form.ref_unit_price_cd || null,
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
      ref_qty_row_code: "",
      ref_unit_price_cd: "",
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
    const ok = confirm(`[${row.row_label ?? row.row_code}] 항목을 삭제할까요?`);
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

  const currentMonthKeys = viewTab === "goal" ? goalKeys : actualKeys;
  const monthHeaderSuffix = viewTab === "goal" ? "목표" : "실적";
  const qtyRows = rows.filter((row) => row.row_type === "QTY_INPUT");
  const canEditGoal = viewTab === "goal" ? goalEditMode : true;
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
    () => baseColumns.filter((col) => selectedColumns.includes(col.key)),
    [baseColumns, selectedColumns],
  );
  const visibleMonthKeys = useMemo(
    () => currentMonthKeys.filter((key) => selectedColumns.includes(key)),
    [currentMonthKeys, selectedColumns],
  );
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

  return (
    <div className="min-w-0 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-slate-900">{year}년 손익계획</h1>
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
          <div className="flex flex-wrap items-center gap-2">
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
              onClick={() => setViewTab("actual")}
            >
              실적
            </button>
            {viewTab === "goal" ? (
              <button
                type="button"
                className={`rounded-md px-3 py-1.5 text-sm font-semibold ${goalEditMode ? "bg-amber-600 text-white" : "bg-slate-200 text-slate-700"}`}
                onClick={() => setGoalEditMode((prev) => !prev)}
              >
                목표 편집 {goalEditMode ? "ON" : "OFF"}
              </button>
            ) : null}
            <span className="mx-1 h-6 w-px bg-slate-300" />
            {[
              { key: "AR", label: "AR" },
              { key: "AP", label: "AP" },
              { key: "OP_COST", label: "부서운영비" },
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
            <span className="mx-1 h-6 w-px bg-slate-300" />
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
            <button
              type="button"
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-700"
              onClick={() => setShowColumnSetting(true)}
            >
              항목 설정
            </button>
          </div>

          <div className="h-[62vh] max-h-[720px] min-h-[280px] overflow-auto rounded-lg border border-slate-200">
            <table className="w-max text-xs">
              <thead className="bg-slate-100">
                <tr>
                  {visibleBaseColumns.map((column) => (
                    <th
                      key={column.key}
                      className={`px-2 py-2 text-left font-semibold text-slate-700 ${
                        stickyKeyOrder.includes(column.key)
                          ? "sticky z-30 border-r border-slate-200 bg-slate-100 shadow-[1px_0_0_0_rgba(226,232,240,0.9)]"
                          : ""
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
                  {visibleMonthKeys.map((key) => (
                    <th key={key} className="px-2 py-2 text-right font-semibold text-slate-700" style={{ minWidth: monthColWidth, width: monthColWidth }}>
                      {Number(String(key).slice(-2))}월 {monthHeaderSuffix}
                    </th>
                  ))}
                  <th className="min-w-[56px] px-2 py-2 text-center font-semibold text-slate-700">삭제</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td className="px-4 py-6 text-sm text-slate-500" colSpan={visibleBaseColumns.length + visibleMonthKeys.length + 1}>불러오는 중...</td>
                  </tr>
                ) : effectiveRows.map((row, index) => {
                  const zebra = index % 2 === 0 ? "bg-white" : "bg-slate-50";
                  const styleByType =
                    row.row_type === "QTY_INPUT"
                      ? "bg-emerald-50"
                      : row.row_type === "AMT_CALC"
                        ? "bg-sky-50"
                        : row.row_type === "SUBTOTAL"
                          ? "bg-indigo-50 font-semibold"
                          : row.row_type === "TOTAL"
                            ? "bg-amber-100 font-bold"
                            : row.row_type === "GRAND_TOTAL"
                              ? "bg-cyan-100 font-bold"
                              : zebra;
                  const toneDown = viewTab === "actual" ? "text-slate-600" : "text-slate-800";

                  const prev = toNumber(row.prev_year_actual);
                  const targetSum = sumByKeys(row, goalKeys);
                  const actualSum = sumByKeys(row, actualKeys);
                  const gap1 = targetSum - prev;
                  const gap1Rate = prev === 0 ? 0 : (targetSum / prev) * 100;
                  const gap2 = actualSum - toNumber(row.company_target);
                  const gap2Rate = toNumber(row.company_target) === 0 ? 0 : (actualSum / toNumber(row.company_target)) * 100;
                  return (
                    <tr key={row.pnl_seq} className={`border-t border-slate-200 ${styleByType} ${toneDown}`}>
                      {visibleBaseColumns.map((column) => {
                        const isSticky = stickyKeyOrder.includes(column.key);
                        const tdClass = `px-2 py-1.5 ${isSticky ? "sticky z-20 border-r border-slate-200 shadow-[1px_0_0_0_rgba(226,232,240,0.9)]" : ""} ${styleByType}`;
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
                            <td key={`${row.pnl_seq}-${column.key}`} className={tdClass} style={tdStyle}>
                              <input
                                value={String(row[column.key] ?? "")}
                                onChange={(e) => patchRow(row.pnl_seq, { [column.key]: e.target.value } as Partial<PnlRow>)}
                                disabled={!canEditGoal && viewTab === "goal"}
                                className="w-full bg-transparent outline-none"
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
                              disabled={!canEditGoal && viewTab === "goal"}
                              className="w-full bg-transparent text-right outline-none disabled:cursor-not-allowed disabled:text-slate-400"
                            />
                          ),
                          gap2: withComma(gap2),
                          gap2_rate: `${gap2Rate.toFixed(2)}%`,
                          base_ratio: `${toNumber(row.base_ratio).toFixed(2)}%`,
                        };

                        return (
                          <td key={`${row.pnl_seq}-${column.key}`} className={`${tdClass} text-right`} style={tdStyle}>
                            {cellMap[column.key] ?? ""}
                          </td>
                        );
                      })}

                      {visibleMonthKeys.map((key, monthIdx) => {
                        const isManual = row.calc_mode === "MANUAL_OVERRIDE";
                        const isActualTab = viewTab === "actual";
                        const placeholderGoal =
                          isActualTab && toNumber(row[key]) === 0 ? withComma(row[goalKeys[monthIdx]]) : "";
                        return (
                          <td key={`${row.pnl_seq}-${key}`} className="px-2 py-1.5 text-right">
                            <div className="relative">
                              {isManual ? (
                                <span
                                  className="absolute right-0 top-0 h-0 w-0 border-l-[6px] border-t-[6px] border-l-transparent border-t-rose-500"
                                  title="수동으로 조정된 값입니다"
                                />
                              ) : null}
                              <input
                                value={withComma(row[key])}
                                placeholder={placeholderGoal}
                                onDoubleClick={() => {
                                  if (isOverrideAllowed(row)) {
                                    patchRow(row.pnl_seq, { calc_mode: "MANUAL_OVERRIDE" });
                                  } else {
                                    setMessage("해당 항목은 자동 계산되며 예외 수기 편집 대상이 아닙니다.");
                                  }
                                }}
                                onChange={(e) => patchRow(row.pnl_seq, { [key]: toNumber(e.target.value) } as Partial<PnlRow>)}
                                disabled={!canEditGoal && viewTab === "goal"}
                                className={`w-full text-right outline-none placeholder:text-slate-400 ${
                                  viewTab === "actual" ? "bg-slate-100 text-slate-600" : "bg-transparent text-slate-800"
                                }`}
                              />
                            </div>
                            {monthIdx === 11 && row.calc_mode === "MANUAL_OVERRIDE" ? (
                              <button
                                type="button"
                                className="mt-1 rounded border border-rose-200 px-1 text-[10px] text-rose-700"
                                onClick={() => patchRow(row.pnl_seq, { calc_mode: "AUTO" })}
                              >
                                되돌리기
                              </button>
                            ) : null}
                          </td>
                        );
                      })}
                      <td className="px-2 py-1.5 text-center">
                        <button
                          type="button"
                          onClick={() => deleteRow(row)}
                          className="inline-flex h-6 w-6 items-center justify-center rounded border border-rose-200 bg-rose-50 text-rose-600 hover:bg-rose-100"
                          title="행 삭제"
                        >
                          x
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {!loading && effectiveRows.length === 0 ? (
                  <tr>
                    <td className="px-4 py-8 text-center text-sm text-slate-500" colSpan={visibleBaseColumns.length + visibleMonthKeys.length + 1}>
                      아직 추가된 행이 없습니다. 상단의 <span className="font-semibold">행 추가</span> 버튼으로 시작하세요.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </>
      )}

      {showAdd ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={() => setShowAdd(false)}>
          <div className="w-full max-w-3xl rounded-lg bg-white p-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-3 text-base font-bold">행 추가</h3>
            <div className="grid gap-2 sm:grid-cols-2">
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
                <label key={key} className="text-xs font-semibold text-slate-600">
                  {label}
                  <input
                    value={form[key as keyof typeof form] as string}
                    onChange={(e) => setForm((prev) => ({ ...prev, [key]: e.target.value }))}
                    className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm font-normal"
                  />
                </label>
              ))}
              <label className="text-xs font-semibold text-slate-600">
                행 타입
                <select
                  value={form.row_type}
                  onChange={(e) => setForm((prev) => ({ ...prev, row_type: e.target.value as RowType, formula_targets: [], ref_qty_row_code: "", ref_unit_price_cd: "" }))}
                  className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm font-normal"
                >
                  <option value="QTY_INPUT">개수 입력 행</option>
                  <option value="AMT_CALC">금액 계산 행</option>
                  <option value="SUBTOTAL">소계 계산 행</option>
                  <option value="TOTAL">합계 계산 행</option>
                  <option value="GRAND_TOTAL">총계 계산 행</option>
                </select>
              </label>
              {form.row_type === "AMT_CALC" ? (
                <>
                  <label className="text-xs font-semibold text-slate-600">
                    참조 개수행
                    <select
                      value={form.ref_qty_row_code}
                      onChange={(e) => setForm((prev) => ({ ...prev, ref_qty_row_code: e.target.value }))}
                      className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm font-normal"
                    >
                      <option value="">선택</option>
                      {qtyRows.map((row) => (
                        <option key={row.row_code} value={row.row_code}>
                          {row.row_label || row.row_code}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-xs font-semibold text-slate-600">
                    단가 코드
                    <select
                      value={form.ref_unit_price_cd}
                      onChange={(e) => setForm((prev) => ({ ...prev, ref_unit_price_cd: e.target.value }))}
                      className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm font-normal"
                    >
                      <option value="">선택</option>
                      {feeOptions.map((option) => (
                        <option key={option.code} value={option.code}>
                          {option.label} ({withComma(option.unitPrice)})
                        </option>
                      ))}
                    </select>
                  </label>
                </>
              ) : null}
              {(form.row_type === "SUBTOTAL" || form.row_type === "TOTAL" || form.row_type === "GRAND_TOTAL") ? (
                <label className="text-xs font-semibold text-slate-600 sm:col-span-2">
                  계산 대상 행
                  <div className="mt-1 max-h-32 overflow-auto rounded border border-slate-300 p-2">
                    {rows.map((row) => (
                      <label key={row.row_code} className="mr-3 inline-flex items-center gap-1 text-xs font-normal text-slate-700">
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
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className="rounded border border-slate-300 px-3 py-1.5 text-sm" onClick={() => setShowAdd(false)}>취소</button>
              <button type="button" className="rounded bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white" onClick={addRow}>저장</button>
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
    </div>
  );
}
