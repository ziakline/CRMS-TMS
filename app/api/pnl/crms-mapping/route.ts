import { Prisma } from "@prisma/client";
import { getServerSession } from "next-auth";
import { authOptions } from "../../../../lib/auth-options";
import { isBudgetOrQuarter } from "../../../../lib/pnl-crms-shared";
import { loadActiveFeeOptions } from "../../../../lib/pnl-fee-options";
import { PNL_ACTUAL_MONTH_KEYS, PNL_GOAL_MONTH_KEYS, prismaRowToResolveInput, resolvePnlRowsMonths } from "../../../../lib/pnl-resolve-months";
import { prisma } from "../../../../lib/prisma";

function toNumber(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function parseMonthFromCellKey(cellKey: string | null | undefined): number | null {
  const m = String(cellKey ?? "").match(/[at]_m(0[1-9]|1[0-2])/i);
  if (!m) return null;
  return Number(m[1]);
}

function parseTargetMonth(params: URLSearchParams): number | null {
  const direct = toNumber(params.get("target_month"));
  if (direct >= 1 && direct <= 12) return direct;
  return parseMonthFromCellKey(params.get("cell_key"));
}

type MapRow = { pnl_seq: number; target_month: number; crms_module: string; source_seq: number };

type CrmsLine = {
  source_seq: number;
  biz_group_nm: string | null;
  issue_dt: string | null;
  client_nm: string | null;
  item_label: string;
  amount: number;
  source_id: string | null;
};

function fmtIssueCell(iso: string | null) {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  if (!y || !m || !d) return iso;
  return `${y}. ${m}. ${d}.`;
}

function monthFromDate(value: Date | null): number | null {
  if (!value) return null;
  return value.getUTCMonth() + 1;
}

function normText(v: string | null | undefined): string {
  return String(v ?? "")
    .replace(/\s+/g, "")
    .replace(/[·\-_.,()]/g, "")
    .toLowerCase();
}

function stripMonth(v: string | null | undefined): string {
  return normText(String(v ?? "").replace(/(?:^|\s)(1[0-2]|[1-9])월/g, " "));
}

function mapArRow(r: {
  ar_seq: number;
  biz_group_nm: string | null;
  issue_dt: Date | null;
  client_nm: string | null;
  item_type: string | null;
  description: string;
  amount: unknown;
  source_id: string | null;
}): CrmsLine {
  return {
    source_seq: r.ar_seq,
    biz_group_nm: r.biz_group_nm,
    issue_dt: r.issue_dt ? r.issue_dt.toISOString().slice(0, 10) : null,
    client_nm: r.client_nm,
    item_label: [r.item_type, r.description].filter(Boolean).join(" · ") || r.description,
    amount: Number(r.amount),
    source_id: r.source_id,
  };
}

function mapApRow(r: {
  ap_seq: number;
  biz_group_nm: string | null;
  issue_dt: Date | null;
  client_nm: string | null;
  item_type: string | null;
  description: string;
  amount: unknown;
  source_id: string | null;
}): CrmsLine {
  return {
    source_seq: r.ap_seq,
    biz_group_nm: r.biz_group_nm,
    issue_dt: r.issue_dt ? r.issue_dt.toISOString().slice(0, 10) : null,
    client_nm: r.client_nm,
    item_label: [r.item_type, r.description].filter(Boolean).join(" · ") || r.description,
    amount: Number(r.amount),
    source_id: r.source_id,
  };
}

type OpRow = {
  op_seq: number;
  project_cd: string;
  target_month: string; // YYYY-MM
  labor_cost: unknown;
  insurance_cost: unknown;
  severance_cost: unknown;
  dept_op_cost: unknown;
  total_cost: unknown;
};

const OP_CATEGORIES: { mod: string; field: keyof OpRow; label: string }[] = [
  { mod: "OP_LC", field: "labor_cost",     label: "인건비"    },
  { mod: "OP_IC", field: "insurance_cost", label: "4대보험"   },
  { mod: "OP_SC", field: "severance_cost", label: "퇴직연금"  },
  { mod: "OP_DC", field: "dept_op_cost",   label: "부서운영비" },
];

/** OperatingCost 1행을 카테고리별 CrmsLine 배열로 확장 (금액 0인 항목 제외) */
function expandOpRows(r: OpRow): CrmsLine[] {
  const isoDt = `${r.target_month}-01`;
  return OP_CATEGORIES.flatMap(({ mod, field, label }) => {
    const amt = Number(r[field]);
    if (!amt) return [];
    return [{
      source_seq: r.op_seq,
      biz_group_nm: r.project_cd,
      issue_dt: isoDt,
      client_nm: null,
      item_label: label,
      amount: amt,
      source_id: mod, // 카테고리 식별자 (OP_LC / OP_IC / OP_SC / OP_DC)
    }];
  });
}

async function findMappings(pnlSeq: number, targetMonth: number): Promise<MapRow[]> {
  try {
    const rows = await prisma.$queryRaw<MapRow[]>(Prisma.sql`
      SELECT pnl_seq, target_month, crms_module, source_seq
      FROM "TB_PNL_CRMS_MAPPING"
      WHERE pnl_seq = ${pnlSeq}
        AND target_month = ${targetMonth}
      ORDER BY map_seq ASC
    `);
    return rows;
  } catch {
    return [];
  }
}

async function findMappingsByMonths(pnlSeq: number, months: number[]): Promise<MapRow[]> {
  const normalized = [...new Set(months.filter((m) => m >= 1 && m <= 12))];
  if (!normalized.length) return [];
  try {
    const rows = await prisma.$queryRaw<MapRow[]>(Prisma.sql`
      SELECT pnl_seq, target_month, crms_module, source_seq
      FROM "TB_PNL_CRMS_MAPPING"
      WHERE pnl_seq = ${pnlSeq}
        AND target_month IN (${Prisma.join(normalized)})
      ORDER BY target_month ASC, map_seq ASC
    `);
    return rows;
  } catch {
    return [];
  }
}

async function persistMapping(
  pnlSeq: number,
  targetMonth: number,
  selection: Array<{ crms_module: string; source_seq: number }> | null,
) {
  await prisma.pnlCrmsMapping.deleteMany({
    where: { pnl_seq: pnlSeq, target_month: targetMonth },
  });
  if (!selection?.length) return;
  const seen = new Set<string>();
  const data: Array<{ pnl_seq: number; target_month: number; crms_module: string; source_seq: number }> = [];
  for (const sel of selection) {
    const k = `${sel.crms_module}:${sel.source_seq}`;
    if (seen.has(k)) continue;
    seen.add(k);
    data.push({
      pnl_seq: pnlSeq,
      target_month: targetMonth,
      crms_module: sel.crms_module,
      source_seq: sel.source_seq,
    });
  }
  if (!data.length) return;
  await prisma.pnlCrmsMapping.createMany({ data, skipDuplicates: true });
}

type CrmsCrossRow = {
  col_detail: string;
  col_category: string;
  col_code: string;
  col_client: string;
  col_item: string;
  amount: number;
};

function crmsCrossRowFromAr(r: {
  biz_group_nm: string | null;
  issue_dt: Date | null;
  client_nm: string | null;
  item_type: string | null;
  description: string;
  amount: unknown;
  source_id: string | null;
}): CrmsCrossRow {
  return {
    col_detail: r.biz_group_nm ?? "—",
    col_category: fmtIssueCell(r.issue_dt ? r.issue_dt.toISOString().slice(0, 10) : null),
    col_code: r.source_id?.trim() || "—",
    col_client: r.client_nm ?? "—",
    col_item: [r.item_type, r.description].filter(Boolean).join(" · ") || r.description || "—",
    amount: Number(r.amount),
  };
}

function crmsCrossRowFromAp(r: {
  biz_group_nm: string | null;
  issue_dt: Date | null;
  client_nm: string | null;
  item_type: string | null;
  description: string;
  amount: unknown;
  source_id: string | null;
}): CrmsCrossRow {
  return {
    col_detail: r.biz_group_nm ?? "—",
    col_category: fmtIssueCell(r.issue_dt ? r.issue_dt.toISOString().slice(0, 10) : null),
    col_code: r.source_id?.trim() || "—",
    col_client: r.client_nm ?? "—",
    col_item: [r.item_type, r.description].filter(Boolean).join(" · ") || r.description || "—",
    amount: Number(r.amount),
  };
}

const OP_MOD_LABEL: Record<string, string> = {
  OP: "운영비합계", OP_LC: "인건비", OP_IC: "4대보험", OP_SC: "퇴직연금", OP_DC: "부서운영비",
};
const OP_MOD_FIELD: Record<string, keyof OpRow> = {
  OP: "total_cost", OP_LC: "labor_cost", OP_IC: "insurance_cost", OP_SC: "severance_cost", OP_DC: "dept_op_cost",
};

function crmsCrossRowFromOp(r: OpRow, crmsModule: string): CrmsCrossRow {
  const field = OP_MOD_FIELD[crmsModule] ?? "total_cost";
  const label = OP_MOD_LABEL[crmsModule] ?? "운영비";
  return {
    col_detail: r.project_cd,
    col_category: r.target_month,
    col_code: crmsModule,
    col_client: "—",
    col_item: label,
    amount: Number(r[field]),
  };
}

function mergeCrmsCrossRows(rows: CrmsCrossRow[]): CrmsCrossRow {
  if (rows.length === 0) {
    return { col_detail: "—", col_category: "—", col_code: "—", col_client: "—", col_item: "—", amount: 0 };
  }
  if (rows.length === 1) return rows[0]!;
  const sum = rows.reduce((a, r) => a + r.amount, 0);
  return {
    col_detail: `(${rows.length}건)`,
    col_category: "—",
    col_code: "—",
    col_client: "—",
    col_item: "CRMS 합계",
    amount: sum,
  };
}

async function resolveCrmsForCross(pnlSeq: number, targetMonth: number) {
  const maps = await findMappings(pnlSeq, targetMonth);
  if (maps.length === 0) return { mappings: [], mapping: null, crmsRow: null };
  const mappings = maps.map((m) => ({ crms_module: m.crms_module, source_seq: m.source_seq }));
  const mapping = mappings[0] ?? null;
  const arIds = maps.filter((m) => m.crms_module === "AR").map((m) => m.source_seq);
  const apIds = maps.filter((m) => m.crms_module === "AP").map((m) => m.source_seq);
  const [arList, apList] = await Promise.all([
    arIds.length
      ? prisma.ar.findMany({
          where: { ar_seq: { in: arIds }, is_deleted: "N" },
          select: { biz_group_nm: true, issue_dt: true, client_nm: true, item_type: true, description: true, amount: true, source_id: true, ar_seq: true },
        })
      : [],
    apIds.length
      ? prisma.ap.findMany({
          where: { ap_seq: { in: apIds }, is_deleted: "N" },
          select: { biz_group_nm: true, issue_dt: true, client_nm: true, item_type: true, description: true, amount: true, source_id: true, ap_seq: true },
        })
      : [],
  ]);
  const arBySeq = new Map(arList.map((r) => [r.ar_seq, r]));
  const apBySeq = new Map(apList.map((r) => [r.ap_seq, r]));
  const crossParts: CrmsCrossRow[] = [];
  for (const m of maps) {
    if (m.crms_module === "AR") {
      const r = arBySeq.get(m.source_seq);
      if (r) crossParts.push(crmsCrossRowFromAr(r));
    } else {
      const r = apBySeq.get(m.source_seq);
      if (r) crossParts.push(crmsCrossRowFromAp(r));
    }
  }
  if (crossParts.length === 0) return { mappings, mapping, crmsRow: null };
  return { mappings, mapping, crmsRow: mergeCrmsCrossRows(crossParts) };
}

async function buildSheetGridCrms(baseYear: number, pnlType: string) {
  type OutMonth = CrmsCrossRow & {
    mapping?: { crms_module: string; source_seq: number } | null;
    mappings?: Array<{ crms_module: string; source_seq: number }>;
  };
  const masters = await prisma.pnlMaster.findMany({
    where: { base_year: baseYear, pnl_type: pnlType },
    select: { pnl_seq: true },
  });
  const ids = masters.map((m) => m.pnl_seq);
  if (ids.length === 0) {
    return {} as Record<
      string,
      { hasAny: boolean; months: Record<string, OutMonth | null>; yearSum: number }
    >;
  }
  const mapRows = await prisma.$queryRaw<MapRow[]>(Prisma.sql`
    SELECT pnl_seq, target_month, crms_module, source_seq
    FROM "TB_PNL_CRMS_MAPPING"
    WHERE pnl_seq IN (${Prisma.join(ids)})
    ORDER BY pnl_seq ASC, target_month ASC, map_seq ASC
  `);
  const arIds = new Set<number>();
  const apIds = new Set<number>();
  const opIds = new Set<number>();
  for (const row of mapRows) {
    if (row.crms_module === "AR") arIds.add(row.source_seq);
    else if (row.crms_module === "AP") apIds.add(row.source_seq);
    else if (OP_MOD_SET.has(row.crms_module)) opIds.add(row.source_seq);
  }
  const [arList, apList, opList] = await Promise.all([
    arIds.size
      ? prisma.ar.findMany({
          where: { ar_seq: { in: [...arIds] }, is_deleted: "N" },
          select: { ar_seq: true, biz_group_nm: true, issue_dt: true, client_nm: true, item_type: true, description: true, amount: true, source_id: true },
        })
      : [],
    apIds.size
      ? prisma.ap.findMany({
          where: { ap_seq: { in: [...apIds] }, is_deleted: "N" },
          select: { ap_seq: true, biz_group_nm: true, issue_dt: true, client_nm: true, item_type: true, description: true, amount: true, source_id: true },
        })
      : [],
    opIds.size
      ? prisma.operatingCost.findMany({
          where: { op_seq: { in: [...opIds] } },
          select: { op_seq: true, project_cd: true, target_month: true, labor_cost: true, insurance_cost: true, severance_cost: true, dept_op_cost: true, total_cost: true },
        })
      : [],
  ]);
  const arBySeq = new Map(arList.map((r) => [r.ar_seq, r]));
  const apBySeq = new Map(apList.map((r) => [r.ap_seq, r]));
  const opBySeq = new Map((opList as OpRow[]).map((r) => [r.op_seq, r]));

  const byPnl: Record<string, { hasAny: boolean; months: Record<string, OutMonth | null>; yearSum: number }> = {};
  for (const id of ids) {
    byPnl[String(id)] = { hasAny: false, months: {}, yearSum: 0 };
  }

  type GroupKey = `${number}:${number}`;
  const monthGroups = new Map<GroupKey, MapRow[]>();
  for (const m of mapRows) {
    const gk = `${m.pnl_seq}:${m.target_month}` as GroupKey;
    const arr = monthGroups.get(gk);
    if (arr) arr.push(m);
    else monthGroups.set(gk, [m]);
  }

  for (const [gk, mm] of monthGroups) {
    const [pnlStr, moStr] = gk.split(":");
    const bucket = byPnl[pnlStr];
    if (!bucket) continue;
    const crossParts: CrmsCrossRow[] = [];
    for (const m of mm) {
      const mod = m.crms_module.toUpperCase();
      if (mod === "AR") {
        const r = arBySeq.get(m.source_seq);
        if (r) crossParts.push(crmsCrossRowFromAr(r));
      } else if (mod === "AP") {
        const r = apBySeq.get(m.source_seq);
        if (r) crossParts.push(crmsCrossRowFromAp(r));
      } else if (OP_MOD_SET.has(mod)) {
        const r = opBySeq.get(m.source_seq);
        if (r) crossParts.push(crmsCrossRowFromOp(r, mod));
      }
    }
    if (crossParts.length === 0) continue;
    const merged = mergeCrmsCrossRows(crossParts);
    const mappings = mm.map((x) => ({ crms_module: x.crms_module, source_seq: x.source_seq }));
    bucket.months[moStr] = {
      ...merged,
      mapping: mappings[0] ?? null,
      mappings,
    };
    bucket.hasAny = true;
  }
  for (const id of ids) {
    const key = String(id);
    const bucket = byPnl[key];
    if (!bucket?.hasAny) continue;
    let sum = 0;
    for (let mo = 1; mo <= 12; mo += 1) {
      const cell = bucket.months[String(mo)];
      if (cell) sum += cell.amount;
    }
    bucket.yearSum = sum;
  }
  return byPnl;
}

type CrmsPick = { crms_module: string; source_seq: number };

type CrmsLineDetail = CrmsPick & {
  biz_group_nm: string | null;
  issue_dt: Date | null;
  client_nm: string | null;
  lineText: string;
};

async function loadSelectedCrmsDetail(selection: CrmsPick[]): Promise<CrmsLineDetail[]> {
  const arIds = selection.filter((s) => s.crms_module === "AR").map((s) => s.source_seq);
  const apIds = selection.filter((s) => s.crms_module === "AP").map((s) => s.source_seq);
  const [arList, apList] = await Promise.all([
    arIds.length
      ? prisma.ar.findMany({
          where: { ar_seq: { in: arIds }, is_deleted: "N" },
          select: { ar_seq: true, biz_group_nm: true, issue_dt: true, client_nm: true, item_type: true, description: true },
        })
      : [],
    apIds.length
      ? prisma.ap.findMany({
          where: { ap_seq: { in: apIds }, is_deleted: "N" },
          select: { ap_seq: true, biz_group_nm: true, issue_dt: true, client_nm: true, item_type: true, description: true },
        })
      : [],
  ]);
  const out: CrmsLineDetail[] = [];
  for (const r of arList) {
    out.push({
      crms_module: "AR",
      source_seq: r.ar_seq,
      biz_group_nm: r.biz_group_nm,
      issue_dt: r.issue_dt,
      client_nm: r.client_nm,
      lineText: `${r.item_type ?? ""} ${r.description ?? ""}`.trim(),
    });
  }
  for (const r of apList) {
    out.push({
      crms_module: "AP",
      source_seq: r.ap_seq,
      biz_group_nm: r.biz_group_nm,
      issue_dt: r.issue_dt,
      client_nm: r.client_nm,
      lineText: `${r.item_type ?? ""} ${r.description ?? ""}`.trim(),
    });
  }
  return out;
}

const OP_MOD_SET = new Set(["OP", "OP_LC", "OP_IC", "OP_SC", "OP_DC"]);

/** OP_COST 전용 1~12월 자동 매핑: 선택한 (project_cd, crms_module) 조합으로 같은 연도 전체 월 매핑 */
async function autoYearFromSelectionOp(pnlSeq: number, selection: CrmsPick[]) {
  const row = await prisma.pnlMaster.findUnique({
    where: { pnl_seq: pnlSeq },
    select: { base_year: true, row_label: true },
  });
  if (!row) throw new Error("손익 행을 찾을 수 없습니다.");

  // 선택된 OP 항목에서 고유한 (op_seq, crms_module) 쌍 추출
  const opPicks = selection.filter((s) => OP_MOD_SET.has(s.crms_module));
  if (!opPicks.length) throw new Error("운영비 항목을 선택해 주세요.");

  // 선택된 op_seq들로 project_cd 조회
  const opSeqIds = [...new Set(opPicks.map((s) => s.source_seq))];
  const opRows = await prisma.operatingCost.findMany({
    where: { op_seq: { in: opSeqIds } },
    select: { op_seq: true, project_cd: true, target_month: true },
  });
  const opBySeq = new Map(opRows.map((r) => [r.op_seq, r]));

  // (project_cd, crms_module) 조합별로 그룹화
  type OpKey = { project_cd: string; crms_module: string };
  const groups = new Map<string, OpKey>();
  for (const pick of opPicks) {
    const meta = opBySeq.get(pick.source_seq);
    if (!meta) continue;
    const key = `${meta.project_cd}:${pick.crms_module}`;
    if (!groups.has(key)) groups.set(key, { project_cd: meta.project_cd, crms_module: pick.crms_module });
  }
  if (!groups.size) throw new Error("선택한 운영비 항목의 프로젝트를 찾을 수 없습니다.");

  // 해당 연도 전체 운영비 조회
  const yearStr = String(row.base_year);
  const allOpRows = await prisma.operatingCost.findMany({
    where: {
      base_year: row.base_year,
      project_cd: { in: [...new Set([...groups.values()].map((g) => g.project_cd))] },
    },
    select: { op_seq: true, project_cd: true, target_month: true },
  });
  // project_cd + 월 → op_seq 맵
  const opMonthMap = new Map<string, number>(); // "${project_cd}:${month}" → op_seq
  for (const r of allOpRows) {
    const m = Number(r.target_month.slice(5, 7));
    if (m >= 1 && m <= 12 && r.target_month.startsWith(yearStr)) {
      opMonthMap.set(`${r.project_cd}:${m}`, r.op_seq);
    }
  }

  let saved = 0;
  let skipped = 0;
  const details: Array<{ month: number; reason: string }> = [];
  const monthList = Array.from({ length: 12 }, (_, idx) => idx + 1);
  const existingByMonth = new Set(
    (await findMappingsByMonths(pnlSeq, monthList)).map((m) => m.target_month),
  );

  for (let month = 1; month <= 12; month++) {
    // 이미 매핑된 달은 스킵
    const exists = existingByMonth.has(month);
    if (exists) {
      skipped++;
      details.push({ month, reason: "이미 매핑 존재" });
      continue;
    }

    const picks: CrmsPick[] = [];
    for (const { project_cd, crms_module } of groups.values()) {
      const opSeq = opMonthMap.get(`${project_cd}:${month}`);
      if (opSeq != null) picks.push({ crms_module, source_seq: opSeq });
    }

    if (!picks.length) {
      skipped++;
      details.push({ month, reason: "해당 월 운영비 없음" });
      continue;
    }

    await persistMapping(pnlSeq, month, dedupeCrmsPicks(picks));
    saved++;
  }

  // 저장된 전체 매핑 반환
  const maps = (await findMappingsByMonths(pnlSeq, monthList)).map((p) => ({
    target_month: p.target_month,
    crms_module: p.crms_module,
    source_seq: p.source_seq,
  }));
  return { saved, skipped, details, scope_biz_group: [...groups.values()][0]?.project_cd ?? "", mappings: maps };
}

function dedupeCrmsPicks(list: CrmsPick[]): CrmsPick[] {
  const seen = new Set<string>();
  const out: CrmsPick[] = [];
  for (const s of list) {
    const k = `${s.crms_module}:${s.source_seq}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  return out;
}

function matchesAutoCandidate(
  lineText: string,
  clientNm: string | null,
  bizGroupNm: string | null,
  scopeBizGroup: string,
  baseClient: string,
  baseStem: string,
): boolean {
  if (isBudgetOrQuarter(lineText)) return false;
  if (normText(bizGroupNm) !== scopeBizGroup) return false;
  if (baseClient && normText(clientNm) !== baseClient) return false;
  const rowStem = stripMonth(lineText);
  return !baseStem || !rowStem || rowStem === baseStem;
}

/** 선택한 CRMS 사업그룹 안에서만 1~12월 자동 매핑 (예산/분기 전표 제외) */
async function autoYearFromSelection(pnlSeq: number, selection: CrmsPick[]) {
  // OP_COST 전용 경로
  if (selection.every((s) => OP_MOD_SET.has(s.crms_module))) {
    return autoYearFromSelectionOp(pnlSeq, selection);
  }

  const row = await prisma.pnlMaster.findUnique({
    where: { pnl_seq: pnlSeq },
    select: { base_year: true, row_label: true },
  });
  if (!row) throw new Error("손익 행을 찾을 수 없습니다.");
  if (isBudgetOrQuarter(row.row_label)) throw new Error("예산/분기 항목은 자동 매핑 제외입니다.");

  const selected = await loadSelectedCrmsDetail(selection);
  if (selected.length === 0) throw new Error("선택한 CRMS 전표를 찾을 수 없습니다.");

  const nonBudget = selected.filter((s) => !isBudgetOrQuarter(s.lineText));
  if (nonBudget.length === 0) {
    throw new Error("예산/분기(1Q~4Q) 전표는 자동 매핑에서 제외됩니다. 운영 전표를 선택해 주세요.");
  }

  const scopeSet = new Set(nonBudget.map((s) => normText(s.biz_group_nm)).filter(Boolean));
  if (scopeSet.size === 0) {
    throw new Error("선택 전표에 사업그룹이 없습니다. 동일 사업그룹 전표를 선택해 주세요.");
  }
  if (scopeSet.size > 1) {
    throw new Error("선택 전표는 하나의 사업그룹(예: 대구BR 유지운영) 안에서만 선택해 주세요.");
  }
  const scopeBizGroup = [...scopeSet][0]!;

  const modules = new Set(nonBudget.map((s) => s.crms_module));
  if (modules.size > 1) throw new Error("매출·매입 전표를 함께 선택할 수 없습니다.");
  const crmsModule = [...modules][0]!;

  const base = nonBudget[0]!;
  const baseClient = normText(base.client_nm);
  const baseStem = stripMonth(base.lineText);

  const selectedByMonth = new Map<number, CrmsPick[]>();
  for (const s of nonBudget) {
    const mo = monthFromDate(s.issue_dt);
    if (!mo) continue;
    const prev = selectedByMonth.get(mo) ?? [];
    prev.push({ crms_module: s.crms_module, source_seq: s.source_seq });
    selectedByMonth.set(mo, prev);
  }

  const issueDtRange = {
    gte: new Date(Date.UTC(row.base_year, 0, 1)),
    lt: new Date(Date.UTC(row.base_year + 1, 0, 1)),
  };

  const yearRows =
    crmsModule === "AR"
      ? await prisma.ar.findMany({
          where: { is_deleted: "N", issue_dt: issueDtRange },
          orderBy: { ar_seq: "asc" },
          select: {
            ar_seq: true,
            biz_group_nm: true,
            client_nm: true,
            item_type: true,
            description: true,
            issue_dt: true,
          },
        })
      : await prisma.ap.findMany({
          where: { is_deleted: "N", issue_dt: issueDtRange },
          orderBy: { ap_seq: "asc" },
          select: {
            ap_seq: true,
            biz_group_nm: true,
            client_nm: true,
            item_type: true,
            description: true,
            issue_dt: true,
          },
        });

  const pool = yearRows.filter((r) => {
    const txt = `${r.item_type ?? ""} ${r.description ?? ""}`;
    return matchesAutoCandidate(txt, r.client_nm, r.biz_group_nm, scopeBizGroup, baseClient, baseStem);
  });

  let saved = 0;
  let skipped = 0;
  const details: Array<{ month: number; reason: string }> = [];
  const monthList = Array.from({ length: 12 }, (_, idx) => idx + 1);
  const existingByMonth = new Set(
    (await findMappingsByMonths(pnlSeq, monthList)).map((m) => m.target_month),
  );

  for (let month = 1; month <= 12; month += 1) {
    const userPicks = selectedByMonth.get(month);
    if (userPicks?.length) {
      await persistMapping(pnlSeq, month, dedupeCrmsPicks(userPicks));
      saved += 1;
      continue;
    }

    const exists = existingByMonth.has(month);
    if (exists) {
      skipped += 1;
      details.push({ month, reason: "이미 매핑 존재" });
      continue;
    }

    const candidates =
      crmsModule === "AR"
        ? pool.filter((r) => {
            const ar = r as { ar_seq: number; issue_dt: Date | null };
            return monthFromDate(ar.issue_dt) === month;
          })
        : pool.filter((r) => {
            const ap = r as { ap_seq: number; issue_dt: Date | null };
            return monthFromDate(ap.issue_dt) === month;
          });

    if (candidates.length !== 1) {
      skipped += 1;
      details.push({ month, reason: candidates.length === 0 ? "후보 없음" : "후보 다수" });
      continue;
    }

    const one = candidates[0] as { ar_seq?: number; ap_seq?: number };
    const sourceSeq = crmsModule === "AR" ? one.ar_seq! : one.ap_seq!;
    await persistMapping(pnlSeq, month, [{ crms_module: crmsModule, source_seq: sourceSeq }]);
    saved += 1;
  }

  const maps = (await findMappingsByMonths(pnlSeq, monthList)).map((p) => ({
    target_month: p.target_month,
    crms_module: p.crms_module,
    source_seq: p.source_seq,
  }));
  return { saved, skipped, details, scope_biz_group: scopeBizGroup, mappings: maps };
}

async function autoMapFromJanuary(pnlSeq: number, fromMonth: number) {
  const row = await prisma.pnlMaster.findUnique({
    where: { pnl_seq: pnlSeq },
    select: { base_year: true, biz_group: true, client_name: true, row_label: true },
  });
  if (!row) throw new Error("손익 행을 찾을 수 없습니다.");
  if (fromMonth !== 1) throw new Error("자동 매핑은 1월 셀에서만 실행할 수 있습니다.");
  const janMaps = await findMappings(pnlSeq, 1);
  const janMap = janMaps[0];
  if (!janMap) throw new Error("1월 매핑이 먼저 필요합니다.");
  if (isBudgetOrQuarter(row.row_label)) throw new Error("예산/분기 항목은 자동 매핑 제외입니다.");

  const issueDtRange = {
    gte: new Date(Date.UTC(row.base_year, 0, 1)),
    lt: new Date(Date.UTC(row.base_year + 1, 0, 1)),
  };
  let baseBizGroup = "";
  let baseClient = "";
  let baseStem = "";
  if (janMap.crms_module === "AR") {
    const base = await prisma.ar.findFirst({
      where: { ar_seq: janMap.source_seq, is_deleted: "N" },
      select: { biz_group_nm: true, client_nm: true, item_type: true, description: true },
    });
    if (!base) throw new Error("1월 기준 CRMS 원본 전표를 찾을 수 없습니다.");
    baseBizGroup = normText(base.biz_group_nm);
    baseClient = normText(base.client_nm);
    baseStem = stripMonth(`${base.item_type ?? ""} ${base.description ?? ""}`);
  } else {
    const base = await prisma.ap.findFirst({
      where: { ap_seq: janMap.source_seq, is_deleted: "N" },
      select: { biz_group_nm: true, client_nm: true, item_type: true, description: true },
    });
    if (!base) throw new Error("1월 기준 CRMS 원본 전표를 찾을 수 없습니다.");
    baseBizGroup = normText(base.biz_group_nm);
    baseClient = normText(base.client_nm);
    baseStem = stripMonth(`${base.item_type ?? ""} ${base.description ?? ""}`);
  }
  let saved = 0;
  let skipped = 0;
  const details: Array<{ month: number; reason: string }> = [];
  const existingByMonth = new Set(
    (await findMappingsByMonths(pnlSeq, Array.from({ length: 11 }, (_, idx) => idx + 2))).map(
      (m) => m.target_month,
    ),
  );

  const arRows =
    janMap.crms_module === "AR"
      ? await prisma.ar.findMany({
          where: { is_deleted: "N", issue_dt: issueDtRange },
          orderBy: { ar_seq: "asc" },
          select: { ar_seq: true, biz_group_nm: true, client_nm: true, item_type: true, description: true, issue_dt: true },
        })
      : [];
  const apRows =
    janMap.crms_module === "AP"
      ? await prisma.ap.findMany({
          where: { is_deleted: "N", issue_dt: issueDtRange },
          orderBy: { ap_seq: "asc" },
          select: { ap_seq: true, biz_group_nm: true, client_nm: true, item_type: true, description: true, issue_dt: true },
        })
      : [];

  for (let month = 2; month <= 12; month += 1) {
    const exists = existingByMonth.has(month);
    if (exists) {
      skipped += 1;
      details.push({ month, reason: "이미 매핑 존재" });
      continue;
    }
    const candidates =
      janMap.crms_module === "AR"
        ? arRows.filter((r) => {
            const txt = `${r.item_type ?? ""} ${r.description ?? ""}`;
            if (isBudgetOrQuarter(txt)) return false;
            if (monthFromDate(r.issue_dt) !== month) return false;
            if (normText(r.biz_group_nm) !== baseBizGroup) return false;
            if (baseClient && normText(r.client_nm) !== baseClient) return false;
            const rowStem = stripMonth(txt);
            return !baseStem || !rowStem || rowStem === baseStem;
          })
        : apRows.filter((r) => {
            const txt = `${r.item_type ?? ""} ${r.description ?? ""}`;
            if (isBudgetOrQuarter(txt)) return false;
            if (monthFromDate(r.issue_dt) !== month) return false;
            if (normText(r.biz_group_nm) !== baseBizGroup) return false;
            if (baseClient && normText(r.client_nm) !== baseClient) return false;
            const rowStem = stripMonth(txt);
            return !baseStem || !rowStem || rowStem === baseStem;
          });
    if (candidates.length !== 1) {
      skipped += 1;
      details.push({ month, reason: candidates.length === 0 ? "후보 없음" : "후보 다수" });
      continue;
    }
    const one = candidates[0]!;
    const sourceSeq = janMap.crms_module === "AR" ? (one as { ar_seq: number }).ar_seq : (one as { ap_seq: number }).ap_seq;
    await persistMapping(pnlSeq, month, [{ crms_module: janMap.crms_module, source_seq: sourceSeq }]);
    saved += 1;
  }
  return { saved, skipped, details };
}

async function findMappingsForYear(baseYear: number, pnlType: string): Promise<MapRow[]> {
  try {
    return await prisma.$queryRaw<MapRow[]>(Prisma.sql`
      SELECT m.pnl_seq, m.target_month, m.crms_module, m.source_seq
      FROM "TB_PNL_CRMS_MAPPING" m
      INNER JOIN "TB_PNL_MASTER" p ON p.pnl_seq = m.pnl_seq
      WHERE p.base_year = ${baseYear}
        AND p.pnl_type = ${pnlType}
      ORDER BY m.pnl_seq ASC, m.target_month ASC, m.map_seq ASC
    `);
  } catch {
    return [];
  }
}

async function buildBulkPayload(baseYear: number, pnlType: string) {
  const issueDtRange = {
    gte: new Date(Date.UTC(baseYear, 0, 1)),
    lt: new Date(Date.UTC(baseYear + 1, 0, 1)),
  };
  const monthSelect = Object.fromEntries(
    [...PNL_GOAL_MONTH_KEYS, ...PNL_ACTUAL_MONTH_KEYS].map((k) => [k, true]),
  ) as Record<string, true>;

  const [pnlRows, arRows, apRows, opCostRows, mapRows, feeOptions] = await Promise.all([
    prisma.pnlMaster.findMany({
      where: { base_year: baseYear, pnl_type: pnlType },
      orderBy: { sort_order: "asc" },
      select: {
        pnl_seq: true,
        base_year: true,
        pnl_type: true,
        row_type: true,
        sort_order: true,
        row_label: true,
        row_code: true,
        category1: true,
        category2: true,
        category3: true,
        biz_detail: true,
        biz_group: true,
        client_name: true,
        calc_mode: true,
        formula_targets: true,
        ref_qty_row_code: true,
        ref_unit_price_cd: true,
        promo_apply_actual: true,
        vat_included_price: true,
        actual_explicit_months: true,
        ...monthSelect,
      },
    }),
    pnlType !== "OP_COST"
      ? prisma.ar.findMany({
          where: { is_deleted: "N", issue_dt: issueDtRange },
          orderBy: { ar_seq: "asc" },
          take: 400,
          select: { ar_seq: true, biz_group_nm: true, issue_dt: true, client_nm: true, item_type: true, description: true, amount: true, source_id: true },
        })
      : [],
    pnlType !== "OP_COST"
      ? prisma.ap.findMany({
          where: { is_deleted: "N", issue_dt: issueDtRange },
          orderBy: { ap_seq: "asc" },
          take: 400,
          select: { ap_seq: true, biz_group_nm: true, issue_dt: true, client_nm: true, item_type: true, description: true, amount: true, source_id: true },
        })
      : [],
    pnlType === "OP_COST"
      ? prisma.operatingCost.findMany({
          where: { base_year: baseYear },
          orderBy: [{ project_cd: "asc" }, { target_month: "asc" }],
          select: { op_seq: true, project_cd: true, target_month: true, labor_cost: true, insurance_cost: true, severance_cost: true, dept_op_cost: true, total_cost: true },
        })
      : [],
    findMappingsForYear(baseYear, pnlType),
    loadActiveFeeOptions(prisma),
  ]);

  const mappingsByPnl: Record<string, Array<{ target_month: number; crms_module: string; source_seq: number }>> = {};
  const mappedPnlSeqs = new Set<number>();
  for (const m of mapRows) {
    const k = String(m.pnl_seq);
    if (!mappingsByPnl[k]) mappingsByPnl[k] = [];
    mappingsByPnl[k]!.push({
      target_month: m.target_month,
      crms_module: m.crms_module,
      source_seq: m.source_seq,
    });
    mappedPnlSeqs.add(m.pnl_seq);
  }

  const resolveInputs = pnlRows.map((r) => prismaRowToResolveInput(r as Record<string, unknown>));
  const resolvedByCode = resolvePnlRowsMonths(resolveInputs, feeOptions, baseYear);

  const pnlRowsOut = pnlRows.map((r) => {
    const resolved = resolvedByCode.get(r.row_code);
    return {
      pnl_seq: r.pnl_seq,
      base_year: r.base_year,
      pnl_type: r.pnl_type,
      row_type: r.row_type,
      sort_order: r.sort_order,
      row_label: r.row_label,
      row_code: r.row_code,
      category1: r.category1,
      category2: r.category2,
      category3: r.category3,
      biz_detail: r.biz_detail,
      biz_group: r.biz_group,
      client_name: r.client_name,
      goal_by_month: resolved?.goalByMonth ?? PNL_GOAL_MONTH_KEYS.map((k) => Number((r as Record<string, unknown>)[k] ?? 0)),
      actual_by_month: resolved?.actualByMonth ?? PNL_ACTUAL_MONTH_KEYS.map((k) => Number((r as Record<string, unknown>)[k] ?? 0)),
    };
  });

  return {
    base_year: baseYear,
    pnl_type: pnlType,
    pnlRows: pnlRowsOut,
    arLines: (arRows as Parameters<typeof mapArRow>[0][]).map(mapArRow),
    apLines: (apRows as Parameters<typeof mapApRow>[0][]).map(mapApRow),
    opLines: (opCostRows as OpRow[]).flatMap(expandOpRows),
    mappingsByPnl,
    mappedPnlSeqs: [...mappedPnlSeqs],
  };
}


type CrmsRef = {
  issue_dt: Date | null;
  item_type: string | null;
  description: string;
};

async function saveWithDerivedMonths(
  pnlSeq: number,
  selection: { crms_module: string; source_seq: number }[],
  syncMonths: number[],
) {
  const row = await prisma.pnlMaster.findUnique({
    where: { pnl_seq: pnlSeq },
    select: { base_year: true, row_label: true },
  });
  if (!row) throw new Error("손익 행을 찾을 수 없습니다.");
  if (isBudgetOrQuarter(row.row_label)) throw new Error("예산/분기 항목은 매핑할 수 없습니다.");

  const arIds = selection.filter((s) => s.crms_module === "AR").map((s) => s.source_seq);
  const apIds = selection.filter((s) => s.crms_module === "AP").map((s) => s.source_seq);
  const opMods = new Set(["OP", "OP_LC", "OP_IC", "OP_SC", "OP_DC"]);
  const opIds = [...new Set(selection.filter((s) => opMods.has(s.crms_module)).map((s) => s.source_seq))];
  const [arList, apList, opList] = await Promise.all([
    arIds.length
      ? prisma.ar.findMany({
          where: { ar_seq: { in: arIds }, is_deleted: "N" },
          select: { ar_seq: true, issue_dt: true, item_type: true, description: true },
        })
      : [],
    apIds.length
      ? prisma.ap.findMany({
          where: { ap_seq: { in: apIds }, is_deleted: "N" },
          select: { ap_seq: true, issue_dt: true, item_type: true, description: true },
        })
      : [],
    opIds.length
      ? prisma.operatingCost.findMany({
          where: { op_seq: { in: opIds } },
          select: { op_seq: true, target_month: true },
        })
      : [],
  ]);
  const arBySeq = new Map(arList.map((r) => [r.ar_seq, r]));
  const apBySeq = new Map(apList.map((r) => [r.ap_seq, r]));
  // OperatingCost: target_month = YYYY-MM → 월 숫자 추출
  const opBySeq = new Map(
    (opList as { op_seq: number; target_month: string }[]).map((r) => [r.op_seq, r]),
  );

  const byMonth = new Map<number, { crms_module: string; source_seq: number }[]>();
  const skipped: Array<{ crms_module: string; source_seq: number; reason: string }> = [];

  for (const sel of selection) {
    if (opMods.has(sel.crms_module)) {
      const opRow = opBySeq.get(sel.source_seq);
      if (!opRow) { skipped.push({ ...sel, reason: "운영비 행 없음" }); continue; }
      const monthNum = Number(opRow.target_month.slice(5, 7));
      if (!monthNum || monthNum < 1 || monthNum > 12) { skipped.push({ ...sel, reason: "월 파싱 실패" }); continue; }
      if (!byMonth.has(monthNum)) byMonth.set(monthNum, []);
      byMonth.get(monthNum)!.push(sel);
      continue;
    }
    const ref: CrmsRef | undefined =
      sel.crms_module === "AR"
        ? arBySeq.get(sel.source_seq)
        : apBySeq.get(sel.source_seq);
    if (!ref) {
      skipped.push({ ...sel, reason: "전표 없음" });
      continue;
    }
    const txt = `${ref.item_type ?? ""} ${ref.description ?? ""}`;
    if (isBudgetOrQuarter(txt)) {
      skipped.push({ ...sel, reason: "예산/분기 전표" });
      continue;
    }
    const month = monthFromDate(ref.issue_dt);
    if (!month) {
      skipped.push({ ...sel, reason: "발행일 없음" });
      continue;
    }
    if (!byMonth.has(month)) byMonth.set(month, []);
    byMonth.get(month)!.push(sel);
  }

  const monthsToWrite = new Set(syncMonths.filter((m) => m >= 1 && m <= 12));
  for (const m of byMonth.keys()) monthsToWrite.add(m);

  let saved = 0;
  for (const month of monthsToWrite) {
    const list = byMonth.get(month) ?? [];
    await persistMapping(pnlSeq, month, list.length ? list : null);
    saved += list.length;
  }

  return { saved, skipped, months: [...monthsToWrite].sort((a, b) => a - b) };
}

export async function GET(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) return Response.json({ message: "인증이 필요합니다." }, { status: 401 });

    const { searchParams } = new URL(request.url);

    if (searchParams.get("mode") === "sheet_grid") {
      const baseYear = Number(searchParams.get("base_year"));
      const pnlType = String(searchParams.get("pnl_type") || "AR").toUpperCase();
      if (!Number.isFinite(baseYear) || !["AR", "AP", "OP_COST", "PROFIT"].includes(pnlType)) {
        return Response.json({ message: "base_year, pnl_type이 필요합니다." }, { status: 400 });
      }
      const byPnlSeq = await buildSheetGridCrms(baseYear, pnlType);
      return Response.json({ byPnlSeq }, { status: 200 });
    }

    if (searchParams.get("mode") === "bulk") {
      const baseYear = Number(searchParams.get("base_year"));
      const pnlType = String(searchParams.get("pnl_type") || "AR").toUpperCase();
      if (!Number.isFinite(baseYear) || !["AR", "AP", "OP_COST"].includes(pnlType)) {
        return Response.json({ message: "base_year, pnl_type(AR|AP|OP_COST)이 필요합니다." }, { status: 400 });
      }
      const payload = await buildBulkPayload(baseYear, pnlType);
      return Response.json(payload, { status: 200 });
    }

    const pnlSeq = toNumber(searchParams.get("pnl_seq"));
    const targetMonth = parseTargetMonth(searchParams);
    if (pnlSeq <= 0) return Response.json({ message: "pnl_seq가 필요합니다." }, { status: 400 });
    if (!targetMonth) return Response.json({ message: "target_month(또는 cell_key)가 필요합니다." }, { status: 400 });

    if (searchParams.get("mode") === "cross") {
      const resolved = await resolveCrmsForCross(pnlSeq, targetMonth);
      return Response.json(resolved, { status: 200 });
    }

    const row = await prisma.pnlMaster.findUnique({ where: { pnl_seq: pnlSeq } });
    if (!row) return Response.json({ message: "손익 행을 찾을 수 없습니다." }, { status: 404 });
    const issueDtRange = { gte: new Date(Date.UTC(row.base_year, 0, 1)), lt: new Date(Date.UTC(row.base_year + 1, 0, 1)) };
    const [mappingRows, arRows, apRows] = await Promise.all([
      findMappings(pnlSeq, targetMonth),
      prisma.ar.findMany({
        where: { is_deleted: "N", issue_dt: issueDtRange },
        orderBy: { ar_seq: "asc" },
        take: 400,
        select: { ar_seq: true, biz_group_nm: true, issue_dt: true, client_nm: true, item_type: true, description: true, amount: true, source_id: true },
      }),
      prisma.ap.findMany({
        where: { is_deleted: "N", issue_dt: issueDtRange },
        orderBy: { ap_seq: "asc" },
        take: 400,
        select: { ap_seq: true, biz_group_nm: true, issue_dt: true, client_nm: true, item_type: true, description: true, amount: true, source_id: true },
      }),
    ]);

    return Response.json(
      {
        row: {
          pnl_seq: row.pnl_seq,
          base_year: row.base_year,
          pnl_type: row.pnl_type,
          category1: row.category1,
          category2: row.category2,
          category3: row.category3,
          biz_detail: row.biz_detail,
          biz_group: row.biz_group,
          client_name: row.client_name,
          row_label: row.row_label,
          row_code: row.row_code,
        },
        target_month: targetMonth,
        mappings: mappingRows.map((r) => ({ crms_module: r.crms_module, source_seq: r.source_seq })),
        mapping:
          mappingRows[0] != null
            ? { crms_module: mappingRows[0].crms_module, source_seq: mappingRows[0].source_seq }
            : null,
        arLines: arRows.map(mapArRow),
        apLines: apRows.map(mapApRow),
      },
      { status: 200 },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "서버 오류";
    return Response.json({ message: `CRMS 매핑 조회 중 오류: ${msg}` }, { status: 500 });
  }
}

function parseSelectionObject(value: unknown): { crms_module: string; source_seq: number } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const rec = value as Record<string, unknown>;
  const mod = String(rec.crms_module ?? "").toUpperCase();
  const src = toNumber(rec.source_seq);
  const validMods = ["AR", "AP", "OP", "OP_LC", "OP_IC", "OP_SC", "OP_DC"];
  if (validMods.includes(mod) && src > 0) return { crms_module: mod, source_seq: src };
  return null;
}

function parseSelectionList(value: unknown): { crms_module: string; source_seq: number }[] | null {
  if (value === null) return [];
  if (Array.isArray(value)) {
    const out: { crms_module: string; source_seq: number }[] = [];
    for (const item of value) {
      const one = parseSelectionObject(item);
      if (!one) return null;
      out.push(one);
    }
    return out;
  }
  const one = parseSelectionObject(value);
  return one ? [one] : null;
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return Response.json({ message: "인증이 필요합니다." }, { status: 401 });

  const body = (await request.json()) as Record<string, unknown>;
  const pnlSeq = toNumber(body.pnl_seq);
  if (pnlSeq <= 0) return Response.json({ message: "pnl_seq가 필요합니다." }, { status: 400 });

  if (body.mode === "auto_year_from_january") {
    const parsedList = parseSelectionList(body.selection);
    if (parsedList === null || parsedList.length === 0) {
      return Response.json({ message: "우측에서 동일 사업그룹 CRMS 전표를 선택해 주세요." }, { status: 400 });
    }
    try {
      const result = await autoYearFromSelection(pnlSeq, parsedList);
      const groupNote =
        typeof result.scope_biz_group === "string" && result.scope_biz_group
          ? ` · 사업그룹: ${result.scope_biz_group}`
          : "";
      return Response.json(
        {
          ok: true,
          message: `1~12월 자동 매핑 완료: ${result.saved}건 저장, ${result.skipped}건 스킵${groupNote}`,
          result,
          mappings: result.mappings,
        },
        { status: 200 },
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : "자동 매핑 실패";
      return Response.json({ message: msg }, { status: 500 });
    }
  }

  if (body.derive_month_from_issue_dt === true) {
    if (!("selection" in body)) {
      return Response.json({ message: "selection 필드가 필요합니다." }, { status: 400 });
    }
    const parsedList = parseSelectionList(body.selection);
    if (parsedList === null) {
      return Response.json({ message: "selection 형식이 올바르지 않습니다." }, { status: 400 });
    }
    const syncMonthsRaw = body.sync_months;
    const syncMonths = Array.isArray(syncMonthsRaw)
      ? syncMonthsRaw.map((m) => toNumber(m)).filter((m) => m >= 1 && m <= 12)
      : [];
    try {
      const result = await saveWithDerivedMonths(pnlSeq, parsedList, syncMonths);
      const skipNote = result.skipped.length ? ` (${result.skipped.length}건 스킵)` : "";
      return Response.json(
        {
          ok: true,
          message: `매핑 저장 완료: ${result.saved}건 · ${result.months.length}개월 반영${skipNote}`,
          result,
        },
        { status: 200 },
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : "저장 실패";
      return Response.json({ message: msg }, { status: 500 });
    }
  }

  const targetMonth = toNumber(body.target_month);
  if (targetMonth < 1 || targetMonth > 12) return Response.json({ message: "target_month(1~12)가 필요합니다." }, { status: 400 });

  if (body.mode === "auto_from_january") {
    try {
        const result = await autoMapFromJanuary(pnlSeq, targetMonth);
      return Response.json({ ok: true, message: `자동 매핑 완료: ${result.saved}건 저장, ${result.skipped}건 스킵`, result }, { status: 200 });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "자동 매핑 실패";
      return Response.json({ message: `자동 매핑 오류: ${msg}` }, { status: 500 });
    }
  }

  if (!("selection" in body)) {
    return Response.json({ message: "selection 필드가 필요합니다. (매핑 해제 시 null 또는 [])" }, { status: 400 });
  }
  const parsedList = parseSelectionList(body.selection);
  if (parsedList === null) {
    return Response.json(
      { message: "selection은 null, [], 또는 { crms_module, source_seq } 객체 또는 그 배열이어야 합니다." },
      { status: 400 },
    );
  }
  try {
    await persistMapping(pnlSeq, targetMonth, parsedList.length ? parsedList : null);
    const n = parsedList.length;
    return Response.json(
      {
        ok: true,
        message: n ? `월별 CRMS 매핑 ${n}건을 저장했습니다.` : "해당 월 매핑을 해제했습니다.",
      },
      { status: 200 },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "저장 실패";
    return Response.json({ message: `매핑 저장 오류: ${msg}` }, { status: 500 });
  }
}
