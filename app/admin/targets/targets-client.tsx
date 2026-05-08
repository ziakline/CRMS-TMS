"use client";

import { Pencil, Trash2, X } from "lucide-react";
import { useState, useTransition } from "react";
import { createTarget, deleteTarget, toggleTargetActive, updateTarget } from "./actions";

type CrawlTargetItem = {
  target_seq: number;
  base_year: number | null;
  project_name: string | null;
  project_cd: string;
  biz_sector_nm: string | null;
  biz_dept_nm: string | null;
  is_active: string;
};

type TargetsClientProps = {
  initialTargets: CrawlTargetItem[];
};

export default function TargetsClient({ initialTargets }: TargetsClientProps) {
  const [targets, setTargets] = useState(initialTargets);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openModal, setOpenModal] = useState(false);
  const [editingTargetSeq, setEditingTargetSeq] = useState<number | null>(null);
  const [isPending, startTransition] = useTransition();

  const [baseYear, setBaseYear] = useState(String(new Date().getFullYear()));
  const [projectName, setProjectName] = useState("");
  const [projectCode, setProjectCode] = useState("");
  const [bizSectorName, setBizSectorName] = useState("");
  const [bizDeptName, setBizDeptName] = useState("");
  const [isActive, setIsActive] = useState<"Y" | "N">("Y");

  const refreshTargets = async () => {
    const response = await fetch("/api/admin/targets", { cache: "no-store" });
    if (!response.ok) return;
    const data = (await response.json()) as { targets: CrawlTargetItem[] };
    setTargets(data.targets);
  };

  const openCreateModal = () => {
    setEditingTargetSeq(null);
    setBaseYear(String(new Date().getFullYear()));
    setProjectName("");
    setProjectCode("");
    setBizSectorName("");
    setBizDeptName("");
    setIsActive("Y");
    setOpenModal(true);
  };

  const openEditModal = (target: CrawlTargetItem) => {
    setEditingTargetSeq(target.target_seq);
    setBaseYear(String(target.base_year ?? new Date().getFullYear()));
    setProjectName(target.project_name ?? "");
    setProjectCode(target.project_cd);
    setBizSectorName(target.biz_sector_nm ?? "");
    setBizDeptName(target.biz_dept_nm ?? "");
    setIsActive(target.is_active === "Y" ? "Y" : "N");
    setOpenModal(true);
  };

  const handleSave = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setToast(null);
    setError(null);

    startTransition(async () => {
      const payload = {
        base_year: Number(baseYear),
        project_name: projectName,
        project_cd: projectCode,
        biz_sector_nm: bizSectorName,
        biz_dept_nm: bizDeptName,
        is_active: isActive,
      };
      const result = editingTargetSeq
        ? await updateTarget(editingTargetSeq, payload)
        : await createTarget(payload);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setToast(result.message);
      setOpenModal(false);
      setEditingTargetSeq(null);
      await refreshTargets();
    });
  };

  const handleToggle = (targetSeq: number) => {
    setToast(null);
    setError(null);
    startTransition(async () => {
      const result = await toggleTargetActive(targetSeq);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setToast(result.message);
      await refreshTargets();
    });
  };

  const handleDelete = (targetSeq: number) => {
    if (!confirm("정말 이 타겟을 삭제하시겠습니까?")) return;
    setToast(null);
    setError(null);
    startTransition(async () => {
      const result = await deleteTarget(targetSeq);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setToast(result.message);
      await refreshTargets();
    });
  };

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-slate-900">크롤링 타겟 관리</h1>
        <button
          type="button"
          onClick={openCreateModal}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
        >
          신규 타겟 등록
        </button>
      </div>

      {toast ? <p className="mb-3 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{toast}</p> : null}
      {error ? <p className="mb-3 rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}

      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-100">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">대상 연도</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">프로젝트명</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">프로젝트 코드</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">사업부문(2뎁스)</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">사업부서(3뎁스)</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">활성 상태</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-slate-600">관리</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 [&>tr:nth-child(even)]:bg-slate-50">
            {targets.map((target) => (
              <tr key={target.target_seq}>
                <td className="px-4 py-3">{target.base_year ?? "-"}</td>
                <td className="px-4 py-3">{target.project_name ?? "-"}</td>
                <td className="px-4 py-3 font-medium text-slate-800">{target.project_cd}</td>
                <td className="px-4 py-3">{target.biz_sector_nm ?? "-"}</td>
                <td className="px-4 py-3">{target.biz_dept_nm ?? "-"}</td>
                <td className="px-4 py-3">
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() => handleToggle(target.target_seq)}
                    className={`rounded-full px-3 py-1 text-xs font-semibold ${
                      target.is_active === "Y"
                        ? "bg-emerald-100 text-emerald-700"
                        : "bg-slate-200 text-slate-600"
                    }`}
                  >
                    {target.is_active === "Y" ? "활성" : "비활성"}
                  </button>
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() => openEditModal(target)}
                    className="mr-2 inline-flex items-center gap-1 rounded-md border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    <Pencil size={12} />
                    수정
                  </button>
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() => handleDelete(target.target_seq)}
                    className="inline-flex items-center gap-1 rounded-md border border-rose-200 px-2 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-50"
                  >
                    <Trash2 size={12} />
                    삭제
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {openModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 px-4">
          <div className="w-full max-w-lg rounded-xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <h2 className="text-lg font-bold text-slate-900">신규 타겟 등록</h2>
              <button type="button" onClick={() => setOpenModal(false)} className="rounded p-1 hover:bg-slate-100">
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleSave} className="space-y-4 px-5 py-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-1 text-sm">
                  <span className="font-medium text-slate-700">대상 연도</span>
                  <input
                    type="number"
                    value={baseYear}
                    onChange={(e) => setBaseYear(e.target.value)}
                    className="w-full rounded-md border border-slate-300 px-3 py-2"
                  />
                </label>
                <label className="space-y-1 text-sm">
                  <span className="font-medium text-slate-700">활성 상태</span>
                  <select
                    value={isActive}
                    onChange={(e) => setIsActive(e.target.value as "Y" | "N")}
                    className="w-full rounded-md border border-slate-300 px-3 py-2"
                  >
                    <option value="Y">활성</option>
                    <option value="N">비활성</option>
                  </select>
                </label>
              </div>
              <label className="block space-y-1 text-sm">
                <span className="font-medium text-slate-700">프로젝트명</span>
                <input
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  className="w-full rounded-md border border-slate-300 px-3 py-2"
                />
              </label>
              <label className="block space-y-1 text-sm">
                <span className="font-medium text-slate-700">프로젝트 코드</span>
                <input
                  value={projectCode}
                  onChange={(e) => setProjectCode(e.target.value)}
                  className="w-full rounded-md border border-slate-300 px-3 py-2"
                />
              </label>
              <label className="block space-y-1 text-sm">
                <span className="font-medium text-slate-700">사업부문(2뎁스)</span>
                <input
                  value={bizSectorName}
                  onChange={(e) => setBizSectorName(e.target.value)}
                  className="w-full rounded-md border border-slate-300 px-3 py-2"
                />
              </label>
              <label className="block space-y-1 text-sm">
                <span className="font-medium text-slate-700">사업부서(3뎁스)</span>
                <input
                  value={bizDeptName}
                  onChange={(e) => setBizDeptName(e.target.value)}
                  className="w-full rounded-md border border-slate-300 px-3 py-2"
                />
              </label>
              <div className="flex justify-end gap-2 border-t border-slate-200 pt-3">
                <button
                  type="button"
                  onClick={() => setOpenModal(false)}
                  className="rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  취소
                </button>
                <button
                  type="submit"
                  disabled={isPending}
                  className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
                >
                  {isPending ? "저장 중..." : editingTargetSeq ? "수정" : "저장"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </section>
  );
}
