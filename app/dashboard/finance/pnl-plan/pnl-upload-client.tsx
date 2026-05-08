"use client";

import { useMemo, useState } from "react";

type UploadResult = {
  message: string;
  processed?: number;
  year?: number;
};

export default function PnlUploadClient() {
  const [file, setFile] = useState<File | null>(null);
  const [sourcePath, setSourcePath] = useState("");
  const [baseYear, setBaseYear] = useState<number>(new Date().getFullYear());
  const [isUploading, setIsUploading] = useState(false);
  const [result, setResult] = useState<UploadResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const acceptHint = useMemo(
    () => "엑셀 시트 내 [AR] / [AP] 구역을 자동 인식하여 TB_PNL_MASTER로 업로드합니다.",
    [],
  );

  const onUpload = async () => {
    const trimmedPath = sourcePath.trim();
    if (!file && !trimmedPath) {
      setError("엑셀 파일 선택 또는 파일 경로 입력이 필요합니다.");
      return;
    }

    try {
      setIsUploading(true);
      setError(null);
      setResult(null);

      const formData = new FormData();
      if (file) formData.append("file", file);
      if (trimmedPath) formData.append("sourcePath", trimmedPath);
      formData.append("baseYear", String(baseYear));

      const response = await fetch("/api/upload/pnl", {
        method: "POST",
        body: formData,
      });
      const json = (await response.json()) as UploadResult;

      if (!response.ok) {
        throw new Error(json.message || "업로드 중 오류가 발생했습니다.");
      }
      setResult(json);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "업로드 중 오류가 발생했습니다.");
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">{acceptHint}</div>

      <div className="grid gap-3 md:grid-cols-[160px_1fr_auto] md:items-end">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-slate-600">기준연도</span>
          <input
            type="number"
            min={2020}
            max={2100}
            value={baseYear}
            onChange={(event) => setBaseYear(Number(event.target.value) || new Date().getFullYear())}
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-indigo-200 focus:ring-2"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-slate-600">엑셀 파일</span>
          <input
            type="file"
            accept=".xlsx,.xls,.xlsm"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm file:mr-3 file:rounded file:border-0 file:bg-indigo-600 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-white hover:file:bg-indigo-700"
          />
        </label>

        <button
          type="button"
          onClick={onUpload}
          disabled={isUploading}
          className="h-10 rounded-md bg-indigo-600 px-4 text-sm font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-indigo-300"
        >
          {isUploading ? "업로드 중..." : "엑셀 업로드(초기화)"}
        </button>
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-xs font-semibold text-slate-600">또는 로컬 파일 경로(서버 읽기)</span>
        <input
          type="text"
          value={sourcePath}
          onChange={(event) => setSourcePath(event.target.value)}
          placeholder="예: C:\\Users\\admin\\Documents\\26 손익계획 기초.xlsx"
          className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-indigo-200 placeholder:text-slate-400 focus:ring-2"
        />
      </label>

      {error ? <p className="text-sm font-medium text-rose-600">{error}</p> : null}
      {result ? (
        <p className="text-sm font-medium text-emerald-700">
          {result.message} (연도: {result.year} / 처리건수: {(result.processed ?? 0).toLocaleString("ko-KR")}건)
        </p>
      ) : null}
    </div>
  );
}
