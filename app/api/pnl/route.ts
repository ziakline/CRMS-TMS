import { getServerSession } from "next-auth";
import { authOptions } from "../../../lib/auth-options";
import { prisma } from "../../../lib/prisma";

function toNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
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

  await prisma.$transaction(
    updates.map((item: Record<string, unknown>) =>
      prisma.pnlMaster.update({
        where: { pnl_seq: toNumber(item.pnl_seq) },
        data: {
          grade: (item.grade as string) || null,
          category1: (item.category1 as string) || null,
          category2: (item.category2 as string) || null,
          category3: (item.category3 as string) || null,
          biz_detail: (item.biz_detail as string) || null,
          biz_group: (item.biz_group as string) || null,
          client_name: (item.client_name as string) || null,
          row_label: (item.row_label as string) || null,
          row_type: (item.row_type as string) || undefined,
          sort_order: toNumber(item.sort_order),
          company_target: toNumber(item.company_target),
          calc_mode: (item.calc_mode as string) || "AUTO",
          formula_targets: (item.formula_targets as string) || null,
          ref_qty_row_code: (item.ref_qty_row_code as string) || null,
          ref_unit_price_cd: (item.ref_unit_price_cd as string) || null,
          promo_apply_actual: Boolean(item.promo_apply_actual),
          vat_included_price: Boolean(item.vat_included_price),
          t_m01: toNumber(item.t_m01),
          t_m02: toNumber(item.t_m02),
          t_m03: toNumber(item.t_m03),
          t_m04: toNumber(item.t_m04),
          t_m05: toNumber(item.t_m05),
          t_m06: toNumber(item.t_m06),
          t_m07: toNumber(item.t_m07),
          t_m08: toNumber(item.t_m08),
          t_m09: toNumber(item.t_m09),
          t_m10: toNumber(item.t_m10),
          t_m11: toNumber(item.t_m11),
          t_m12: toNumber(item.t_m12),
          a_m01: toNumber(item.a_m01),
          a_m02: toNumber(item.a_m02),
          a_m03: toNumber(item.a_m03),
          a_m04: toNumber(item.a_m04),
          a_m05: toNumber(item.a_m05),
          a_m06: toNumber(item.a_m06),
          a_m07: toNumber(item.a_m07),
          a_m08: toNumber(item.a_m08),
          a_m09: toNumber(item.a_m09),
          a_m10: toNumber(item.a_m10),
          a_m11: toNumber(item.a_m11),
          a_m12: toNumber(item.a_m12),
        },
      }),
    ),
  );

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
