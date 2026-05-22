"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { isPnlRowMappable, rowTypeLabel } from "../../../../lib/pnl-crms-shared";

type PnlRowItem = {
  pnl_seq: number;
  base_year: number;
  pnl_type: string;
  row_type: string;
  sort_order: number;
  row_label: string | null;
  row_code: string;
  category1: string | null;
  category2: string | null;
  category3: string | null;
  biz_detail: string | null;
  biz_group: string | null;
  client_name: string | null;
  goal_by_month: number[];
  actual_by_month: number[];
};

type ViewTab = "goal" | "actual";

type CrmsLine = {
  source_seq: number;
  biz_group_nm: string | null;
  issue_dt: string | null;
  client_nm: string | null;
  item_label: string;
  amount: number;
  source_id: string | null;
};

type MappingEntry = { target_month: number; crms_module: string; source_seq: number };

function fmtWon(n: number) {
  return n.toLocaleString("ko-KR");
}

function fmtListDate(iso: string | null) {
  if (!iso) return "—";
  const part = iso.slice(0, 10);
  const [y, m, d] = part.split("-");
  if (!y || !m || !d) return iso;
  return `${y}. ${m}. ${d}.`;
}

function monthFromIssueDt(iso: string | null): number | null {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})/.exec(iso.slice(0, 10));
  if (!m) return null;
  const mo = Number(m[2]);
  return mo >= 1 && mo <= 12 ? mo : null;
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  const t = await res.text();
  if (!t) return {};
  try {
    return JSON.parse(t) as Record<string, unknown>;
  } catch {
    return {};
  }
}

type CrmsModule = "AR" | "AP" | "OP" | "OP_LC" | "OP_IC" | "OP_SC" | "OP_DC";
const OP_MODS = new Set<string>(["OP", "OP_LC", "OP_IC", "OP_SC", "OP_DC"]);

function keyOf(mod: CrmsModule, seq: number) {
  return `${mod}:${seq}`;
}

/** OP lines: source_id가 모듈 코드(OP_LC 등)를 담음 */
function opLineKey(line: CrmsLine): string {
  return `${line.source_id ?? "OP"}:${line.source_seq}`;
}

function parseKey(k: string): { mod: CrmsModule; seq: number } | null {
  const colonIdx = k.indexOf(":");
  if (colonIdx < 0) return null;
  const mod = k.slice(0, colonIdx);
  const seq = Number(k.slice(colonIdx + 1));
  const valid: string[] = ["AR", "AP", "OP", "OP_LC", "OP_IC", "OP_SC", "OP_DC"];
  if (valid.includes(mod) && Number.isFinite(seq) && seq > 0) return { mod: mod as CrmsModule, seq };
  return null;
}

function rowTone(rowType: string) {
  if (rowType === "SUBTOTAL") return "bg-violet-50/80 text-violet-900";
  if (rowType === "TOTAL") return "bg-indigo-50/80 text-indigo-900";
  if (rowType === "GRAND_TOTAL") return "bg-slate-200/80 text-slate-900 font-bold";
  if (rowType === "PROFIT_CALC") return "bg-emerald-50/80 text-emerald-900";
  if (rowType === "AMT_CALC") return "text-slate-600";
  return "text-slate-800";
}

export default function CrmsMappingClient() {
  const sp = useSearchParams();
  const baseYear = Number(sp.get("base_year") ?? sp.get("year") ?? "");
  const pnlType = String(sp.get("pnl_type") ?? sp.get("type") ?? "AR").toUpperCase();
  const initialPnlSeq = Number(sp.get("pnl_seq") ?? "");
  const viewTab: ViewTab = sp.get("view_tab") === "actual" ? "actual" : "goal";
  const janValueLabel = viewTab === "goal" ? "1월 목표" : "1월 실적";
  // from 파라미터: 매핑 페이지를 호출한 손익계획 경로 (기본값: 손익계획)
  const fromBase = sp.get("from") ?? "/dashboard/finance/pnl-plan";

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [autoMapping, setAutoMapping] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pnlRows, setPnlRows] = useState<PnlRowItem[]>([]);
  const [arLines, setArLines] = useState<CrmsLine[]>([]);
  const [apLines, setApLines] = useState<CrmsLine[]>([]);
  const [opLines, setOpLines] = useState<CrmsLine[]>([]);
  const [mappingsByPnl, setMappingsByPnl] = useState<Record<string, MappingEntry[]>>({});
  const [mappedPnlSeqs, setMappedPnlSeqs] = useState<Set<number>>(() => new Set());
  const [checkedPnlSeq, setCheckedPnlSeq] = useState<number | null>(null);
  const [syncMonthsForRow, setSyncMonthsForRow] = useState<Set<number>>(() => new Set());
  const [tab, setTab] = useState<CrmsModule>("AR");
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(() => new Set());

  const backHref = useMemo(() => {
    const qs = new URLSearchParams();
    if (Number.isFinite(baseYear)) qs.set("year", String(baseYear));
    if (pnlType) qs.set("type", pnlType);
    qs.set("view_tab", viewTab);
    const q = qs.toString();
    return q ? `${fromBase}?${q}` : fromBase;
  }, [baseYear, pnlType, viewTab, fromBase]);

  const loadBulk = useCallback(async () => {
    if (!Number.isFinite(baseYear) || !["AR", "AP", "OP_COST"].includes(pnlType)) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch(
        `/api/pnl/crms-mapping?mode=bulk&base_year=${baseYear}&pnl_type=${encodeURIComponent(pnlType)}`,
        { cache: "no-store" },
      );
      const json = await readJson(res);
      if (!res.ok) {
        setMessage(typeof json.message === "string" ? json.message : "조회 실패");
        return;
      }
      setPnlRows(Array.isArray(json.pnlRows) ? (json.pnlRows as PnlRowItem[]) : []);
      setArLines(Array.isArray(json.arLines) ? (json.arLines as CrmsLine[]) : []);
      setApLines(Array.isArray(json.apLines) ? (json.apLines as CrmsLine[]) : []);
      setOpLines(Array.isArray(json.opLines) ? (json.opLines as CrmsLine[]) : []);
      setMappingsByPnl((json.mappingsByPnl as Record<string, MappingEntry[]>) ?? {});
      const mapped = Array.isArray(json.mappedPnlSeqs) ? (json.mappedPnlSeqs as number[]) : [];
      setMappedPnlSeqs(new Set(mapped));
    } catch {
      setMessage("조회 중 오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  }, [baseYear, pnlType]);

  useEffect(() => {
    void loadBulk();
  }, [loadBulk]);

  useEffect(() => {
    if (!Number.isFinite(initialPnlSeq) || initialPnlSeq <= 0 || loading) return;
    togglePnlCheck(initialPnlSeq, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initial selection once
  }, [loading, initialPnlSeq]);

  useEffect(() => {
    if (pnlType === "OP_COST") setTab("OP");
    else if (pnlType === "AP") setTab("AP");
    else setTab("AR");
  }, [pnlType]);

  const janDisplayValue = (row: PnlRowItem) => {
    const arr = viewTab === "goal" ? row.goal_by_month : row.actual_by_month;
    return Number(arr?.[0] ?? 0);
  };

  const applyMappingsToSelection = (pnlSeq: number) => {
    const maps = mappingsByPnl[String(pnlSeq)] ?? [];
    setSyncMonthsForRow(new Set(maps.map((m) => m.target_month)));
    const keys = new Set<string>();
    for (const m of maps) {
      if (m.crms_module === "AR" || m.crms_module === "AP") {
        keys.add(keyOf(m.crms_module, m.source_seq));
      }
    }
    setSelectedKeys(keys);
    const janLine = maps.find((m) => m.target_month === 1);
    if (janLine && (janLine.crms_module === "AR" || janLine.crms_module === "AP")) {
      setTab(janLine.crms_module);
    }
  };

  const togglePnlCheck = (pnlSeq: number, forceOn = false) => {
    const row = pnlRows.find((r) => r.pnl_seq === pnlSeq);
    if (!row || !isPnlRowMappable(row.row_type, row.row_label)) return;
    if (!forceOn && checkedPnlSeq === pnlSeq) {
      setCheckedPnlSeq(null);
      setSelectedKeys(new Set());
      setSyncMonthsForRow(new Set());
      return;
    }
    setCheckedPnlSeq(pnlSeq);
    applyMappingsToSelection(pnlSeq);
  };

  const lines = tab === "AR" ? arLines : tab === "AP" ? apLines : opLines;

  const groupedEntries = useMemo(() => {
    const grouped = lines.reduce<Record<string, CrmsLine[]>>((acc, item) => {
      const key = item.biz_group_nm?.trim() || "미분류";
      if (!acc[key]) acc[key] = [];
      acc[key].push(item);
      return acc;
    }, {});
    return Object.entries(grouped).map(([groupName, groupRows]) => {
      const sortedRows = [...groupRows].sort((a, b) => {
        if (!a.issue_dt && !b.issue_dt) return 0;
        if (!a.issue_dt) return 1;
        if (!b.issue_dt) return -1;
        return new Date(a.issue_dt).getTime() - new Date(b.issue_dt).getTime();
      });
      return {
        groupName,
        rows: sortedRows,
        totalAmount: sortedRows.reduce((sum, r) => sum + r.amount, 0),
      };
    });
  }, [lines]);

  const lineKey = (r: CrmsLine) =>
    OP_MODS.has(tab) ? opLineKey(r) : keyOf(tab as "AR" | "AP", r.source_seq);

  const pickRow = (line: CrmsLine) => {
    const k = lineKey(line);
    setSelectedKeys((prev) => {
      const n = new Set(prev);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });
  };

  const groupRowKeys = (rows: CrmsLine[]) => rows.map(lineKey);

  const groupSelectState = (rows: CrmsLine[]) => {
    const keys = groupRowKeys(rows);
    if (keys.length === 0) return { all: false, indeterminate: false };
    const selected = keys.filter((k) => selectedKeys.has(k)).length;
    if (selected === 0) return { all: false, indeterminate: false };
    if (selected === keys.length) return { all: true, indeterminate: false };
    return { all: false, indeterminate: true };
  };

  const toggleGroupRows = (rows: CrmsLine[], nextChecked: boolean) => {
    const keys = groupRowKeys(rows);
    setSelectedKeys((prev) => {
      const n = new Set(prev);
      for (const k of keys) {
        if (nextChecked) n.add(k);
        else n.delete(k);
      }
      return n;
    });
  };

  const selectionPayload = (): Array<{ crms_module: string; source_seq: number }> => {
    const items: Array<{ crms_module: string; source_seq: number }> = [];
    for (const k of selectedKeys) {
      const p = parseKey(k);
      if (p) items.push({ crms_module: p.mod, source_seq: p.seq });
    }
    items.sort((a, b) => a.crms_module.localeCompare(b.crms_module) || a.source_seq - b.source_seq);
    return items;
  };


  const selectedSum = useMemo(() => {
    let s = 0;
    for (const k of selectedKeys) {
      const p = parseKey(k);
      if (!p) continue;
      if (OP_MODS.has(p.mod)) {
        // OP lines: key = "OP_LC:123" → source_id = "OP_LC", source_seq = 123
        const line = opLines.find((r) => r.source_seq === p.seq && (r.source_id ?? "OP") === p.mod);
        if (line) s += line.amount;
      } else {
        const list = p.mod === "AR" ? arLines : apLines;
        const line = list.find((r) => r.source_seq === p.seq);
        if (line) s += line.amount;
      }
    }
    return s;
  }, [selectedKeys, arLines, apLines, opLines]);

  const mergeMappingsFromApi = (pnlSeq: number, maps: MappingEntry[]) => {
    setMappingsByPnl((prev) => ({ ...prev, [String(pnlSeq)]: maps }));
    setMappedPnlSeqs((prev) => {
      const next = new Set(prev);
      if (maps.length > 0) next.add(pnlSeq);
      else next.delete(pnlSeq);
      return next;
    });
    setSyncMonthsForRow(new Set(maps.map((m) => m.target_month)));
  };

  const onAutoYear = async () => {
    if (!checkedPnlSeq) {
      setMessage("좌측에서 손익 항목을 체크해 주세요.");
      return;
    }
    if (selectedKeys.size === 0) {
      setMessage("우측에서 동일 사업그룹(예: 대구BR 유지운영) CRMS 전표를 체크한 뒤 실행해 주세요.");
      return;
    }
    setAutoMapping(true);
    setMessage(null);
    try {
      const res = await fetch("/api/pnl/crms-mapping", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pnl_seq: checkedPnlSeq,
          mode: "auto_year_from_january",
          selection: selectionPayload(),
        }),
      });
      const json = await readJson(res);
      if (!res.ok) {
        setMessage(typeof json.message === "string" ? json.message : "자동 매핑 실패");
        return;
      }
      const maps = Array.isArray(json.mappings) ? (json.mappings as MappingEntry[]) : [];
      mergeMappingsFromApi(checkedPnlSeq, maps);
      const keys = new Set<string>();
      for (const m of maps) {
        const valid: string[] = ["AR", "AP", "OP", "OP_LC", "OP_IC", "OP_SC", "OP_DC"];
        if (valid.includes(m.crms_module)) {
          keys.add(keyOf(m.crms_module as CrmsModule, m.source_seq));
        }
      }
      setSelectedKeys(keys);
      setMessage(typeof json.message === "string" ? json.message : "1~12월 자동 매핑이 완료되었습니다. 저장으로 다음 항목으로 이동하세요.");
    } catch {
      setMessage("자동 매핑 중 오류가 발생했습니다.");
    } finally {
      setAutoMapping(false);
    }
  };

  const onSave = async () => {
    if (!checkedPnlSeq) {
      setMessage("좌측에서 손익 항목을 체크해 주세요.");
      return;
    }
    const pnlSeq = checkedPnlSeq;
    setSaving(true);
    setMessage(null);
    try {
      const syncMonths = new Set(syncMonthsForRow);
      for (const m of mappingsByPnl[String(pnlSeq)] ?? []) {
        syncMonths.add(m.target_month);
      }
      for (const k of selectedKeys) {
        const p = parseKey(k);
        if (!p) continue;
        let line: CrmsLine | undefined;
        if (OP_MODS.has(p.mod)) {
          line = opLines.find((r) => r.source_seq === p.seq && (r.source_id ?? "OP") === p.mod);
        } else {
          const list = p.mod === "AR" ? arLines : apLines;
          line = list.find((r) => r.source_seq === p.seq);
        }
        const mo = monthFromIssueDt(line?.issue_dt ?? null);
        if (mo) syncMonths.add(mo);
      }

      const res = await fetch("/api/pnl/crms-mapping", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pnl_seq: pnlSeq,
          derive_month_from_issue_dt: true,
          selection: selectionPayload(),
          sync_months: [...syncMonths],
        }),
      });
      const json = await readJson(res);
      if (!res.ok) {
        setMessage(typeof json.message === "string" ? json.message : "저장 실패");
        return;
      }

      if (selectedKeys.size === 0) {
        mergeMappingsFromApi(pnlSeq, []);
      } else {
        const sel = selectionPayload();
        const byMonthNew = new Map<number, MappingEntry[]>();
        for (const s of sel) {
          let line: CrmsLine | undefined;
          if (OP_MODS.has(s.crms_module)) {
            line = opLines.find((r) => r.source_seq === s.source_seq && (r.source_id ?? "OP") === s.crms_module);
          } else {
            const list = s.crms_module === "AR" ? arLines : apLines;
            line = list.find((r) => r.source_seq === s.source_seq);
          }
          const mo = monthFromIssueDt(line?.issue_dt ?? null);
          if (!mo) continue;
          if (!byMonthNew.has(mo)) byMonthNew.set(mo, []);
          byMonthNew.get(mo)!.push({ target_month: mo, crms_module: s.crms_module, source_seq: s.source_seq });
        }
        const rebuilt: MappingEntry[] = [];
        for (const m of mappingsByPnl[String(pnlSeq)] ?? []) {
          if (!syncMonths.has(m.target_month)) rebuilt.push(m);
        }
        for (const mo of syncMonths) {
          rebuilt.push(...(byMonthNew.get(mo) ?? []));
        }
        mergeMappingsFromApi(pnlSeq, rebuilt);
      }

      setCheckedPnlSeq(null);
      setSelectedKeys(new Set());
      setSyncMonthsForRow(new Set());
      setMessage(
        selectedKeys.size === 0
          ? "매핑이 해제되었습니다. 다음 항목을 좌측에서 체크해 주세요."
          : "저장되었습니다. 다음 항목을 좌측에서 체크해 주세요.",
      );
    } catch {
      setMessage("저장 중 오류가 발생했습니다.");
    } finally {
      setSaving(false);
    }
  };

  if (!Number.isFinite(baseYear)) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50/80 p-6 text-sm text-amber-900">
        <p className="font-medium">조회 연도가 필요합니다.</p>
        <p className="mt-2">손익계획 화면에서 교차검증 → 매핑으로 들어오거나 URL에 base_year를 지정해 주세요.</p>
        <Link href={fromBase} className="mt-4 inline-block font-medium text-blue-700 underline">
          손익계획으로 돌아가기
        </Link>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3">
        <div className="flex flex-wrap items-center gap-3">
          <Link
            href={backHref}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            ← 손익계획으로 돌아가기
          </Link>
          <h1 className="text-lg font-bold text-slate-900">CRMS 교차검증 매핑</h1>
          <span className="text-sm text-slate-600">
            {baseYear}년 · {pnlType === "AR" ? "매출" : pnlType === "OP_COST" ? "부서운영비" : "매입"} · {viewTab === "goal" ? "목표" : "실적"} 기준
          </span>
        </div>
      </header>

      {message ? (
        <p className={`mb-2 text-sm ${message.includes("실패") || message.includes("오류") ? "text-red-600" : "text-slate-700"}`}>
          {message}
        </p>
      ) : null}

      {loading ? (
        <p className="text-sm text-slate-500">불러오는 중…</p>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-2">
          {/* 좌: 손익계획 */}
          <section className="flex min-h-[420px] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700">
              손익계획 항목
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              <table className="w-full border-collapse text-[11px]">
                <thead className="sticky top-0 z-10 bg-slate-100">
                  <tr>
                    <th className="w-8 border border-slate-200 px-1 py-1 text-center font-semibold">선택</th>
                    <th className="border border-slate-200 px-1.5 py-1 text-left font-semibold">항목</th>
                    <th className="border border-slate-200 px-1.5 py-1 text-left font-semibold">유형</th>
                    <th className="border border-slate-200 px-1.5 py-1 text-right font-semibold">{janValueLabel}</th>
                  </tr>
                </thead>
                <tbody>
                  {pnlRows.map((row) => {
                    const mappable = isPnlRowMappable(row.row_type, row.row_label);
                    const checked = checkedPnlSeq === row.pnl_seq;
                    const mapped = mappedPnlSeqs.has(row.pnl_seq);
                    return (
                      <tr
                        key={row.pnl_seq}
                        className={`${rowTone(row.row_type)} ${mappable ? "" : "opacity-60"} ${
                          checked ? "bg-indigo-100 ring-1 ring-inset ring-indigo-300" : ""
                        }`}
                      >
                        <td className="border border-slate-200 px-1 py-0.5 text-center">
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={!mappable}
                            onChange={() => togglePnlCheck(row.pnl_seq)}
                            className="accent-indigo-600"
                            aria-label={`${row.row_label ?? row.row_code} 선택`}
                          />
                        </td>
                        <td className="border border-slate-200 px-1.5 py-0.5">
                          {row.row_label ?? row.biz_detail ?? "—"}
                          {mapped ? <span className="ml-1 text-emerald-600" title="매핑 있음">✓</span> : null}
                        </td>
                        <td className="border border-slate-200 px-1.5 py-0.5 whitespace-nowrap">{rowTypeLabel(row.row_type)}</td>
                        <td className="border border-slate-200 px-1.5 py-0.5 text-right tabular-nums">{fmtWon(janDisplayValue(row))}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          {/* 우: CRMS */}
          <section className="flex min-h-[420px] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 bg-slate-50 px-3 py-2">
              <span className="text-xs font-semibold text-slate-700">CRMS 전표</span>
              {checkedPnlSeq ? (
                <span className="text-[11px] text-indigo-700">
                  선택: {pnlRows.find((r) => r.pnl_seq === checkedPnlSeq)?.row_label ?? `#${checkedPnlSeq}`}
                </span>
              ) : (
                <span className="text-[11px] text-slate-500">좌측 항목을 체크하세요</span>
              )}
              <div className="ml-auto flex gap-1">
                {pnlType === "OP_COST" ? (
                  <button
                    type="button"
                    onClick={() => setTab("OP")}
                    className="rounded px-2 py-0.5 text-[11px] font-medium bg-slate-900 text-white"
                  >
                    운영비 관리
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => setTab("AR")}
                      className={`rounded px-2 py-0.5 text-[11px] font-medium ${
                        tab === "AR" ? "bg-slate-900 text-white" : "bg-slate-200 text-slate-700"
                      }`}
                    >
                      매출 (AR)
                    </button>
                    <button
                      type="button"
                      onClick={() => setTab("AP")}
                      className={`rounded px-2 py-0.5 text-[11px] font-medium ${
                        tab === "AP" ? "bg-slate-900 text-white" : "bg-slate-200 text-slate-700"
                      }`}
                    >
                      매입 (AP)
                    </button>
                  </>
                )}
              </div>
            </div>
            <p className="border-b border-slate-100 px-3 py-1 text-[10px] text-slate-500">
              1~12월 자동: 선택한 사업그룹 안만(2Q·3Q 등 예산 제외) · 저장: 발행일 기준 월 반영 · 합계 {fmtWon(selectedSum)}원
            </p>
            <div className="min-h-0 flex-1 overflow-y-auto p-2 space-y-3">
              {!checkedPnlSeq ? (
                <p className="py-8 text-center text-sm text-slate-500">매핑할 손익 행을 좌측에서 체크하세요.</p>
              ) : groupedEntries.length === 0 ? (
                <p className="py-8 text-center text-sm text-slate-500">표시할 전표가 없습니다.</p>
              ) : (
                groupedEntries.map((group, idx) => {
                  const gSel = groupSelectState(group.rows);
                  return (
                  <details key={group.groupName} open={idx === 0} className="rounded-lg border border-slate-200">
                    <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50">
                      <input
                        type="checkbox"
                        checked={gSel.all}
                        disabled={!checkedPnlSeq}
                        ref={(el) => {
                          if (el) el.indeterminate = gSel.indeterminate;
                        }}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => toggleGroupRows(group.rows, e.target.checked)}
                        className="accent-slate-800"
                        aria-label={`${group.groupName} 전체 선택`}
                      />
                      <span className="flex-1">
                        {group.groupName} ({group.rows.length}건) · {fmtWon(group.totalAmount)}원
                      </span>
                    </summary>
                    <div className="overflow-x-auto border-t border-slate-200">
                      <table className="min-w-full text-xs">
                        <thead className="bg-slate-100">
                          <tr>
                            <th className="w-8 px-2 py-2 text-center">
                              <input
                                type="checkbox"
                                checked={gSel.all}
                                disabled={!checkedPnlSeq}
                                ref={(el) => {
                                  if (el) el.indeterminate = gSel.indeterminate;
                                }}
                                onChange={(e) => toggleGroupRows(group.rows, e.target.checked)}
                                className="accent-slate-800"
                                title="이 사업그룹 전체 선택"
                                aria-label={`${group.groupName} 전체 선택`}
                              />
                            </th>
                            <th className="px-2 py-2 text-left">발행일</th>
                            <th className="px-2 py-2 text-left">거래처</th>
                            <th className="px-2 py-2 text-left">항목</th>
                            <th className="px-2 py-2 text-right">금액</th>
                          </tr>
                        </thead>
                        <tbody>
                          {group.rows.map((r) => {
                            const k = lineKey(r);
                            const mo = monthFromIssueDt(r.issue_dt);
                            return (
                              <tr key={k} className="border-b border-slate-100 hover:bg-slate-50/60">
                                <td className="px-2 py-1 text-center">
                                  <input
                                    type="checkbox"
                                    checked={selectedKeys.has(k)}
                                    disabled={!checkedPnlSeq}
                                    onChange={() => pickRow(r)}
                                    className="accent-slate-800"
                                  />
                                </td>
                                <td className="px-2 py-1 whitespace-nowrap text-slate-700">
                                  {fmtListDate(r.issue_dt)}
                                  {mo ? <span className="ml-1 text-[10px] text-slate-400">{mo}월</span> : null}
                                </td>
                                <td className="px-2 py-1">{r.client_nm ?? "—"}</td>
                                <td className="px-2 py-1">{r.item_label}</td>
                                <td className="px-2 py-1 text-right tabular-nums">{fmtWon(r.amount)}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </details>
                  );
                })
              )}
            </div>
          </section>
        </div>
      )}

      <div className="sticky bottom-0 z-40 mt-3 flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 bg-white/95 py-3 backdrop-blur">
        <p className="mr-auto text-[10px] text-slate-500">좌측 체크 → 동일 사업그룹 우측 체크 → 1~12월 자동 매핑 → 저장</p>
        <button
          type="button"
          disabled={autoMapping || saving || !checkedPnlSeq || selectedKeys.size === 0}
          onClick={() => void onAutoYear()}
          className="rounded-md border border-indigo-300 bg-indigo-50 px-4 py-2 text-sm font-medium text-indigo-900 hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {autoMapping ? "자동 매핑 중…" : "1~12월 자동 매핑"}
        </button>
        <button
          type="button"
          disabled={saving || autoMapping || !checkedPnlSeq}
          onClick={() => void onSave()}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {saving ? "저장 중…" : "저장 (연속 매핑)"}
        </button>
      </div>
    </div>
  );
}
