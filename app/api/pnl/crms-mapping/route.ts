import { Prisma } from "@prisma/client";
import { getServerSession } from "next-auth";
import { authOptions } from "../../../../lib/auth-options";
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

function isBudgetOrQuarter(v: string | null | undefined): boolean {
  const s = String(v ?? "").toUpperCase();
  return /(?:^|[^0-9])(2Q|3Q|4Q)(?:[^0-9]|$)/.test(s) || s.includes("예산");
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

async function persistMapping(
  pnlSeq: number,
  targetMonth: number,
  selection: Array<{ crms_module: string; source_seq: number }> | null,
) {
  await prisma.$executeRaw(Prisma.sql`
    DELETE FROM "TB_PNL_CRMS_MAPPING"
    WHERE pnl_seq = ${pnlSeq}
      AND target_month = ${targetMonth}
  `);
  if (!selection?.length) return;
  const seen = new Set<string>();
  for (const sel of selection) {
    const k = `${sel.crms_module}:${sel.source_seq}`;
    if (seen.has(k)) continue;
    seen.add(k);
    await prisma.$executeRaw(Prisma.sql`
      INSERT INTO "TB_PNL_CRMS_MAPPING" (pnl_seq, target_month, crms_module, source_seq)
      VALUES (${pnlSeq}, ${targetMonth}, ${sel.crms_module}, ${sel.source_seq})
    `);
  }
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
  for (const row of mapRows) {
    if (row.crms_module === "AR") arIds.add(row.source_seq);
    else if (row.crms_module === "AP") apIds.add(row.source_seq);
  }
  const [arList, apList] = await Promise.all([
    arIds.size
      ? prisma.ar.findMany({
          where: { ar_seq: { in: [...arIds] }, is_deleted: "N" },
          select: {
            ar_seq: true,
            biz_group_nm: true,
            issue_dt: true,
            client_nm: true,
            item_type: true,
            description: true,
            amount: true,
            source_id: true,
          },
        })
      : [],
    apIds.size
      ? prisma.ap.findMany({
          where: { ap_seq: { in: [...apIds] }, is_deleted: "N" },
          select: {
            ap_seq: true,
            biz_group_nm: true,
            issue_dt: true,
            client_nm: true,
            item_type: true,
            description: true,
            amount: true,
            source_id: true,
          },
        })
      : [],
  ]);
  const arBySeq = new Map(arList.map((r) => [r.ar_seq, r]));
  const apBySeq = new Map(apList.map((r) => [r.ap_seq, r]));

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
    const exists = (await findMappings(pnlSeq, month)).length > 0;
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
            if (baseBizGroup && normText(r.biz_group_nm) !== baseBizGroup) return false;
            if (baseClient && normText(r.client_nm) !== baseClient) return false;
            const rowStem = stripMonth(txt);
            return !baseStem || !rowStem || rowStem === baseStem;
          })
        : apRows.filter((r) => {
            const txt = `${r.item_type ?? ""} ${r.description ?? ""}`;
            if (isBudgetOrQuarter(txt)) return false;
            if (monthFromDate(r.issue_dt) !== month) return false;
            if (baseBizGroup && normText(r.biz_group_nm) !== baseBizGroup) return false;
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
  if ((mod === "AR" || mod === "AP") && src > 0) return { crms_module: mod, source_seq: src };
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
  const targetMonth = toNumber(body.target_month);
  if (pnlSeq <= 0) return Response.json({ message: "pnl_seq가 필요합니다." }, { status: 400 });
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
