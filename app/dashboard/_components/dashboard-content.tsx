"use client";

import { useEffect, useState } from "react";
import type { DashboardStatsResult } from "../../../lib/dashboard-stats";
import { formatKstDateTime } from "../../../lib/time";
import YearSelect from "./year-select";
import { useRouter } from "next/navigation";

type HistoryItem = {
  history_seq: number;
  project_cd: string;
  worker_nm: string | null;
  remarks: string;
  change_dt: string;
};

type CrawlerResponse = {
  status: "idle" | "running" | "success" | "failed";
  startedAt?: string | null;
  finishedAt?: string | null;
  message: string;
  log?: string;
};

type DashboardContentProps = {
  userName: string;
  currentDateText: string;
  greetingText: string;
  initialStats: DashboardStatsResult;
  recentHistories: HistoryItem[];
  latestSyncText: string;
  selectedYear: number;
};

function formatWon(value: number) {
  return `${value.toLocaleString("ko-KR")}원`;
}

function formatDiff(value: number) {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toLocaleString("ko-KR")}원`;
}

function formatRate(value: number | null) {
  if (value === null) return "전일 데이터 없음";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}

function formatDateTime(value: string) {
  return formatKstDateTime(value);
}

export default function DashboardContent({
  userName,
  currentDateText,
  greetingText,
  initialStats,
  recentHistories,
  latestSyncText,
  selectedYear,
}: DashboardContentProps) {
  const router = useRouter();
  const [stats, setStats] = useState(initialStats);
  const [latestSync, setLatestSync] = useState(latestSyncText);
  const [syncLoading, setSyncLoading] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [syncLog, setSyncLog] = useState<string>("");
  const [syncStepIndex, setSyncStepIndex] = useState(0);
  const syncSteps = [
    "CRMS 로그인 및 초기 화면 진입 중...",
    "조회 조건(연도/타겟) 적용 중...",
    "프로젝트별 데이터 수집 중...",
    "변경 이력 비교 및 저장 중...",
    "최종 동기화 결과 정리 중...",
  ];
  const arGroupTotals = stats.ar_groups.reduce(
    (acc, group) => {
      acc.total += group.total_amount;
      acc.pending += group.pending_amount;
      acc.completed += group.completed_amount;
      return acc;
    },
    { total: 0, pending: 0, completed: 0 },
  );
  const apGroupTotals = stats.ap_groups.reduce(
    (acc, group) => {
      acc.total += group.total_amount;
      acc.pending += group.pending_amount;
      acc.completed += group.completed_amount;
      return acc;
    },
    { total: 0, pending: 0, completed: 0 },
  );

  const refreshStats = async () => {
    const response = await fetch(`/api/dashboard/stats?year=${selectedYear}`, { cache: "no-store" });
    if (!response.ok) {
      throw new Error("통계 정보를 새로고침하지 못했습니다.");
    }

    const nextStats = (await response.json()) as DashboardStatsResult;
    setStats(nextStats);
  };

  const handleRunCrawler = async () => {
    setSyncLoading(true);
    setSyncStepIndex(0);
    setSyncMessage("크롤러 실행을 시작합니다...");
    setSyncLog("");

    try {
      const response = await fetch("/api/admin/run-crawler", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ year: selectedYear }),
      });
      const result = (await response.json()) as CrawlerResponse;
      if (!response.ok) {
        throw new Error(result.message ?? "크롤러 실행 요청에 실패했습니다.");
      }
      setSyncMessage(result.message);
      setSyncLog(result.log ?? "");
      setLatestSync(result.finishedAt ? formatDateTime(result.finishedAt) : formatDateTime(new Date().toISOString()));
      await refreshStats();
      router.refresh();
    } catch (error) {
      setSyncMessage(error instanceof Error ? error.message : "동기화 실행 중 오류가 발생했습니다.");
    } finally {
      setSyncLoading(false);
    }
  };

  useEffect(() => {
    if (!syncLoading) return;
    const interval = setInterval(() => {
      setSyncStepIndex((prev) => (prev + 1) % syncSteps.length);
    }, 2200);
    return () => clearInterval(interval);
  }, [syncLoading, syncSteps.length]);

  return (
    <main className="flex-1 p-6 md:p-10">
      <header className="mb-8 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-sm text-slate-500">{currentDateText}</p>
          <h2 className="mt-2 text-3xl font-bold text-slate-900">
            {greetingText}, {userName}님
          </h2>
        </div>
        <div className="w-full flex-shrink-0 lg:w-[320px]">
          <div className="mb-2 flex justify-end">
            <YearSelect selectedYear={selectedYear} />
          </div>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => void handleRunCrawler()}
              disabled={syncLoading}
              className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {syncLoading ? (
                <>
                  <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                  동기화 중...
                </>
              ) : (
                "최신 정보 조회"
              )}
            </button>
          </div>
          <p className="mt-2 min-h-5 text-right text-xs text-slate-500">
            {syncLoading ? syncSteps[syncStepIndex] : syncMessage ?? ""}
          </p>
          {!syncLoading && syncLog ? (
            <details className="mt-2 rounded-md border border-slate-200 bg-white p-2">
              <summary className="cursor-pointer text-right text-xs font-semibold text-slate-600">
                실행 로그 보기
              </summary>
              <pre className="mt-2 max-h-52 overflow-auto whitespace-pre-wrap text-[11px] leading-5 text-slate-700">
                {syncLog}
              </pre>
            </details>
          ) : null}
        </div>
      </header>

      <section className="grid gap-6 lg:grid-cols-2">
        <article className="rounded-xl bg-blue-50 p-6 shadow-sm ring-1 ring-blue-200">
          <h3 className="text-lg font-bold text-blue-900">AR</h3>
          <p className="mt-2 text-sm text-blue-700">최근 동기화: {latestSync}</p>
          <p className="mt-4 text-3xl font-extrabold text-blue-900">
            {stats.ar.total_amount.toLocaleString()}원
          </p>
          <p
            className={`mt-2 text-sm font-semibold ${
              stats.ar.day_over_day.amount_diff > 0
                ? "text-blue-700"
                : stats.ar.day_over_day.amount_diff < 0
                  ? "text-rose-600"
                  : "text-slate-600"
            }`}
          >
            직전 조회 대비 증감액 {formatDiff(stats.ar.day_over_day.amount_diff)} (
            {formatRate(stats.ar.day_over_day.amount_diff_rate)})
          </p>
          <div className="mt-4 overflow-hidden rounded-lg border border-blue-200 bg-white">
            <table className="min-w-full">
              <thead className="bg-blue-100">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-blue-800">지표</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-blue-800">값</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-blue-100 [&>tr:nth-child(even)]:bg-blue-50/40">
                <tr>
                  <td className="px-4 py-3 text-sm text-slate-700">총 매출액</td>
                  <td className="px-4 py-3 text-right text-sm font-semibold text-slate-900">
                    {formatWon(stats.ar.total_amount)}
                  </td>
                </tr>
                <tr>
                  <td className="px-4 py-3 text-sm text-slate-700">미청구 건수 (대기)</td>
                  <td className="px-4 py-3 text-right text-sm font-semibold text-amber-600">
                    {stats.ar.pending_cnt.toLocaleString()}건
                  </td>
                </tr>
                <tr>
                  <td className="px-4 py-3 text-sm text-slate-700">미청구 금액</td>
                  <td className="px-4 py-3 text-right text-sm font-semibold text-amber-700">
                    {formatWon(stats.ar.pending_amount)}
                  </td>
                </tr>
                <tr>
                  <td className="px-4 py-3 text-sm text-slate-700">청구 완료 건수 (완료/진행)</td>
                  <td className="px-4 py-3 text-right text-sm font-semibold text-blue-700">
                    {stats.ar.completed_cnt.toLocaleString()}건
                  </td>
                </tr>
                <tr>
                  <td className="px-4 py-3 text-sm text-slate-700">청구 완료 금액</td>
                  <td className="px-4 py-3 text-right text-sm font-semibold text-blue-700">
                    {formatWon(stats.ar.completed_amount)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </article>

        <article className="rounded-xl bg-rose-50 p-6 shadow-sm ring-1 ring-rose-200">
          <h3 className="text-lg font-bold text-rose-900">AP</h3>
          <p className="mt-2 text-sm text-rose-700">최근 동기화: {latestSync}</p>
          <p className="mt-4 text-3xl font-extrabold text-rose-900">
            {stats.ap.total_amount.toLocaleString()}원
          </p>
          <p
            className={`mt-2 text-sm font-semibold ${
              stats.ap.day_over_day.amount_diff > 0
                ? "text-blue-700"
                : stats.ap.day_over_day.amount_diff < 0
                  ? "text-rose-700"
                  : "text-slate-600"
            }`}
          >
            직전 조회 대비 증감액 {formatDiff(stats.ap.day_over_day.amount_diff)} (
            {formatRate(stats.ap.day_over_day.amount_diff_rate)})
          </p>
          <div className="mt-4 overflow-hidden rounded-lg border border-rose-200 bg-white">
            <table className="min-w-full">
              <thead className="bg-rose-100">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-rose-800">지표</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-rose-800">값</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-rose-100 [&>tr:nth-child(even)]:bg-rose-50/40">
                <tr>
                  <td className="px-4 py-3 text-sm text-slate-700">총 매입액</td>
                  <td className="px-4 py-3 text-right text-sm font-semibold text-slate-900">
                    {formatWon(stats.ap.total_amount)}
                  </td>
                </tr>
                <tr>
                  <td className="px-4 py-3 text-sm text-slate-700">미지급 건수 (대기)</td>
                  <td className="px-4 py-3 text-right text-sm font-semibold text-amber-600">
                    {stats.ap.pending_cnt.toLocaleString()}건
                  </td>
                </tr>
                <tr>
                  <td className="px-4 py-3 text-sm text-slate-700">미지급 금액</td>
                  <td className="px-4 py-3 text-right text-sm font-semibold text-amber-700">
                    {formatWon(stats.ap.pending_amount)}
                  </td>
                </tr>
                <tr>
                  <td className="px-4 py-3 text-sm text-slate-700">지급 완료 건수 (완료/진행)</td>
                  <td className="px-4 py-3 text-right text-sm font-semibold text-rose-700">
                    {stats.ap.completed_cnt.toLocaleString()}건
                  </td>
                </tr>
                <tr>
                  <td className="px-4 py-3 text-sm text-slate-700">지급 완료 금액</td>
                  <td className="px-4 py-3 text-right text-sm font-semibold text-rose-700">
                    {formatWon(stats.ap.completed_amount)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </article>
      </section>

      <section className="mt-8 grid gap-6 grid-cols-1">
        <article className="rounded-xl border border-blue-200 bg-white p-5 shadow-sm">
          <h4 className="text-base font-bold text-blue-900">AR 사업그룹 요약</h4>
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-blue-50 text-xs text-blue-800">
                <tr>
                  <th className="px-3 py-2 text-left">사업그룹</th>
                  <th className="px-3 py-2 text-right">총 금액</th>
                  <th className="px-3 py-2 text-right">미청구 금액</th>
                  <th className="px-3 py-2 text-right">청구 금액</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 [&>tr:nth-child(even)]:bg-blue-50/30">
                {stats.ar_groups.map((group) => (
                  <tr key={group.biz_group_nm}>
                    <td className="px-3 py-2">{group.biz_group_nm}</td>
                    <td className="px-3 py-2 text-right">{group.total_amount.toLocaleString()}원</td>
                    <td className="px-3 py-2 text-right font-semibold text-amber-600">
                      {group.pending_amount.toLocaleString()}원
                    </td>
                    <td className="px-3 py-2 text-right font-semibold text-blue-700">
                      {group.completed_amount.toLocaleString()}원
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t-2 border-blue-200 bg-blue-100/70">
                <tr>
                  <td className="px-3 py-2 font-semibold text-blue-900">합계</td>
                  <td className="px-3 py-2 text-right font-semibold text-blue-900">
                    {arGroupTotals.total.toLocaleString()}원
                  </td>
                  <td className="px-3 py-2 text-right font-semibold text-amber-700">
                    {arGroupTotals.pending.toLocaleString()}원
                  </td>
                  <td className="px-3 py-2 text-right font-semibold text-blue-800">
                    {arGroupTotals.completed.toLocaleString()}원
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </article>

        <article className="rounded-xl border border-rose-200 bg-white p-5 shadow-sm">
          <h4 className="text-base font-bold text-rose-900">AP 사업그룹 요약</h4>
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-rose-50 text-xs text-rose-800">
                <tr>
                  <th className="px-3 py-2 text-left">사업그룹</th>
                  <th className="px-3 py-2 text-right">총 금액</th>
                  <th className="px-3 py-2 text-right">미지급 금액</th>
                  <th className="px-3 py-2 text-right">지급 금액</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 [&>tr:nth-child(even)]:bg-rose-50/30">
                {stats.ap_groups.map((group) => (
                  <tr key={group.biz_group_nm}>
                    <td className="px-3 py-2">{group.biz_group_nm}</td>
                    <td className="px-3 py-2 text-right">{group.total_amount.toLocaleString()}원</td>
                    <td className="px-3 py-2 text-right font-semibold text-amber-600">
                      {group.pending_amount.toLocaleString()}원
                    </td>
                    <td className="px-3 py-2 text-right font-semibold text-rose-700">
                      {group.completed_amount.toLocaleString()}원
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t-2 border-rose-200 bg-rose-100/70">
                <tr>
                  <td className="px-3 py-2 font-semibold text-rose-900">합계</td>
                  <td className="px-3 py-2 text-right font-semibold text-rose-900">
                    {apGroupTotals.total.toLocaleString()}원
                  </td>
                  <td className="px-3 py-2 text-right font-semibold text-amber-700">
                    {apGroupTotals.pending.toLocaleString()}원
                  </td>
                  <td className="px-3 py-2 text-right font-semibold text-rose-800">
                    {apGroupTotals.completed.toLocaleString()}원
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </article>
      </section>

      <section className="mt-8 rounded-xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
        <h3 className="text-lg font-bold text-slate-900">최근 변경 이력</h3>
        <ul className="mt-4 divide-y divide-slate-200">
          {recentHistories.length === 0 ? (
            <li className="py-4 text-sm text-slate-500">변경 이력이 없습니다.</li>
          ) : (
            recentHistories.map((history) => (
              <li key={history.history_seq} className="py-4">
                <p className="text-sm font-semibold text-slate-800">
                  [{history.project_cd}] {history.worker_nm ?? "담당자 미상"}
                </p>
                <p className="mt-1 text-sm text-slate-600">{history.remarks}</p>
                <p className="mt-1 text-xs text-slate-400">{formatDateTime(history.change_dt)}</p>
              </li>
            ))
          )}
        </ul>
      </section>
    </main>
  );
}
