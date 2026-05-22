import type { PrismaClient } from "@prisma/client";

export type PnlFeeOption = {
  code: string;
  label: string;
  unitPrice: number;
  bankCd?: string;
  feeCategory?: string;
  serviceType?: string;
  isSliding?: string;
  tiers?: Array<{ minCount: number; maxCount: number; price: number }>;
  promotions?: Array<{
    promoSeq: number;
    startDate: string | null;
    endDate: string | null;
    isSliding: string;
    price: number;
    tiers: Array<{ minCount: number; maxCount: number; price: number }>;
  }>;
};

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

/** 손익 그리드·매핑 화면 공통 — 활성 수수료 정책 목록 */
export async function loadActiveFeeOptions(prisma: PrismaClient): Promise<PnlFeeOption[]> {
  const feeRepo = (prisma as unknown as { feePolicy?: { findMany: Function } }).feePolicy;
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
            select: { min_count: true, max_count: true, tier_price: true, sort_order: true },
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
                select: { min_count: true, max_count: true, tier_price: true, sort_order: true },
                orderBy: [{ sort_order: "asc" }, { min_count: "asc" }],
              },
            },
            orderBy: [{ priority: "asc" }, { start_dt: "asc" }],
          },
        },
      })
    : []) as PnlMetaFeePolicyRow[];

  return feePolicies.map((item) => ({
    code: `FEE:${item.policy_seq}`,
    bankCd: item.bank_cd,
    feeCategory: item.fee_category,
    serviceType: item.service_type ?? undefined,
    isSliding: item.is_sliding,
    label: `${item.bank_cd}/${item.fee_category}/${item.service_type}`,
    unitPrice: Number(item.standard_price),
    tiers: item.tiers.map((tier) => ({
      minCount: tier.min_count,
      maxCount: tier.max_count,
      price: Number(tier.tier_price),
    })),
    promotions: item.promotions.map((promo) => ({
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
    })),
  }));
}
