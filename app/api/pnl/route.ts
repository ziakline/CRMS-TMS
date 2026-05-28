import { getServerSession } from "next-auth";
import { Prisma } from "@prisma/client";
import { authOptions } from "../../../lib/auth-options";
import { prisma } from "../../../lib/prisma";

function toNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** 클라이언트가 보내지 않으면 DB의 해당 필드는 그대로 둠 */
function explicitMonthsPatch(item: Record<string, unknown>): { actual_explicit_months?: string | null } {
  if (!("actual_explicit_months" in item)) return {};
  const v = item.actual_explicit_months;
  if (v === null) return { actual_explicit_months: null };
  const s = String(v ?? "").trim();
  return { actual_explicit_months: s || null };
}

const TRACKED_CELL_HISTORY_KEYS: string[] = [
  ...Array.from({ length: 12 }, (_, i) => `t_m${String(i + 1).padStart(2, "0")}`),
  ...Array.from({ length: 12 }, (_, i) => `a_m${String(i + 1).padStart(2, "0")}`),
  "company_target",
  "prev_year_actual",
];

const MONTH_VALUE_KEYS = TRACKED_CELL_HISTORY_KEYS.filter((k) => k.startsWith("t_m") || k.startsWith("a_m"));

/** 요청에 포함된 월별·분석 셀만 갱신 (미포함 시 DB 값 유지) */
function monthAndAnalysisPatch(item: Record<string, unknown>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const key of MONTH_VALUE_KEYS) {
    if (key in item) out[key] = toNumber(item[key]);
  }
  if ("prev_year_actual" in item) out.prev_year_actual = toNumber(item.prev_year_actual);
  return out;
}

function numFromDbCell(value: unknown): number {
  if (value === null || value === undefined) return 0;
  const n = Number(value as string | number);
  return Number.isFinite(n) ? n : 0;
}

/** `feePolicy.findMany` 결과 — prisma가 동적 캐스팅이라 배열에 타입을 붙여 map 콜백의 implicit any 방지 */
type PnlMetaFeePolicyRow = {
  policy_seq: number;
  bank_cd: string;
  fee_category: string;
  service_type: string | null;
  is_sliding: string;
  standard_price: unknown;
  tiers: Array<{ min_count: number; max_count: number; tier_price: unknown }>;
  promotions: Array<{
    promo_seq: number;
    start_dt: Date | null;
    end_dt: Date | null;
    is_sliding: string;
    promo_price: unknown;
    promoTiers: Array<{ min_count: number; max_count: number; tier_price: unknown }>;
  }>;
};

export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return Response.json({ message: "인증이 필요합니다." }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const mode = searchParams.get("mode");
  if (mode === "meta") {
    const viewTab = (searchParams.get("viewTab") || "goal").toLowerCase();
    const depthType = (searchParams.get("depthType") || "AR").toUpperCase();
    const feeRepo = (prisma as unknown as {
      feePolicy?: {
        findMany: Function;
      };
    }).feePolicy;
    const feePolicies = (feeRepo
      ? await feeRepo.findMany({
          where: { is_active: "Y" },
          orderBy: [{ bank_cd: "asc" }, { fee_category: "asc" }, { service_type: "asc" }],
          select: {
            policy_seq: true,
            bank_cd: true,
            fee_category: true,
            service_type: true,
            is_sliding: true,
            standard_price: true,
            tiers: {
              select: {
                min_count: true,
                max_count: true,
                tier_price: true,
                sort_order: true,
              },
              orderBy: [{ sort_order: "asc" }, { min_count: "asc" }],
            },
            promotions: {
              where: { is_active: "Y" },
              select: {
                promo_seq: true,
                start_dt: true,
                end_dt: true,
                is_sliding: true,
                promo_price: true,
                priority: true,
                promoTiers: {
                  select: {
                    min_count: true,
                    max_count: true,
                    tier_price: true,
                    sort_order: true,
                  },
                  orderBy: [{ sort_order: "asc" }, { min_count: "asc" }],
                },
              },
              orderBy: [{ priority: "asc" }, { start_dt: "asc" }],
            },
          },
        })
      : []) as PnlMetaFeePolicyRow[];
    const prefRepo = (prisma as unknown as { pnlColumnPreference?: { findUnique: Function } }).pnlColumnPreference;
    let pref: { selected_columns?: string } | null = null;
    if (prefRepo) {
      try {
        pref = await prefRepo.findUnique({
          where: {
            user_email_view_tab_depth_type: {
              user_email: session.user.email,
              view_tab: viewTab,
              depth_type: depthType,
            },
          },
          select: { selected_columns: true },
        });
      } catch (error) {
        const err = error as { code?: string };
        if (err?.code !== "P2022") {
          throw error;
        }
        // DB 스키마에 컬럼이 아직 반영되지 않은 경우 기본 컬럼으로 fallback
        pref = null;
      }
    }

    return Response.json(
      {
        feeOptions: feePolicies.map((item) => ({
          code: `FEE:${item.policy_seq}`,
          policySeq: item.policy_seq,
          bankCd: item.bank_cd,
          feeCategory: item.fee_category,
          serviceType: item.service_type,
          isSliding: item.is_sliding,
          label: `${item.bank_cd}/${item.fee_category}/${item.service_type}`,
          unitPrice: Number(item.standard_price),
          tiers: item.tiers.map((tier: { min_count: number; max_count: number; tier_price: unknown }) => ({
            minCount: tier.min_count,
            maxCount: tier.max_count,
            price: Number(tier.tier_price),
          })),
          promotions: item.promotions.map(
            (promo: {
              promo_seq: number;
              start_dt: Date | null;
              end_dt: Date | null;
              is_sliding: string;
              promo_price: unknown;
              promoTiers: Array<{ min_count: number; max_count: number; tier_price: unknown }>;
            }) => ({
              promoSeq: promo.promo_seq,
              startDate: promo.start_dt ? promo.start_dt.toISOString() : null,
              endDate: promo.end_dt ? promo.end_dt.toISOString() : null,
              isSliding: promo.is_sliding,
              price: Number(promo.promo_price),
              tiers: promo.promoTiers.map((tier) => ({
                minCount: tier.min_count,
                maxCount: tier.max_count,
                price: Number(tier.tier_price),
              })),
            }),
          ),
        })),
        selectedColumns: pref?.selected_columns ? pref.selected_columns.split(",").filter(Boolean) : null,
      },
      { status: 200 },
    );
  }

  const year = Number(searchParams.get("year"));
  const type = (searchParams.get("type") || "AR").toUpperCase();
  if (!Number.isFinite(year) || !["AR", "AP", "OP_COST", "PROFIT"].includes(type)) {
    return Response.json({ message: "잘못된 조회 조건입니다." }, { status: 400 });
  }

  const rows = await prisma.pnlMaster.findMany({
    where: { base_year: year, pnl_type: type },
    orderBy: { sort_order: "asc" },
  });

  return Response.json({ rows }, { status: 200 });
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return Response.json({ message: "인증이 필요합니다." }, { status: 401 });
  }

  const body = await request.json();
  const baseYear = toNumber(body.baseYear);
  const pnlType = String(body.pnlType || "AR").toUpperCase();
  if (!Number.isFinite(baseYear) || !["AR", "AP", "OP_COST", "PROFIT"].includes(pnlType)) {
    return Response.json({ message: "잘못된 입력입니다." }, { status: 400 });
  }

  const last = await prisma.pnlMaster.findFirst({
    where: { base_year: baseYear, pnl_type: pnlType },
    orderBy: { sort_order: "desc" },
    select: { sort_order: true },
  });
  const nextOrder = (last?.sort_order ?? 0) + 1;
  const rowLabel = String(body.row_label || "신규 항목");
  const rowCode = `${baseYear}_${pnlType}_${nextOrder}_${Date.now()}`.slice(0, 100);

  const created = await prisma.pnlMaster.create({
    data: {
      base_year: baseYear,
      pnl_type: pnlType,
      row_code: rowCode,
      parent_row_code: body.parent_row_code || null,
      grade: body.grade || null,
      category1: body.category1 || null,
      category2: body.category2 || null,
      category3: body.category3 || null,
      biz_detail: body.biz_detail || null,
      biz_group: body.biz_group || null,
      row_label: rowLabel,
      client_name: body.client_name || null,
      row_type: body.row_type || "QTY_INPUT",
      calc_mode: "AUTO",
      formula_targets: body.formula_targets || null,
      ref_qty_row_code: body.ref_qty_row_code || null,
      ref_unit_price_cd: body.ref_unit_price_cd || null,
      promo_apply_actual: Boolean(body.promo_apply_actual),
      vat_included_price: Boolean(body.vat_included_price),
      sort_order: nextOrder,
      company_target: 0,
    },
  });

  return Response.json({ row: created, message: "항목이 추가되었습니다." }, { status: 201 });
}

export async function PUT(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return Response.json({ message: "인증이 필요합니다." }, { status: 401 });
  }

  const body = await request.json();
  if (body?.mode === "columns") {
    const selectedColumns = Array.isArray(body?.selectedColumns) ? body.selectedColumns : [];
    const viewTab = String(body?.viewTab || "goal").toLowerCase();
    const depthType = String(body?.depthType || "AR").toUpperCase();
    const prefRepo = (prisma as unknown as { pnlColumnPreference?: { upsert: Function } }).pnlColumnPreference;
    if (prefRepo) {
      try {
        await prefRepo.upsert({
          where: {
            user_email_view_tab_depth_type: {
              user_email: session.user.email,
              view_tab: viewTab,
              depth_type: depthType,
            },
          },
          update: { selected_columns: selectedColumns.join(",") },
          create: {
            user_email: session.user.email,
            view_tab: viewTab,
            depth_type: depthType,
            selected_columns: selectedColumns.join(","),
          },
        });
      } catch (error) {
        const err = error as { code?: string };
        if (err?.code !== "P2022") {
          throw error;
        }
        // DB 스키마 미반영 시 컬럼 설정 저장은 건너뛰고 정상 응답
      }
    }
    return Response.json({ message: "항목 설정이 저장되었습니다." }, { status: 200 });
  }

  const updates = Array.isArray(body?.updates) ? body.updates : [];
  if (updates.length === 0) {
    return Response.json({ message: "저장할 변경사항이 없습니다." }, { status: 400 });
  }

  const author = session.user?.name?.trim() || session.user?.email || "unknown";

  await prisma.$transaction(async (tx) => {
    const pnlSeqs: number[] = [
      ...new Set<number>(
        updates
          .map((item: Record<string, unknown>) => toNumber(item?.pnl_seq))
          .filter((v: number) => v > 0),
      ),
    ];
    const beforeRows = await tx.pnlMaster.findMany({ where: { pnl_seq: { in: pnlSeqs } } });
    const beforeBySeq = new Map(beforeRows.map((row) => [row.pnl_seq, row]));
    const historyRows: Array<{
      pnl_seq: number;
      cell_key: string;
      old_value: string;
      new_value: string;
      author: string;
    }> = [];

    for (const item of updates) {
      const itemObj = item as Record<string, unknown>;
      const pnl_seq = toNumber(itemObj.pnl_seq);
      const before = beforeBySeq.get(pnl_seq);
      if (!before) continue;

      for (const key of TRACKED_CELL_HISTORY_KEYS) {
        if (!(key in itemObj)) continue;
        const oldV = numFromDbCell(before[key as keyof typeof before]);
        const newV = toNumber(itemObj[key]);
        if (oldV !== newV) {
          historyRows.push({
            pnl_seq,
            cell_key: key,
            old_value: String(oldV),
            new_value: String(newV),
            author,
          });
        }
      }

      const completionPatch =
        "cell_completion" in itemObj
          ? {
              cell_completion:
                itemObj.cell_completion === null || itemObj.cell_completion === undefined
                  ? Prisma.DbNull
                  : (itemObj.cell_completion as Prisma.InputJsonValue),
            }
          : {};

      const updateData: Record<string, unknown> = {
        grade: (itemObj.grade as string) || null,
        category1: (itemObj.category1 as string) || null,
        category2: (itemObj.category2 as string) || null,
        category3: (itemObj.category3 as string) || null,
        biz_detail: (itemObj.biz_detail as string) || null,
        biz_group: (itemObj.biz_group as string) || null,
        client_name: (itemObj.client_name as string) || null,
        row_label: (itemObj.row_label as string) || null,
        row_type: (itemObj.row_type as string) || undefined,
        formula_targets: (itemObj.formula_targets as string) || null,
        ref_qty_row_code: (itemObj.ref_qty_row_code as string) || null,
        ref_unit_price_cd: (itemObj.ref_unit_price_cd as string) || null,
        promo_apply_actual: Boolean(itemObj.promo_apply_actual),
        vat_included_price: Boolean(itemObj.vat_included_price),
        ...monthAndAnalysisPatch(itemObj),
        ...explicitMonthsPatch(itemObj),
        ...completionPatch,
      };
      // sort_order·company_target·calc_mode는 클라이언트가 보낼 때만 갱신
      if ("sort_order" in itemObj) updateData.sort_order = toNumber(itemObj.sort_order);
      if ("company_target" in itemObj) updateData.company_target = toNumber(itemObj.company_target);
      if ("calc_mode" in itemObj) updateData.calc_mode = (itemObj.calc_mode as string) || "AUTO";

      await tx.pnlMaster.update({
        where: { pnl_seq },
        data: updateData,
      });
    }

    if (historyRows.length) {
      await tx.pnlCellHistory.createMany({ data: historyRows });
    }
  });

  return Response.json({ message: `${updates.length}건 저장되었습니다.` }, { status: 200 });
}

export async function DELETE(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return Response.json({ message: "인증이 필요합니다." }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const pnlSeq = Number(searchParams.get("pnlSeq"));
  if (Number.isFinite(pnlSeq) && pnlSeq > 0) {
    await prisma.pnlMaster.delete({ where: { pnl_seq: pnlSeq } });
    return Response.json({ message: "행이 삭제되었습니다." }, { status: 200 });
  }

  const year = Number(searchParams.get("year"));
  if (Number.isFinite(year)) {
    const result = await prisma.pnlMaster.deleteMany({ where: { base_year: year } });
    return Response.json({ message: `${year}년 손익계획 ${result.count}건 삭제` }, { status: 200 });
  }

  const result = await prisma.pnlMaster.deleteMany();
  return Response.json({ message: `손익계획 전체 ${result.count}건 삭제` }, { status: 200 });
}
