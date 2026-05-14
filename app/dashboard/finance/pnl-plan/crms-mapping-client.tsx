"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

type PnlRowCard = {
  pnl_seq: number;
  base_year: number;
  pnl_type: string;
  category1: string | null;
  category2: string | null;
  category3: string | null;
  biz_detail: string | null;
  biz_group: string | null;
  client_name: string | null;
  row_label: string | null;
  row_code: string;
};

type CrmsLine = {
  source_seq: number;
  biz_group_nm: string | null;
  issue_dt: string | null;
  client_nm: string | null;
  item_label: string;
  amount: number;
  source_id: string | null;
};

type MappingEntry = { crms_module: string; source_seq: number };

function serializeKeys(keys: Iterable<string>): string {
  return [...keys].sort().join("|");
}

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

async function readJson(res: Response): Promise<Record<string, unknown>> {
  const t = await res.text();
  if (!t) return {};
  try {
    return JSON.parse(t) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function keyOf(mod: "AR" | "AP", seq: number) {
  return `${mod}:${seq}`;
}

function parseKey(k: string | null): { mod: "AR" | "AP"; seq: number } | null {
  if (!k) return null;
  const [mod, seqStr] = k.split(":");
  const seq = Number(seqStr);
  if ((mod === "AR" || mod === "AP") && Number.isFinite(seq) && seq > 0) return { mod, seq };
  return null;
}

function parseMonthFromCellKey(cellKey: string): number | null {
  const m = cellKey.match(/[at]_m(0[1-9]|1[0-2])/i);
  if (!m) return null;
  return Number(m[1]);
}

export default function CrmsMappingClient() {
  const router = useRouter();
  const sp = useSearchParams();
  const pnlSeq = Number(sp.get("pnl_seq") ?? "");
  const cellKey = sp.get("cell_key") ?? "";
  const targetMonth = useMemo(() => parseMonthFromCellKey(cellKey), [cellKey]);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [autoMapping, setAutoMapping] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [row, setRow] = useState<PnlRowCard | null>(null);
  const [arLines, setArLines] = useState<CrmsLine[]>([]);
  const [apLines, setApLines] = useState<CrmsLine[]>([]);
  const [tab, setTab] = useState<"AR" | "AP">("AR");
  /** 다중 매핑 키 — "AR:123" */
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(() => new Set());
  const [initialKeysSerialized, setInitialKeysSerialized] = useState("");

  const load = useCallback(async () => {
    if (!Number.isFinite(pnlSeq) || pnlSeq <= 0) {
      setLoading(false);
      setRow(null);
      return;
    }
    setLoading(true);
    setMessage(null);
    try {
      const month = targetMonth;
      if (!month) {
        setMessage("월 정보(cell_key)를 확인할 수 없습니다.");
        setRow(null);
        return;
      }
      const res = await fetch(`/api/pnl/crms-mapping?pnl_seq=${pnlSeq}&target_month=${month}&cell_key=${encodeURIComponent(cellKey)}`);
      const json = await readJson(res);
      if (!res.ok) {
        setMessage(typeof json.message === "string" ? json.message : "조회 실패");
        setRow(null);
        return;
      }
      setRow((json.row as PnlRowCard) ?? null);
      setArLines(Array.isArray(json.arLines) ? (json.arLines as CrmsLine[]) : []);
      setApLines(Array.isArray(json.apLines) ? (json.apLines as CrmsLine[]) : []);
      const fromArr = Array.isArray(json.mappings) ? (json.mappings as MappingEntry[]) : [];
      const legacy = json.mapping as MappingEntry | null | undefined;
      const entries: MappingEntry[] =
        fromArr.length > 0
          ? fromArr
          : legacy && (legacy.crms_module === "AR" || legacy.crms_module === "AP") && legacy.source_seq > 0
            ? [legacy]
            : [];
      const next = new Set<string>();
      for (const m of entries) {
        if ((m.crms_module === "AR" || m.crms_module === "AP") && m.source_seq > 0) {
          next.add(keyOf(m.crms_module as "AR" | "AP", m.source_seq));
        }
      }
      setSelectedKeys(next);
      setInitialKeysSerialized(serializeKeys(next));
      const first = entries[0];
      if (first?.crms_module === "AP") setTab("AP");
      else setTab("AR");
    } catch {
      setMessage("조회 중 오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  }, [pnlSeq, targetMonth, cellKey]);

  useEffect(() => {
    void load();
  }, [load]);

  const lines = tab === "AR" ? arLines : apLines;

  const summary = useMemo(() => {
    const sum = lines.reduce((a, r) => a + r.amount, 0);
    const groups = new Set(lines.map((r) => r.biz_group_nm).filter(Boolean));
    const title =
      groups.size === 1 ? [...groups][0]! : groups.size > 1 ? "복수 사업그룹" : tab === "AR" ? "매출(AR)" : "매입(AP)";
    return { title, count: lines.length, sum };
  }, [lines, tab]);

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

  const dirty = serializeKeys(selectedKeys) !== initialKeysSerialized;

  const pickRow = (mod: "AR" | "AP", seq: number) => {
    const k = keyOf(mod, seq);
    setSelectedKeys((prev) => {
      const n = new Set(prev);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });
  };

  const selectionPayload = (): MappingEntry[] | null => {
    if (selectedKeys.size === 0) return null;
    const items: MappingEntry[] = [];
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
      const list = p.mod === "AR" ? arLines : apLines;
      const line = list.find((r) => r.source_seq === p.seq);
      if (line) s += line.amount;
    }
    return s;
  }, [selectedKeys, arLines, apLines]);

  const selectedArCount = useMemo(
    () => [...selectedKeys].filter((k) => parseKey(k)?.mod === "AR").length,
    [selectedKeys],
  );
  const selectedApCount = useMemo(
    () => [...selectedKeys].filter((k) => parseKey(k)?.mod === "AP").length,
    [selectedKeys],
  );

  const onSave = async () => {
    if (!Number.isFinite(pnlSeq) || pnlSeq <= 0) return;
    setSaving(true);
    setMessage(null);
    try {
      const sel = selectionPayload();
      const res = await fetch("/api/pnl/crms-mapping", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pnl_seq: pnlSeq, target_month: targetMonth, selection: sel ?? [] }),
      });
      const json = await readJson(res);
      if (!res.ok) {
        setMessage(typeof json.message === "string" ? json.message : "저장 실패");
        return;
      }
      setMessage(typeof json.message === "string" ? json.message : "저장되었습니다.");
      setInitialKeysSerialized(serializeKeys(selectedKeys));
      router.push("/dashboard/finance/pnl-plan?crmsMapped=1");
    } catch {
      setMessage("저장 중 오류가 발생했습니다.");
    } finally {
      setSaving(false);
    }
  };

  const onCancel = () => {
    router.push("/dashboard/finance/pnl-plan");
  };

  const onAutoMapFromJanuary = async () => {
    if (!Number.isFinite(pnlSeq) || pnlSeq <= 0) return;
    setAutoMapping(true);
    setMessage(null);
    try {
      const res = await fetch("/api/pnl/crms-mapping", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pnl_seq: pnlSeq, target_month: targetMonth, mode: "auto_from_january" }),
      });
      const json = await readJson(res);
      if (!res.ok) {
        setMessage(typeof json.message === "string" ? json.message : "자동 매핑 실패");
        return;
      }
      setMessage(typeof json.message === "string" ? json.message : "자동 매핑 완료");
      await load();
    } catch {
      setMessage("자동 매핑 중 오류가 발생했습니다.");
    } finally {
      setAutoMapping(false);
    }
  };

  if (!Number.isFinite(pnlSeq) || pnlSeq <= 0) {
    return (
      <div className="pb-24">
        <div className="rounded-xl border border-amber-200 bg-amber-50/80 p-6 text-sm text-amber-900">
          <p className="font-medium">매핑할 손익 행이 지정되지 않았습니다.</p>
          <p className="mt-2 text-amber-800/90">
            손익계획 그리드에서 교차검증 → <strong>사업그룹·항목 매핑</strong> 링크로 들어오거나, URL에{" "}
            <code className="rounded bg-white/80 px-1">pnl_seq</code>를 붙여 주세요.
          </p>
          <Link href="/dashboard/finance/pnl-plan" className="mt-4 inline-block text-sm font-medium text-blue-700 underline">
            손익계획으로 돌아가기
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col pb-24">
      {message ? (
        <p className={`mb-3 text-sm ${message.includes("실패") || message.includes("오류") ? "text-red-600" : "text-slate-700"}`}>{message}</p>
      ) : null}

      {loading ? (
        <p className="text-sm text-slate-500">불러오는 중…</p>
      ) : !row ? (
        <p className="text-sm text-slate-500">데이터가 없습니다.</p>
      ) : (
        <>
          <section className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
            <p className="mb-2 text-sm font-semibold tabular-nums text-slate-900">
              매핑 대상 월 · {targetMonth != null ? `${targetMonth}월` : "—"}
            </p>
            <div className="overflow-x-auto rounded border border-slate-200">
              <table className="w-full min-w-[720px] border-collapse text-left text-[12px] leading-tight">
                <thead>
                  <tr className="bg-slate-100">
                    <th className="border border-slate-200 px-2 py-1.5 font-semibold text-slate-700">사업상세</th>
                    <th className="border border-slate-200 px-2 py-1.5 font-semibold text-slate-700">코드</th>
                    <th className="border border-slate-200 px-2 py-1.5 font-semibold text-slate-700">유닛</th>
                    <th className="border border-slate-200 px-2 py-1.5 font-semibold text-slate-700">전표코드</th>
                    <th className="border border-slate-200 px-2 py-1.5 font-semibold text-slate-700">구분</th>
                    <th className="border border-slate-200 px-2 py-1.5 font-semibold text-slate-700">거래처</th>
                    <th className="border border-slate-200 px-2 py-1.5 font-semibold text-slate-700">항목</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="bg-white">
                    <td className="border border-slate-200 px-2 py-1.5 text-slate-900">{row.category3 ?? row.biz_detail ?? "—"}</td>
                    <td className="border border-slate-200 px-2 py-1.5 text-slate-900">{row.biz_group ?? "—"}</td>
                    <td className="border border-slate-200 px-2 py-1.5 text-slate-900">{row.category1 ?? "—"}</td>
                    <td className="border border-slate-200 px-2 py-1.5 font-mono text-[11px] text-slate-900">{row.row_code}</td>
                    <td className="border border-slate-200 px-2 py-1.5 text-slate-900">{row.category2 ?? "—"}</td>
                    <td className="border border-slate-200 px-2 py-1.5 text-slate-900">{row.client_name ?? "—"}</td>
                    <td className="border border-slate-200 px-2 py-1.5 text-slate-900">{row.row_label ?? "—"}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <section className="mt-6 rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-3">
              <button
                type="button"
                onClick={() => setTab("AR")}
                className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                  tab === "AR" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                }`}
              >
                매출 관리 (AR)
                {selectedArCount > 0 ? (
                  <span className="ml-1 text-[10px] opacity-80" title={`선택 ${selectedArCount}건`}>
                    ●{selectedArCount > 1 ? selectedArCount : ""}
                  </span>
                ) : null}
              </button>
              <button
                type="button"
                onClick={() => setTab("AP")}
                className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                  tab === "AP" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                }`}
              >
                매입 관리 (AP)
                {selectedApCount > 0 ? (
                  <span className="ml-1 text-[10px] opacity-80" title={`선택 ${selectedApCount}건`}>
                    ●{selectedApCount > 1 ? selectedApCount : ""}
                  </span>
                ) : null}
              </button>
              <button
                type="button"
                disabled={loading || saving || autoMapping}
                onClick={() => void onAutoMapFromJanuary()}
                className="ml-auto rounded-md border border-indigo-300 bg-indigo-50 px-3 py-1.5 text-sm font-medium text-indigo-700 hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {autoMapping ? "자동 매핑 중…" : "1월 기준 2~12 자동 매핑"}
              </button>
            </div>

            <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-100 px-4 py-2 text-sm">
              <p className="font-semibold text-slate-900">
                {summary.title} ({summary.count}건) · {fmtWon(summary.sum)}원
              </p>
              <p className="text-xs text-slate-500">
                최대 400건 · 여러 행 선택 가능(재클릭 시 해제) · 선택 합계{" "}
                <span className="font-semibold tabular-nums text-slate-800">{fmtWon(selectedSum)}원</span>
              </p>
            </div>

            <div className="space-y-4 p-4">
              {groupedEntries.length === 0 ? (
                <div className="rounded-lg border border-slate-200 px-4 py-8 text-center text-slate-500">표시할 데이터가 없습니다.</div>
              ) : (
                groupedEntries.map((group, idx) => (
                  <details
                    key={group.groupName}
                    open={idx === 0}
                    className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"
                  >
                    <summary className="cursor-pointer list-none px-5 py-4 text-xs font-semibold text-slate-800 hover:bg-slate-50">
                      <div className="flex items-center justify-between gap-4">
                        <span>
                          {group.groupName} ({group.rows.length}건) · {fmtWon(group.totalAmount)}원
                        </span>
                      </div>
                    </summary>
                    <div className="overflow-x-auto border-t border-slate-200">
                      <table className="min-w-full text-xs">
                        <thead className="bg-slate-100">
                          <tr>
                            <th className="w-10 px-4 py-3 text-center text-xs font-semibold text-slate-600">선택</th>
                            <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">사업그룹</th>
                            <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">발행일</th>
                            <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">거래처</th>
                            <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">항목</th>
                            <th className="px-4 py-3 text-right text-xs font-semibold text-slate-600">금액</th>
                          </tr>
                        </thead>
                        <tbody>
                          {group.rows.map((r) => {
                            const k = keyOf(tab, r.source_seq);
                            const checked = selectedKeys.has(k);
                            return (
                              <tr key={k} className="border-b border-slate-100 hover:bg-slate-50/60">
                                <td className="px-4 py-2 text-center align-middle">
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={() => pickRow(tab, r.source_seq)}
                                    className="accent-slate-800"
                                    aria-label={`${tab} ${r.source_seq} 선택`}
                                  />
                                </td>
                                <td className="px-4 py-2 align-top">{r.biz_group_nm ?? "—"}</td>
                                <td className="px-4 py-2 align-top whitespace-nowrap text-slate-700">{fmtListDate(r.issue_dt)}</td>
                                <td className="px-4 py-2 align-top">{r.client_nm ?? "—"}</td>
                                <td className="px-4 py-2 align-top text-slate-800">{r.item_label}</td>
                                <td className="px-4 py-2 text-right tabular-nums text-slate-900">{fmtWon(r.amount)}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </details>
                ))
              )}
            </div>
            <p className="border-t border-slate-100 px-4 py-2 text-[11px] text-slate-500">
              체크를 모두 해제하고 저장하면 해당 월 매핑이 삭제됩니다. 교차검증·같이보기에는 선택 전표 금액의 합계가 표시됩니다.
            </p>
          </section>
        </>
      )}

      <div className="fixed bottom-0 left-0 right-0 z-40 flex justify-end gap-2 border-t border-slate-200 bg-white/95 px-4 py-3 shadow-[0_-4px_12px_rgba(0,0,0,0.06)] backdrop-blur sm:px-8">
        <div className="flex w-full max-w-5xl justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            취소
          </button>
          <button
            type="button"
            disabled={saving || loading || !row || !dirty}
            onClick={() => void onSave()}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {saving ? "저장 중…" : "저장"}
          </button>
        </div>
      </div>
    </div>
  );
}
