import { prisma } from "./prisma";
import { formatKstDateTime } from "./time";

function laterDate(a: Date | null | undefined, b: Date | null | undefined): Date | null {
  if (!a) return b ?? null;
  if (!b) return a;
  return a.getTime() >= b.getTime() ? a : b;
}

/** 대시보드 AR/AP 카드용 — 해당 연도 전표 기준 DB 반영 시각(BAT·크롤러가 행을 갱신하면 updated_at 상승) */
export async function getDashboardModuleSyncLabels(selectedYear: number): Promise<{ ar: string; ap: string }> {
  const issueDtWhere = {
    gte: new Date(Date.UTC(selectedYear, 0, 1)),
    lt: new Date(Date.UTC(selectedYear + 1, 0, 1)),
  };
  const manualWhere = { change_dt: issueDtWhere };

  const [arAgg, apAgg, syncEnd, manualRow] = await Promise.all([
    prisma.ar.aggregate({
      where: { is_deleted: "N", issue_dt: issueDtWhere },
      _max: { updated_at: true, created_at: true },
    }),
    prisma.ap.aggregate({
      where: { is_deleted: "N", issue_dt: issueDtWhere },
      _max: { updated_at: true, created_at: true },
    }),
    prisma.syncLog.findFirst({
      where: { end_dt: { not: null } },
      orderBy: { end_dt: "desc" },
      select: { end_dt: true },
    }),
    prisma.manualHistory.findFirst({
      where: manualWhere,
      orderBy: { change_dt: "desc" },
      select: { change_dt: true },
    }),
  ]);

  const syncDt = syncEnd?.end_dt ?? null;
  const manualDt = manualRow?.change_dt ?? null;

  const arTouch = laterDate(arAgg._max.updated_at ?? undefined, arAgg._max.created_at ?? undefined);
  const apTouch = laterDate(apAgg._max.updated_at ?? undefined, apAgg._max.created_at ?? undefined);

  const arLatest = arTouch ?? syncDt ?? manualDt;
  const apLatest = apTouch ?? syncDt ?? manualDt;

  return {
    ar: arLatest ? formatKstDateTime(arLatest) : "-",
    ap: apLatest ? formatKstDateTime(apLatest) : "-",
  };
}

type DashboardMetric = {
  total_amount: number;
  pending_cnt: number;
  pending_amount: number;
  completed_cnt: number;
  completed_amount: number;
  day_over_day: {
    amount_diff: number;
    amount_diff_rate: number | null;
  };
};

type BizGroupSummary = {
  biz_group_nm: string;
  total_amount: number;
  pending_amount: number;
  completed_amount: number;
};

export type DashboardStatsResult = {
  ar: DashboardMetric;
  ap: DashboardMetric;
  ar_groups: BizGroupSummary[];
  ap_groups: BizGroupSummary[];
};

function toNumber(value: unknown) {
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  if (value && typeof value === "object" && "toNumber" in value) {
    return (value as { toNumber: () => number }).toNumber();
  }
  return 0;
}

function getDayRange(baseDate: Date) {
  const start = new Date(baseDate);
  start.setHours(0, 0, 0, 0);

  const end = new Date(start);
  end.setDate(end.getDate() + 1);

  return { start, end };
}

function calculateDiffRate(current: number, previous: number) {
  if (previous === 0) {
    if (current === 0) return 0;
    return null;
  }
  return ((current - previous) / previous) * 100;
}

export async function getDashboardStats(selectedYear?: number): Promise<DashboardStatsResult> {
  const now = new Date();
  const issueDtWhere =
    selectedYear && Number.isFinite(selectedYear)
      ? {
          gte: new Date(Date.UTC(selectedYear, 0, 1)),
          lt: new Date(Date.UTC(selectedYear + 1, 0, 1)),
        }
      : undefined;
  const todayRange = getDayRange(now);
  const yesterdayBase = new Date(todayRange.start);
  yesterdayBase.setDate(yesterdayBase.getDate() - 1);
  const yesterdayRange = getDayRange(yesterdayBase);

  const [arTotalAgg, arPendingAgg, arCompletedAgg, apTotalAgg, apPendingAgg, apCompletedAgg] =
    await Promise.all([
      prisma.ar.aggregate({
        where: issueDtWhere ? { issue_dt: issueDtWhere } : undefined,
        _sum: { amount: true },
      }),
      prisma.ar.aggregate({
        where: {
          ...(issueDtWhere ? { issue_dt: issueDtWhere } : {}),
          OR: [
            { claim_status: null },
            { claim_status: "" },
            {
              claim_status: {
                contains: "대기",
              },
            },
          ],
        },
        _count: { _all: true },
        _sum: { amount: true },
      }),
      prisma.ar.aggregate({
        where: {
          ...(issueDtWhere ? { issue_dt: issueDtWhere } : {}),
          OR: [
            {
              claim_status: {
                contains: "완료",
              },
            },
            {
              claim_status: {
                contains: "진행",
              },
            },
          ],
        },
        _count: { _all: true },
        _sum: { amount: true },
      }),
      prisma.ap.aggregate({
        where: issueDtWhere ? { issue_dt: issueDtWhere } : undefined,
        _sum: { amount: true },
      }),
      prisma.ap.aggregate({
        where: {
          ...(issueDtWhere ? { issue_dt: issueDtWhere } : {}),
          OR: [
            { pay_status: null },
            { pay_status: "" },
            {
              pay_status: {
                contains: "대기",
              },
            },
          ],
        },
        _count: { _all: true },
        _sum: { amount: true },
      }),
      prisma.ap.aggregate({
        where: {
          ...(issueDtWhere ? { issue_dt: issueDtWhere } : {}),
          OR: [
            {
              pay_status: {
                contains: "완료",
              },
            },
            {
              pay_status: {
                contains: "진행",
              },
            },
          ],
        },
        _count: { _all: true },
        _sum: { amount: true },
      }),
    ]);

  const [arGroupTotal, arGroupPending, apGroupTotal, apGroupPending] = await Promise.all([
    prisma.ar.groupBy({
      by: ["biz_group_nm"],
      where: issueDtWhere ? { issue_dt: issueDtWhere } : undefined,
      _sum: { amount: true },
      _min: { ar_seq: true },
      orderBy: { _min: { ar_seq: "asc" } },
    }),
    prisma.ar.groupBy({
      by: ["biz_group_nm"],
      where: {
        ...(issueDtWhere ? { issue_dt: issueDtWhere } : {}),
        OR: [
          { claim_status: null },
          { claim_status: "" },
          {
            claim_status: {
              contains: "대기",
            },
          },
        ],
      },
      _sum: { amount: true },
    }),
    prisma.ap.groupBy({
      by: ["biz_group_nm"],
      where: issueDtWhere ? { issue_dt: issueDtWhere } : undefined,
      _sum: { amount: true },
      _min: { ap_seq: true },
      orderBy: { _min: { ap_seq: "asc" } },
    }),
    prisma.ap.groupBy({
      by: ["biz_group_nm"],
      where: {
        ...(issueDtWhere ? { issue_dt: issueDtWhere } : {}),
        OR: [
          { pay_status: null },
          { pay_status: "" },
          {
            pay_status: {
              contains: "대기",
            },
          },
        ],
      },
      _sum: { amount: true },
    }),
  ]);

  const [arTodayAgg, arYesterdayAgg, apTodayAgg, apYesterdayAgg] = await Promise.all([
    prisma.ar.aggregate({
      where: {
        issue_dt: {
          gte: todayRange.start,
          lt: todayRange.end,
        },
      },
      _sum: { amount: true },
    }),
    prisma.ar.aggregate({
      where: {
        issue_dt: {
          gte: yesterdayRange.start,
          lt: yesterdayRange.end,
        },
      },
      _sum: { amount: true },
    }),
    prisma.ap.aggregate({
      where: {
        issue_dt: {
          gte: todayRange.start,
          lt: todayRange.end,
        },
      },
      _sum: { amount: true },
    }),
    prisma.ap.aggregate({
      where: {
        issue_dt: {
          gte: yesterdayRange.start,
          lt: yesterdayRange.end,
        },
      },
      _sum: { amount: true },
    }),
  ]);

  const arTodayAmount = toNumber(arTodayAgg._sum.amount);
  const arYesterdayAmount = toNumber(arYesterdayAgg._sum.amount);
  const apTodayAmount = toNumber(apTodayAgg._sum.amount);
  const apYesterdayAmount = toNumber(apYesterdayAgg._sum.amount);

  const arPendingCnt = arPendingAgg._count._all;
  const apPendingCnt = apPendingAgg._count._all;
  const arCompletedCnt = arCompletedAgg._count._all;
  const apCompletedCnt = apCompletedAgg._count._all;

  const arPendingAmount = toNumber(arPendingAgg._sum.amount);
  const apPendingAmount = toNumber(apPendingAgg._sum.amount);
  const arCompletedAmount = toNumber(arCompletedAgg._sum.amount);
  const apCompletedAmount = toNumber(apCompletedAgg._sum.amount);

  const toGroupMap = (rows: Array<{ biz_group_nm: string | null; _sum: { amount: unknown } }>) => {
    const map = new Map<string, number>();
    for (const row of rows) {
      map.set(row.biz_group_nm?.trim() || "미분류", toNumber(row._sum.amount));
    }
    return map;
  };

  const mergeGroupSummary = (
    totals: Array<{ biz_group_nm: string | null; _sum: { amount: unknown } }>,
    pending: Array<{ biz_group_nm: string | null; _sum: { amount: unknown } }>,
  ): BizGroupSummary[] => {
    const pendingMap = toGroupMap(pending);

    return totals
      .map((row) => {
        const bizGroupName = row.biz_group_nm?.trim() || "미분류";
        const totalAmount = toNumber(row._sum.amount);
        const pendingAmount = pendingMap.get(bizGroupName) ?? 0;

        return {
          biz_group_nm: bizGroupName,
          total_amount: totalAmount,
          pending_amount: pendingAmount,
          completed_amount: Math.max(totalAmount - pendingAmount, 0),
        };
      });
  };

  return {
    ar: {
      total_amount: toNumber(arTotalAgg._sum.amount),
      pending_cnt: arPendingCnt,
      pending_amount: arPendingAmount,
      completed_cnt: arCompletedCnt,
      completed_amount: arCompletedAmount,
      day_over_day: {
        amount_diff: arTodayAmount - arYesterdayAmount,
        amount_diff_rate: calculateDiffRate(arTodayAmount, arYesterdayAmount),
      },
    },
    ap: {
      total_amount: toNumber(apTotalAgg._sum.amount),
      pending_cnt: apPendingCnt,
      pending_amount: apPendingAmount,
      completed_cnt: apCompletedCnt,
      completed_amount: apCompletedAmount,
      day_over_day: {
        amount_diff: apTodayAmount - apYesterdayAmount,
        amount_diff_rate: calculateDiffRate(apTodayAmount, apYesterdayAmount),
      },
    },
    ar_groups: mergeGroupSummary(arGroupTotal, arGroupPending),
    ap_groups: mergeGroupSummary(apGroupTotal, apGroupPending),
  };
}
