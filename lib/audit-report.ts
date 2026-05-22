import { prisma } from "./prisma";

export type AuditTimelineEvent = {
  at: string; // YYYY-MM-DD (KST)
  value: number;
  author: string;
};

export type AuditInspectStatus = "완료" | "진행" | "대기";

export type AuditReportRow = {
  row_key: string;
  biz_group_nm: string | null;
  client_nm: string | null;
  target_desc: string;
  issue_dt: string | null; // YYYY-MM-DD (KST)
  inspect_status: AuditInspectStatus;
  base_amount: number; // 시작일 포함 이전 마지막 조회값
  final_amount: number; // 종료일까지 마지막 조회값
  diff: number; // final - base
  changed: boolean;
  timeline: AuditTimelineEvent[]; // (startCutoff, endCutoff] 내 amount 변경
};

/** 매출·매입 관리 사업그룹 summary(확장 전 집계 행) */
export type AuditReportGroupSummary = {
  biz_group_nm: string;
  row_count: number;
  total_base: number;
  total_final: number;
  total_diff: number;
  changed: boolean;
  done_cnt: number;
  done_amount: number;
  progress_cnt: number;
  progress_amount: number;
  pending_cnt: number;
  pending_amount: number;
};

export type AuditReportOpCell = {
  base_amount: number;
  final_amount: number;
  diff: number;
  changed: boolean;
  timeline: AuditTimelineEvent[];
};

export type AuditReportOpMonthRow = {
  row_key: string;
  target_month: string; // YYYY-MM
  labor_cost: AuditReportOpCell;
  insurance_cost: AuditReportOpCell;
  severance_cost: AuditReportOpCell;
  dept_op_cost: AuditReportOpCell;
  total_cost: AuditReportOpCell;
  changed: boolean;
};

export type AuditReportSection = {
  rows: AuditReportRow[];
  groups: AuditReportGroupSummary[];
  total_base: number;
  total_final: number;
  total_diff: number;
  changed_rows: number;
  total_rows: number;
};

export type AuditReportOpSection = {
  rows: AuditReportOpMonthRow[];
  total_base: number;
  total_final: number;
  total_diff: number;
  changed_rows: number;
  total_rows: number;
};

export type AuditReportResult = {
  date_from: string;
  date_to: string;
  ar: AuditReportSection;
  ap: AuditReportSection;
  op: AuditReportOpSection;
};

const OP_FIELDS = ["labor_cost", "insurance_cost", "severance_cost", "dept_op_cost", "total_cost"] as const;

function normalizeReviewStatus(status: string | null | undefined): AuditInspectStatus {
  if (!status || status.includes("대기")) return "대기";
  if (status.includes("완료")) return "완료";
  if (status.includes("진행")) return "진행";
  return "대기";
}

function groupLabel(biz_group_nm: string | null) {
  return biz_group_nm?.trim() || "미분류";
}

function buildGroupSummaries(rows: AuditReportRow[]): AuditReportGroupSummary[] {
  const groups: AuditReportGroupSummary[] = [];
  for (const row of rows) {
    const label = groupLabel(row.biz_group_nm);
    let g = groups[groups.length - 1];
    if (!g || g.biz_group_nm !== label) {
      g = {
        biz_group_nm: label,
        row_count: 0,
        total_base: 0,
        total_final: 0,
        total_diff: 0,
        changed: false,
        done_cnt: 0,
        done_amount: 0,
        progress_cnt: 0,
        progress_amount: 0,
        pending_cnt: 0,
        pending_amount: 0,
      };
      groups.push(g);
    }
    g.row_count += 1;
    g.total_base += row.base_amount;
    g.total_final += row.final_amount;
    g.total_diff += row.diff;
    if (row.changed) g.changed = true;
    if (row.inspect_status === "완료") {
      g.done_cnt += 1;
      g.done_amount += row.final_amount;
    } else if (row.inspect_status === "진행") {
      g.progress_cnt += 1;
      g.progress_amount += row.final_amount;
    } else {
      g.pending_cnt += 1;
      g.pending_amount += row.final_amount;
    }
  }
  return groups;
}

function toNumber(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "bigint") return Number(value);
  if (value && typeof value === "object" && "toNumber" in value) {
    return (value as { toNumber: () => number }).toNumber();
  }
  const n = Number(String(value ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function parseYmd(s: string): { y: number; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return { y, m: mo, d };
}

/** KST 해당일 23:59:59.999 → UTC Date */
export function kstEndOfDay(ymd: string): Date | null {
  const p = parseYmd(ymd);
  if (!p) return null;
  return new Date(Date.UTC(p.y, p.m - 1, p.d, 14, 59, 59, 999));
}

function toDateKeyUTC(value: Date | null): string {
  if (!value) return "";
  const yyyy = value.getUTCFullYear();
  const mm = String(value.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(value.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function toKstDateKeyFromDetectedAt(value: Date): string {
  const kst = new Date(value.getTime() + 9 * 60 * 60 * 1000);
  const yyyy = kst.getUTCFullYear();
  const mm = String(kst.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(kst.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/** 조회기간에 걸친 연도 목록 (매출/매입 관리와 동일하게 연도 단위 전표 조회) */
function yearsFromRange(dateFrom: string, dateTo: string): number[] {
  const a = parseYmd(dateFrom);
  const b = parseYmd(dateTo);
  if (!a || !b) return [];
  const out: number[] = [];
  for (let y = a.y; y <= b.y; y += 1) out.push(y);
  return out;
}

function yearIssueRange(year: number) {
  return {
    gte: new Date(Date.UTC(year, 0, 1)),
    lt: new Date(Date.UTC(year + 1, 0, 1)),
  };
}

type AmountLog = {
  detected_at: Date;
  before_value: string | null;
  after_value: string | null;
};

function arApItemKey(source_id: string | null, issue_dt: Date | null, target_desc: string) {
  return `${source_id ?? ""}|${toDateKeyUTC(issue_dt)}|${target_desc}`;
}

/** 매출·매입 관리: ar_seq 순 그룹 등장 순, 그룹 내 발행일 오름차순 */
function sortArApLikeManagement<
  T extends { biz_group_nm: string | null; issue_dt: Date | null; seq: number },
>(items: T[]): T[] {
  const groupOrder = new Map<string, number>();
  let order = 0;
  for (const item of [...items].sort((a, b) => a.seq - b.seq)) {
    const g = item.biz_group_nm?.trim() || "미분류";
    if (!groupOrder.has(g)) groupOrder.set(g, order++);
  }
  return [...items].sort((a, b) => {
    const ga = a.biz_group_nm?.trim() || "미분류";
    const gb = b.biz_group_nm?.trim() || "미분류";
    const go = (groupOrder.get(ga) ?? 0) - (groupOrder.get(gb) ?? 0);
    if (go !== 0) return go;
    if (!a.issue_dt && !b.issue_dt) return 0;
    if (!a.issue_dt) return 1;
    if (!b.issue_dt) return -1;
    return a.issue_dt.getTime() - b.issue_dt.getTime();
  });
}

function buildOpCell(
  logsFor: AmountLog[],
  startCutoff: Date,
  endCutoff: Date,
  fallbackCurrent: number,
): AuditReportOpCell {
  const base_amount = snapshotAtCutoff(logsFor, startCutoff, fallbackCurrent);
  const final_amount = snapshotAtCutoff(logsFor, endCutoff, fallbackCurrent);
  const diff = final_amount - base_amount;
  const timeline = logsFor
    .filter((l) => l.detected_at.getTime() > startCutoff.getTime() && l.detected_at.getTime() <= endCutoff.getTime())
    .sort((a, b) => a.detected_at.getTime() - b.detected_at.getTime())
    .map((l) => ({
      at: toKstDateKeyFromDetectedAt(l.detected_at),
      value: toNumber(l.after_value),
      author: "동기화(BAT)",
    })) satisfies AuditTimelineEvent[];
  return { base_amount, final_amount, diff, changed: diff !== 0 || timeline.length > 0, timeline };
}

function snapshotAtCutoff(logs: AmountLog[], cutoff: Date, fallbackCurrent?: number): number {
  const sorted = [...logs].sort((a, b) => a.detected_at.getTime() - b.detected_at.getTime());
  const atOrBefore = sorted.filter((l) => l.detected_at.getTime() <= cutoff.getTime());
  if (atOrBefore.length > 0) return toNumber(atOrBefore[atOrBefore.length - 1]!.after_value);
  const afterCutoff = sorted.filter((l) => l.detected_at.getTime() > cutoff.getTime());
  if (afterCutoff.length > 0) return toNumber(afterCutoff[0]!.before_value);
  return fallbackCurrent ?? 0;
}

async function buildArApSection(
  moduleType: "AR" | "AP",
  dateFrom: string,
  dateTo: string,
  startCutoff: Date,
  endCutoff: Date,
): Promise<AuditReportSection> {
  const years = yearsFromRange(dateFrom, dateTo);
  if (years.length === 0) {
    return { rows: [], groups: [], total_base: 0, total_final: 0, total_diff: 0, changed_rows: 0, total_rows: 0 };
  }

  const yearOr = years.map((y) => ({ issue_dt: yearIssueRange(y) }));

  const [items, amountLogs] = await Promise.all([
    moduleType === "AR"
      ? prisma.ar.findMany({
          where: { is_deleted: "N", OR: yearOr },
          orderBy: { ar_seq: "asc" },
          select: {
            ar_seq: true,
            source_id: true,
            issue_dt: true,
            description: true,
            biz_group_nm: true,
            client_nm: true,
            amount: true,
            claim_status: true,
          },
        })
      : prisma.ap.findMany({
          where: { is_deleted: "N", OR: yearOr },
          orderBy: { ap_seq: "asc" },
          select: {
            ap_seq: true,
            source_id: true,
            issue_dt: true,
            description: true,
            biz_group_nm: true,
            client_nm: true,
            amount: true,
            pay_status: true,
          },
        }),
    prisma.autoChangeLog.findMany({
      where: {
        module_type: moduleType,
        changed_column: "amount",
        detected_at: { lte: endCutoff },
        OR: yearOr,
      },
      orderBy: { detected_at: "asc" },
      select: {
        source_id: true,
        issue_dt: true,
        target_desc: true,
        detected_at: true,
        before_value: true,
        after_value: true,
      },
      take: 60000,
    }),
  ]);

  const logsByKey = new Map<string, AmountLog[]>();
  for (const log of amountLogs) {
    const key = arApItemKey(log.source_id, log.issue_dt, log.target_desc);
    if (!logsByKey.has(key)) logsByKey.set(key, []);
    logsByKey.get(key)!.push({
      detected_at: log.detected_at,
      before_value: log.before_value,
      after_value: log.after_value,
    });
  }

  const sortedItems = sortArApLikeManagement(
    items.map((item) => ({
      ...item,
      seq: moduleType === "AR" ? (item as { ar_seq: number }).ar_seq : (item as { ap_seq: number }).ap_seq,
    })),
  );

  const rows: AuditReportRow[] = [];
  for (const item of sortedItems) {
    const target_desc = item.description;
    const key = arApItemKey(item.source_id, item.issue_dt, target_desc);
    const logsFor = logsByKey.get(key) ?? [];
    const fallbackCurrent = toNumber(item.amount);

    const base_amount = snapshotAtCutoff(logsFor, startCutoff, fallbackCurrent);
    const final_amount = snapshotAtCutoff(logsFor, endCutoff, fallbackCurrent);
    const diff = final_amount - base_amount;

    const timeline = logsFor
      .filter((l) => l.detected_at.getTime() > startCutoff.getTime() && l.detected_at.getTime() <= endCutoff.getTime())
      .sort((a, b) => a.detected_at.getTime() - b.detected_at.getTime())
      .map((l) => ({
        at: toKstDateKeyFromDetectedAt(l.detected_at),
        value: toNumber(l.after_value),
        author: "동기화(BAT)",
      })) satisfies AuditTimelineEvent[];

    const changed = diff !== 0 || timeline.length > 0;
    const inspect_status = normalizeReviewStatus(
      moduleType === "AR"
        ? (item as { claim_status: string | null }).claim_status
        : (item as { pay_status: string | null }).pay_status,
    );

    rows.push({
      row_key: key,
      biz_group_nm: item.biz_group_nm,
      client_nm: item.client_nm,
      target_desc,
      issue_dt: item.issue_dt ? toDateKeyUTC(item.issue_dt) : null,
      inspect_status,
      base_amount,
      final_amount,
      diff,
      changed,
      timeline,
    });
  }

  const groups = buildGroupSummaries(rows);
  const total_base = rows.reduce((s, r) => s + r.base_amount, 0);
  const total_final = rows.reduce((s, r) => s + r.final_amount, 0);
  const total_diff = total_final - total_base;
  const changed_rows = rows.filter((r) => r.changed).length;

  return { rows, groups, total_base, total_final, total_diff, changed_rows, total_rows: rows.length };
}

function opItemKey(targetMonth: string, field: string) {
  return `${targetMonth}|${field}`;
}

async function buildOpSection(
  dateFrom: string,
  dateTo: string,
  startCutoff: Date,
  endCutoff: Date,
): Promise<AuditReportOpSection> {
  const years = yearsFromRange(dateFrom, dateTo);
  if (years.length === 0) {
    return { rows: [], total_base: 0, total_final: 0, total_diff: 0, changed_rows: 0, total_rows: 0 };
  }

  const [opRows, amountLogs] = await Promise.all([
    prisma.operatingCost.findMany({
      where: {
        base_year: { in: years },
      },
      select: {
        target_month: true,
        labor_cost: true,
        insurance_cost: true,
        severance_cost: true,
        dept_op_cost: true,
        total_cost: true,
      },
    }),
    prisma.autoChangeLog.findMany({
      where: {
        module_type: "OP",
        changed_column: { in: [...OP_FIELDS] },
        detected_at: { lte: endCutoff },
      },
      orderBy: { detected_at: "asc" },
      select: {
        target_desc: true,
        changed_column: true,
        detected_at: true,
        before_value: true,
        after_value: true,
      },
      take: 60000,
    }),
  ]);

  const currentByKey = new Map<string, number>();
  for (const row of opRows) {
    for (const field of OP_FIELDS) {
      const key = opItemKey(row.target_month, field);
      currentByKey.set(key, (currentByKey.get(key) ?? 0) + toNumber((row as Record<string, unknown>)[field]));
    }
  }

  const logsByKey = new Map<string, AmountLog[]>();
  for (const log of amountLogs) {
    const key = opItemKey(log.target_desc, log.changed_column);
    if (!logsByKey.has(key)) logsByKey.set(key, []);
    logsByKey.get(key)!.push({
      detected_at: log.detected_at,
      before_value: log.before_value,
      after_value: log.after_value,
    });
  }

  const months = [...new Set(opRows.map((r) => r.target_month))].sort();

  const rows: AuditReportOpMonthRow[] = [];
  for (const ym of months) {
    const cells = {} as Record<(typeof OP_FIELDS)[number], AuditReportOpCell>;
    for (const field of OP_FIELDS) {
      const key = opItemKey(ym, field);
      const logsFor = logsByKey.get(key) ?? [];
      const fallbackCurrent = currentByKey.get(key) ?? 0;
      cells[field] = buildOpCell(logsFor, startCutoff, endCutoff, fallbackCurrent);
    }
    const changed = OP_FIELDS.some((f) => cells[f].changed);
    rows.push({
      row_key: ym,
      target_month: ym,
      labor_cost: cells.labor_cost,
      insurance_cost: cells.insurance_cost,
      severance_cost: cells.severance_cost,
      dept_op_cost: cells.dept_op_cost,
      total_cost: cells.total_cost,
      changed,
    });
  }

  const total_base = rows.reduce((s, r) => s + r.total_cost.base_amount, 0);
  const total_final = rows.reduce((s, r) => s + r.total_cost.final_amount, 0);
  const total_diff = total_final - total_base;
  const changed_rows = rows.filter((r) => r.changed).length;

  return { rows, total_base, total_final, total_diff, changed_rows, total_rows: rows.length };
}

export async function buildAuditReport(dateFrom: string, dateTo: string): Promise<AuditReportResult | null> {
  const startCutoff = kstEndOfDay(dateFrom);
  const endCutoff = kstEndOfDay(dateTo);
  if (!startCutoff || !endCutoff) return null;
  if (startCutoff.getTime() > endCutoff.getTime()) return null;

  const [ar, ap, op] = await Promise.all([
    buildArApSection("AR", dateFrom, dateTo, startCutoff, endCutoff),
    buildArApSection("AP", dateFrom, dateTo, startCutoff, endCutoff),
    buildOpSection(dateFrom, dateTo, startCutoff, endCutoff),
  ]);

  return { date_from: dateFrom, date_to: dateTo, ar, ap, op };
}

