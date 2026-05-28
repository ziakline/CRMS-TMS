"use client";

import { createPortal } from "react-dom";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type MouseEvent,
} from "react";

/** 우클릭 메뉴 확장: 상단 항목 배열만 조작하면 됨 */
export const PNL_CELL_CONTEXT_MENU_PRIMARY: ReadonlyArray<{ id: string; label: string }> = [
  { id: "note", label: "비고관리" },
  { id: "complete_toggle", label: "완료/해제" },
  { id: "timeline", label: "타임라인" },
  { id: "cross_check", label: "교차검증" },
];

export const PNL_CELL_CONTEXT_MENU_FOOTER: ReadonlyArray<{ id: string; label: string; disabled?: boolean }> = [
  { id: "reserved", label: "이하 항목은 추후 제공 예정", disabled: true },
];

export function readCellCompletion(row: { cell_completion?: unknown }): Record<string, string> {
  const raw = row.cell_completion;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === "string") out[k] = v;
  }
  return out;
}

export function isPnlCellCompleted(row: { cell_completion?: unknown }, cellKey: string): boolean {
  return readCellCompletion(row)[cellKey] === "COMPLETED";
}

export function cellNoteFlagKey(pnl_seq: number, cell_key: string): string {
  return `${pnl_seq}:${cell_key}`;
}

export type PnlCellTargetPayload = {
  pnl_seq: number;
  cell_key: string;
  monthLabel: string;
  cell_completion: Record<string, string>;
  snap: {
    category3: string | null;
    category2: string | null;
    biz_group: string | null;
    client_name: string | null;
    row_label: string | null;
    biz_detail: string | null;
    goalVal: number;
    actualVal: number;
  };
};

type PnlRowPatch = Record<string, unknown>;

export type PnlCellAuditHostRef = {
  openContextMenu: (e: MouseEvent, payload: PnlCellTargetPayload) => void;
};

type Props = {
  patchRow: (pnlSeq: number, patch: Partial<PnlRowPatch>) => void;
  setBanner: (msg: string | null) => void;
  onCellNotesMutated?: () => void;
  /** 교차검증 → CRMS 매핑 링크에 연도·시트 타입 전달 */
  mappingSheet?: { year: number; pnlType: string };
};

async function readJsonSafe(res: Response): Promise<Record<string, unknown>> {
  const raw = await res.text();
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function fmtNum(n: number) {
  return n.toLocaleString("ko-KR");
}

function fmtDt(iso: string) {
  try {
    return new Date(iso).toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" });
  } catch {
    return iso;
  }
}

function parseMonthFromCellKey(cellKey: string): number | null {
  const m = cellKey.match(/[at]_m(0[1-9]|1[0-2])/i);
  if (!m) return null;
  return Number(m[1]);
}

function TrashIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path
        d="M3 6h18M8 6V4a1 1 0 011-1h6a1 1 0 011 1v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14zM10 11v6M14 11v6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export const PnlCellAuditHost = forwardRef<PnlCellAuditHostRef, Props>(function PnlCellAuditHost(
  { patchRow, setBanner, onCellNotesMutated, mappingSheet },
  ref,
) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [menu, setMenu] = useState<null | { x: number; y: number; target: PnlCellTargetPayload }>(null);
  const [dialog, setDialog] = useState<null | "note" | "timeline" | "cross">(null);
  const [dialogTarget, setDialogTarget] = useState<PnlCellTargetPayload | null>(null);
  const [notes, setNotes] = useState<
    Array<{ note_seq: number; content: string; author: string; created_at: string; deleted_at: string | null }>
  >([]);
  const [history, setHistory] = useState<
    Array<{ history_seq: number; old_value: string | null; new_value: string | null; author: string; created_at: string }>
  >([]);
  const [noteDraft, setNoteDraft] = useState("");
  const [loadingCell, setLoadingCell] = useState(false);
  const [deleteConfirmFor, setDeleteConfirmFor] = useState<number | null>(null);
  const [crossLoading, setCrossLoading] = useState(false);
  const [crossData, setCrossData] = useState<{
    mappings: { crms_module: string; source_seq: number }[];
    crmsRow: {
      col_detail: string;
      col_category: string;
      col_code: string;
      col_client: string;
      col_item: string;
      amount: number;
    } | null;
  } | null>(null);
  const [portalReady, setPortalReady] = useState(false);

  const closeMenu = useCallback(() => setMenu(null), []);

  useEffect(() => {
    setPortalReady(true);
    return () => setPortalReady(false);
  }, []);

  useImperativeHandle(ref, () => ({
    openContextMenu(e, payload) {
      e.preventDefault();
      e.stopPropagation();
      setMenu({ x: e.clientX, y: e.clientY, target: payload });
    },
  }));

  useEffect(() => {
    if (!menu) return;
    const onDown = (ev: PointerEvent) => {
      if (menuRef.current?.contains(ev.target as Node)) return;
      closeMenu();
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [menu, closeMenu]);

  useEffect(() => {
    if (dialog !== "cross" || !dialogTarget) {
      setCrossData(null);
      setCrossLoading(false);
      return;
    }
    let cancelled = false;
    setCrossLoading(true);
    setCrossData(null);
    const month = parseMonthFromCellKey(dialogTarget.cell_key);
    if (!month) {
      setCrossLoading(false);
      setCrossData(null);
      return;
    }
    void fetch(
      `/api/pnl/crms-mapping?pnl_seq=${dialogTarget.pnl_seq}&mode=cross&target_month=${month}&cell_key=${encodeURIComponent(dialogTarget.cell_key)}`,
    )
      .then((res) => readJsonSafe(res))
      .then((j) => {
        if (cancelled) return;
        const mappingsRaw = j.mappings;
        const mappings = Array.isArray(mappingsRaw)
          ? (mappingsRaw as { crms_module: string; source_seq: number }[])
          : j.mapping &&
              typeof j.mapping === "object" &&
              j.mapping !== null &&
              !Array.isArray(j.mapping)
            ? [j.mapping as { crms_module: string; source_seq: number }]
            : [];
        const cr =
          j.crmsRow && typeof j.crmsRow === "object" && j.crmsRow !== null && !Array.isArray(j.crmsRow)
            ? (j.crmsRow as {
                col_detail: string;
                col_category: string;
                col_code: string;
                col_client: string;
                col_item: string;
                amount: number;
              })
            : null;
        setCrossData({ mappings, crmsRow: cr });
      })
      .catch(() => {
        if (!cancelled) setCrossData(null);
      })
      .finally(() => {
        if (!cancelled) setCrossLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [dialog, dialogTarget?.pnl_seq]);

  const loadCellData = useCallback(async (t: PnlCellTargetPayload) => {
    setLoadingCell(true);
    try {
      const qs = new URLSearchParams({ pnl_seq: String(t.pnl_seq), cell_key: t.cell_key });
      const res = await fetch(`/api/pnl/cell?${qs}`);
      const json = await readJsonSafe(res);
      if (!res.ok) {
        setBanner(typeof json.message === "string" ? json.message : "셀 정보 조회 실패");
        return;
      }
      setNotes(Array.isArray(json.notes) ? (json.notes as typeof notes) : []);
      setHistory(Array.isArray(json.history) ? (json.history as typeof history) : []);
    } catch {
      setBanner("셀 정보 조회 오류");
    } finally {
      setLoadingCell(false);
    }
  }, [setBanner]);

  const openDialog = useCallback(
    async (kind: "note" | "timeline" | "cross", t: PnlCellTargetPayload) => {
      closeMenu();
      setDialogTarget(t);
      setDialog(kind);
      setNoteDraft("");
      setDeleteConfirmFor(null);
      if (kind === "note" || kind === "timeline") await loadCellData(t);
    },
    [closeMenu, loadCellData],
  );

  const closeDialog = useCallback(() => {
    setDialog(null);
    setDialogTarget(null);
    setNotes([]);
    setHistory([]);
    setNoteDraft("");
    setDeleteConfirmFor(null);
  }, []);

  const submitNote = useCallback(async () => {
    if (!dialogTarget || !noteDraft.trim()) return;
    const res = await fetch("/api/pnl/cell", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "note",
        pnl_seq: dialogTarget.pnl_seq,
        cell_key: dialogTarget.cell_key,
        content: noteDraft.trim(),
      }),
    });
    const json = await readJsonSafe(res);
    if (!res.ok) {
      setBanner(typeof json.message === "string" ? json.message : "비고 저장 실패");
      return;
    }
    setBanner(typeof json.message === "string" ? json.message : "비고가 등록되었습니다.");
    setNoteDraft("");
    await loadCellData(dialogTarget);
    onCellNotesMutated?.();
  }, [dialogTarget, noteDraft, loadCellData, setBanner, onCellNotesMutated]);

  const confirmSoftDeleteNote = useCallback(async () => {
    if (!dialogTarget || deleteConfirmFor === null) return;
    const res = await fetch("/api/pnl/cell", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "note_delete",
        pnl_seq: dialogTarget.pnl_seq,
        cell_key: dialogTarget.cell_key,
        note_seq: deleteConfirmFor,
      }),
    });
    const json = await readJsonSafe(res);
    if (!res.ok) {
      setBanner(typeof json.message === "string" ? json.message : "삭제 실패");
      return;
    }
    setDeleteConfirmFor(null);
    setBanner(typeof json.message === "string" ? json.message : "비고를 삭제 처리했습니다.");
    await loadCellData(dialogTarget);
    onCellNotesMutated?.();
  }, [dialogTarget, deleteConfirmFor, loadCellData, setBanner, onCellNotesMutated]);

  const toggleComplete = useCallback(async () => {
    if (!menu) return;
    const t = menu.target;
    const cur = readCellCompletion({ cell_completion: t.cell_completion });
    const nextCompleted = cur[t.cell_key] !== "COMPLETED";
    const res = await fetch("/api/pnl/cell", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "complete",
        pnl_seq: t.pnl_seq,
        cell_key: t.cell_key,
        completed: nextCompleted,
      }),
    });
    const json = await readJsonSafe(res);
    if (!res.ok) {
      setBanner(typeof json.message === "string" ? json.message : "완료 상태 저장 실패");
      return;
    }
    const updatedRows = Array.isArray(json.updated_rows)
      ? (json.updated_rows as Array<{ pnl_seq: number; cell_completion: unknown }>)
      : [
          {
            pnl_seq: t.pnl_seq,
            cell_completion:
              json.cell_completion && typeof json.cell_completion === "object" && !Array.isArray(json.cell_completion)
                ? json.cell_completion
                : {},
          },
        ];
    for (const u of updatedRows) {
      const map =
        u.cell_completion && typeof u.cell_completion === "object" && !Array.isArray(u.cell_completion)
          ? (u.cell_completion as Record<string, string>)
          : {};
      patchRow(u.pnl_seq, { cell_completion: map });
    }
    const cascaded = updatedRows.length > 1;
    setBanner(
      nextCompleted
        ? cascaded
          ? "소계 및 포함 항목을 완료로 표시했습니다."
          : "완료로 표시했습니다."
        : cascaded
          ? "소계 및 포함 항목의 완료를 해제했습니다."
          : "완료를 해제했습니다.",
    );
    closeMenu();
  }, [menu, patchRow, setBanner, closeMenu]);

  const menuCompleteLabel = menu
    ? readCellCompletion({ cell_completion: menu.target.cell_completion })[menu.target.cell_key] === "COMPLETED"
      ? "완료 해제"
      : "완료 표시"
    : "완료/해제";

  if (!portalReady || (!menu && !dialog)) return null;

  const menuStyle =
    menu &&
    ({
      left: Math.min(menu.x, typeof window !== "undefined" ? window.innerWidth - 220 : menu.x),
      top: Math.min(menu.y, typeof window !== "undefined" ? window.innerHeight - 280 : menu.y),
    } as const);

  const overlayUi = (
    <>
      {menu && menuStyle && (
        <div
          ref={menuRef}
          role="menu"
          className="fixed z-[500] min-w-[200px] rounded-md border border-slate-200 bg-white py-1 text-[12px] shadow-lg"
          style={{ left: menuStyle.left, top: menuStyle.top }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          {PNL_CELL_CONTEXT_MENU_PRIMARY.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              className="flex w-full px-3 py-1.5 text-left hover:bg-slate-100 disabled:opacity-50"
              onClick={() => {
                if (item.id === "note") void openDialog("note", menu.target);
                else if (item.id === "timeline") void openDialog("timeline", menu.target);
                else if (item.id === "cross_check") void openDialog("cross", menu.target);
                else if (item.id === "complete_toggle") void toggleComplete();
              }}
            >
              {item.id === "complete_toggle" ? menuCompleteLabel : item.label}
            </button>
          ))}
          <div className="my-1 border-t border-slate-100" />
          {PNL_CELL_CONTEXT_MENU_FOOTER.map((item) => (
            <div
              key={item.id}
              className={`px-3 py-1 text-[11px] text-slate-400 ${item.disabled ? "cursor-default" : ""}`}
            >
              {item.label}
            </div>
          ))}
        </div>
      )}

      {dialog && dialogTarget && (
        <div
          className="fixed inset-0 z-[510] flex items-center justify-center bg-black/25 p-4"
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) closeDialog();
          }}
        >
          <div
            className={`relative max-h-[85vh] w-full overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl ${
              dialog === "cross" ? "max-w-4xl" : "max-w-lg"
            }`}
            onMouseDown={(e) => e.stopPropagation()}
          >
            {dialog === "note" && dialogTarget && (
              <>
                <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
                  <span className="text-sm font-semibold text-slate-800">
                    비고 - {(dialogTarget.snap.row_label ?? "").trim() || "선택된 항목"}({dialogTarget.monthLabel})
                  </span>
                  <button type="button" className="rounded px-2 py-0.5 text-xs text-slate-500 hover:bg-slate-100" onClick={closeDialog}>
                    닫기
                  </button>
                </div>
                <div className="relative flex max-h-[45vh] flex-col gap-2 overflow-y-auto px-3 py-2">
                  {loadingCell ? (
                    <p className="text-xs text-slate-500">불러오는 중…</p>
                  ) : notes.length === 0 ? (
                    <p className="text-xs text-slate-500">등록된 비고가 없습니다.</p>
                  ) : (
                    notes.map((n) => {
                      const isDeleted = Boolean(n.deleted_at);
                      return (
                        <div
                          key={n.note_seq}
                          className={`relative rounded border px-2 pb-6 pt-1.5 pr-2 text-[11px] ${
                            isDeleted ? "border-slate-100 bg-slate-50/50" : "border-slate-100 bg-slate-50/80"
                          }`}
                        >
                          <div className="mb-0.5 flex justify-between gap-2 text-slate-500">
                            <span className="font-medium text-slate-700">{n.author}</span>
                            <span>{fmtDt(n.created_at)}</span>
                          </div>
                          <p
                            className={`whitespace-pre-wrap pr-1 text-slate-800 ${
                              isDeleted ? "text-slate-500 line-through decoration-slate-500 decoration-2" : ""
                            }`}
                          >
                            {n.content}
                          </p>
                          {isDeleted ? (
                            <p className="mt-1 text-[10px] text-slate-400">삭제된 비고 · {fmtDt(n.deleted_at!)}</p>
                          ) : null}
                          {!isDeleted ? (
                            <button
                              type="button"
                              className="absolute bottom-1 right-1 rounded p-1 text-slate-400 hover:bg-slate-200/80 hover:text-red-600"
                              title="비고 삭제"
                              aria-label="비고 삭제"
                              onClick={() => setDeleteConfirmFor(n.note_seq)}
                            >
                              <TrashIcon className="block" />
                            </button>
                          ) : null}
                        </div>
                      );
                    })
                  )}
                </div>
                <div className="border-t border-slate-100 p-2">
                  <textarea
                    value={noteDraft}
                    onChange={(e) => setNoteDraft(e.target.value)}
                    rows={3}
                    placeholder="새 비고 입력…"
                    className="mb-2 w-full resize-none rounded border border-slate-200 px-2 py-1 text-[12px] outline-none focus:border-slate-400"
                  />
                  <div className="flex justify-end gap-2">
                    <button type="button" className="rounded border border-slate-200 px-2 py-1 text-xs" onClick={closeDialog}>
                      닫기
                    </button>
                    <button
                      type="button"
                      className="rounded bg-slate-800 px-2 py-1 text-xs text-white disabled:opacity-40"
                      disabled={!noteDraft.trim()}
                      onClick={() => void submitNote()}
                    >
                      등록
                    </button>
                  </div>
                </div>

                {deleteConfirmFor !== null ? (
                  <div
                    className="absolute inset-0 z-[530] flex items-center justify-center bg-black/35 p-4"
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="pnl-note-delete-title"
                    onMouseDown={(e) => {
                      if (e.target === e.currentTarget) setDeleteConfirmFor(null);
                    }}
                  >
                    <div className="max-w-sm rounded-lg border border-slate-200 bg-white p-4 shadow-xl">
                      <h2 id="pnl-note-delete-title" className="text-sm font-semibold text-slate-900">
                        비고 삭제
                      </h2>
                      <p className="mt-2 text-xs leading-relaxed text-slate-600">
                        이 비고를 삭제하시겠습니까? 원문은 삭제되지 않으며, 취소선으로 삭제된 비고임을 표시합니다.
                      </p>
                      <div className="mt-4 flex justify-end gap-2">
                        <button
                          type="button"
                          className="rounded border border-slate-200 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50"
                          onClick={() => setDeleteConfirmFor(null)}
                        >
                          취소
                        </button>
                        <button
                          type="button"
                          className="rounded bg-red-600 px-3 py-1.5 text-xs text-white hover:bg-red-700"
                          onClick={() => void confirmSoftDeleteNote()}
                        >
                          삭제
                        </button>
                      </div>
                    </div>
                  </div>
                ) : null}
              </>
            )}

            {dialog === "timeline" && (
              <>
                <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
                  <span className="text-sm font-semibold text-slate-800">
                    타임라인 — {dialogTarget.monthLabel} ({dialogTarget.cell_key})
                  </span>
                  <button type="button" className="rounded px-2 py-0.5 text-xs text-slate-500 hover:bg-slate-100" onClick={closeDialog}>
                    닫기
                  </button>
                </div>
                <div className="max-h-[60vh] overflow-auto">
                  {loadingCell ? (
                    <p className="p-3 text-xs text-slate-500">불러오는 중…</p>
                  ) : history.length === 0 ? (
                    <p className="p-3 text-xs text-slate-500">변경 이력이 없습니다.</p>
                  ) : (
                    <table className="w-full border-collapse text-left text-[11px]">
                      <thead className="sticky top-0 bg-slate-50">
                        <tr>
                          <th className="border-b border-slate-200 px-2 py-1 font-medium">변경 전</th>
                          <th className="border-b border-slate-200 px-2 py-1 font-medium">변경 후</th>
                          <th className="border-b border-slate-200 px-2 py-1 font-medium">작업자</th>
                          <th className="border-b border-slate-200 px-2 py-1 font-medium">일시</th>
                        </tr>
                      </thead>
                      <tbody>
                        {history.map((h) => (
                          <tr key={h.history_seq} className="border-b border-slate-100">
                            <td className="px-2 py-1 tabular-nums">{h.old_value ?? "—"}</td>
                            <td className="px-2 py-1 tabular-nums">{h.new_value ?? "—"}</td>
                            <td className="px-2 py-1">{h.author}</td>
                            <td className="px-2 py-1 whitespace-nowrap">{fmtDt(h.created_at)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </>
            )}

            {dialog === "cross" && (
              <>
                <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-3 py-2">
                  <span className="text-sm font-semibold text-slate-800">교차검증 — {dialogTarget.monthLabel}</span>
                  <button type="button" className="rounded px-2 py-0.5 text-xs text-slate-500 hover:bg-slate-100" onClick={closeDialog}>
                    닫기
                  </button>
                </div>
                <div className="overflow-x-auto p-2">
                  <table className="w-full min-w-[640px] border-collapse border border-slate-200 text-[11px]">
                    <thead>
                      <tr className="bg-slate-50">
                        <th className="border border-slate-200 px-2 py-1 text-left">출처</th>
                        <th className="border border-slate-200 px-2 py-1 text-left">사업상세</th>
                        <th className="border border-slate-200 px-2 py-1 text-left">구분</th>
                        <th className="border border-slate-200 px-2 py-1 text-left">코드</th>
                        <th className="border border-slate-200 px-2 py-1 text-left">거래처</th>
                        <th className="border border-slate-200 px-2 py-1 text-left">항목</th>
                        <th className="border border-slate-200 px-2 py-1 text-right">값 ({dialogTarget.monthLabel})</th>
                      </tr>
                      <tr className="bg-slate-100/80">
                        <th className="border border-slate-200 px-2 py-0.5 text-left font-normal text-slate-500" colSpan={7}>
                          목표·실적: 손익 행 기준 · CRMS 행: 매핑 전표 기준(사업그룹→사업상세, 발행일→구분, 원천ID→코드, 거래처, 항목, 금액)
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td className="border border-slate-200 bg-blue-50/40 px-2 py-1 font-medium text-blue-900">목표</td>
                        <td className="border border-slate-200 px-2 py-1">{dialogTarget.snap.category3 ?? "—"}</td>
                        <td className="border border-slate-200 px-2 py-1">{dialogTarget.snap.category2 ?? "—"}</td>
                        <td className="border border-slate-200 px-2 py-1">{dialogTarget.snap.biz_group ?? "—"}</td>
                        <td className="border border-slate-200 px-2 py-1">{dialogTarget.snap.client_name ?? "—"}</td>
                        <td className="border border-slate-200 px-2 py-1">{dialogTarget.snap.row_label ?? "—"}</td>
                        <td className="border border-slate-200 px-2 py-1 text-right tabular-nums">{fmtNum(dialogTarget.snap.goalVal)}</td>
                      </tr>
                      <tr>
                        <td className="border border-slate-200 bg-emerald-50/40 px-2 py-1 font-medium text-emerald-900">실적</td>
                        <td className="border border-slate-200 px-2 py-1">{dialogTarget.snap.category3 ?? "—"}</td>
                        <td className="border border-slate-200 px-2 py-1">{dialogTarget.snap.category2 ?? "—"}</td>
                        <td className="border border-slate-200 px-2 py-1">{dialogTarget.snap.biz_group ?? "—"}</td>
                        <td className="border border-slate-200 px-2 py-1">{dialogTarget.snap.client_name ?? "—"}</td>
                        <td className="border border-slate-200 px-2 py-1">{dialogTarget.snap.row_label ?? "—"}</td>
                        <td className="border border-slate-200 px-2 py-1 text-right tabular-nums">{fmtNum(dialogTarget.snap.actualVal)}</td>
                      </tr>
                      <tr>
                        <td className="border border-slate-200 bg-amber-50/50 px-2 py-1 font-medium text-amber-900">CRMS(추적)</td>
                        {crossLoading ? (
                          <td className="border border-slate-200 px-2 py-2 text-slate-500" colSpan={6}>
                            CRMS 매핑 조회 중…
                          </td>
                        ) : crossData?.crmsRow ? (
                          <>
                            <td className="border border-slate-200 px-2 py-1">{crossData.crmsRow.col_detail}</td>
                            <td className="border border-slate-200 px-2 py-1 whitespace-nowrap">{crossData.crmsRow.col_category}</td>
                            <td className="border border-slate-200 px-2 py-1">{crossData.crmsRow.col_code}</td>
                            <td className="border border-slate-200 px-2 py-1">{crossData.crmsRow.col_client}</td>
                            <td className="border border-slate-200 px-2 py-1">{crossData.crmsRow.col_item}</td>
                            <td className="border border-slate-200 px-2 py-1 text-right tabular-nums font-medium text-amber-900">
                              {fmtNum(crossData.crmsRow.amount)}
                            </td>
                          </>
                        ) : crossData?.mappings?.length ? (
                          <td className="border border-slate-200 px-2 py-1 text-slate-500" colSpan={6}>
                            매핑은 있으나 전표를 찾을 수 없습니다. (
                            {crossData.mappings.map((m) => `${m.crms_module} #${m.source_seq}`).join(", ")})
                          </td>
                        ) : (
                          <td className="border border-slate-200 px-2 py-1 text-slate-500" colSpan={6}>
                            CRMS 매핑이 없습니다. 손익계획 상단 「매핑」에서 사업그룹·항목을 연결해 주세요.
                          </td>
                        )}
                      </tr>
                    </tbody>
                  </table>
                  <p className="mt-2 text-[10px] text-slate-500">
                    CRMS 금액은 해당 월에 매핑된 전표들의 합계입니다. 목표·실적 열의 월 값과 비교할 때는 업무 기준에 맞게 해석해 주세요.
                  </p>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
  return createPortal(overlayUi, document.body);
});
