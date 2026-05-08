"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "../../../../lib/prisma";

type FeeTierInput = {
  min_count: number;
  max_count: number;
  tier_price: number;
};

type FeePolicyPayload = {
  bank_cd: "HANA" | "IM" | "BUSAN";
  fee_category: "SETUP" | "OPERATION";
  service_type: string;
  is_active: "Y" | "N";
  is_sliding: "Y" | "N";
  standard_price?: number;
  tiers?: FeeTierInput[];
  actor?: string;
};

type FeePromotionPayload = {
  policy_seq: number;
  promo_name: string;
  promo_type: "SETUP_P" | "OP_P";
  start_dt: string;
  end_dt: string;
  is_sliding: "Y" | "N";
  promo_price?: number;
  tiers?: FeeTierInput[];
  actor?: string;
};

export type ActionResult = {
  ok: boolean;
  message: string;
};

function validateTierRanges(tiers: FeeTierInput[]): ActionResult | null {
  if (tiers.length === 0) {
    return { ok: false, message: "슬라이딩 요금제는 최소 1개 구간이 필요합니다." };
  }
  for (const tier of tiers) {
    if (
      !Number.isFinite(tier.min_count) ||
      !Number.isFinite(tier.max_count) ||
      !Number.isFinite(tier.tier_price)
    ) {
      return { ok: false, message: "구간 값은 숫자로 입력해 주세요." };
    }
    if (tier.min_count >= tier.max_count) {
      return {
        ok: false,
        message: `구간 오류: 시작값(${tier.min_count})은 종료값(${tier.max_count})보다 작아야 합니다.`,
      };
    }
  }

  const sorted = [...tiers].sort((a, b) => a.min_count - b.min_count);
  for (let i = 1; i < sorted.length; i += 1) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    if (prev.max_count >= curr.min_count) {
      return {
        ok: false,
        message: `구간이 겹칩니다: 이전 구간(${prev.min_count}~${prev.max_count}) / 현재 구간(${curr.min_count}~${curr.max_count})`,
      };
    }
  }
  return null;
}

function validatePolicyPayload(payload: FeePolicyPayload): ActionResult | null {
  if (!payload.bank_cd || !payload.fee_category || !payload.service_type.trim()) {
    return { ok: false, message: "필수 입력값을 확인해 주세요." };
  }

  if (payload.is_sliding === "Y") {
    const tiers = payload.tiers ?? [];
    const invalidTier = validateTierRanges(tiers);
    if (invalidTier) return invalidTier;
  } else {
    if (!Number.isFinite(payload.standard_price)) {
      return { ok: false, message: "단일 요금제는 기본 단가를 입력해 주세요." };
    }
  }

  return null;
}

function validatePromotionPayload(payload: FeePromotionPayload): ActionResult | null {
  if (!payload.policy_seq || !payload.promo_name.trim() || !payload.start_dt || !payload.end_dt) {
    return { ok: false, message: "프로모션 필수값을 확인해 주세요." };
  }

  const start = new Date(payload.start_dt);
  const end = new Date(payload.end_dt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return { ok: false, message: "프로모션 기간을 올바르게 입력해 주세요." };
  }
  if (end < start) {
    return { ok: false, message: "프로모션 종료일은 시작일보다 빠를 수 없습니다." };
  }

  if (payload.is_sliding === "Y") {
    const invalidTier = validateTierRanges(payload.tiers ?? []);
    if (invalidTier) return invalidTier;
  } else if (!Number.isFinite(payload.promo_price)) {
    return { ok: false, message: "단일 프로모션 단가를 입력해 주세요." };
  }

  return null;
}

export async function createFeePolicy(payload: FeePolicyPayload): Promise<ActionResult> {
  const invalid = validatePolicyPayload(payload);
  if (invalid) return invalid;

  const duplicate = await prisma.feePolicy.findFirst({
    where: {
      bank_cd: payload.bank_cd,
      fee_category: payload.fee_category,
      service_type: payload.service_type.trim(),
    },
    select: { policy_seq: true },
  });

  if (duplicate) {
    return { ok: false, message: "동일한 은행/구분/서비스 유형 정책이 이미 존재합니다." };
  }

  try {
    await prisma.$transaction(async (tx) => {
      const policy = await tx.feePolicy.create({
        data: {
          bank_cd: payload.bank_cd,
          fee_category: payload.fee_category,
          service_type: payload.service_type.trim(),
          is_active: payload.is_active,
          is_sliding: payload.is_sliding,
          standard_price: payload.is_sliding === "Y" ? 0 : payload.standard_price ?? 0,
          created_by: payload.actor ?? null,
          updated_by: payload.actor ?? null,
        },
      });

      if (payload.is_sliding === "Y") {
        const tiers = (payload.tiers ?? []).slice().sort((a, b) => a.min_count - b.min_count);
        await tx.feeTier.createMany({
          data: tiers.map((tier, idx) => ({
            policy_seq: policy.policy_seq,
            min_count: tier.min_count,
            max_count: tier.max_count,
            tier_price: tier.tier_price,
            sort_order: idx + 1,
            created_by: payload.actor ?? null,
            updated_by: payload.actor ?? null,
          })),
        });
      }
    });
  } catch (error) {
    console.error("Failed to create fee policy:", error);
    return { ok: false, message: "저장 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요." };
  }

  revalidatePath("/dashboard/finance/code");
  return { ok: true, message: "단가 정책이 저장되었습니다." };
}

export async function updateFeePolicy(policy_seq: number, payload: FeePolicyPayload): Promise<ActionResult> {
  const invalid = validatePolicyPayload(payload);
  if (invalid) return invalid;

  const duplicate = await prisma.feePolicy.findFirst({
    where: {
      bank_cd: payload.bank_cd,
      fee_category: payload.fee_category,
      service_type: payload.service_type.trim(),
      NOT: { policy_seq },
    },
    select: { policy_seq: true },
  });
  if (duplicate) {
    return { ok: false, message: "동일한 은행/구분/서비스 유형 정책이 이미 존재합니다." };
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.feePolicy.update({
        where: { policy_seq },
        data: {
          bank_cd: payload.bank_cd,
          fee_category: payload.fee_category,
          service_type: payload.service_type.trim(),
          is_active: payload.is_active,
          is_sliding: payload.is_sliding,
          standard_price: payload.is_sliding === "Y" ? 0 : payload.standard_price ?? 0,
          updated_by: payload.actor ?? null,
        },
      });

      await tx.feeTier.deleteMany({ where: { policy_seq } });
      if (payload.is_sliding === "Y") {
        const tiers = (payload.tiers ?? []).slice().sort((a, b) => a.min_count - b.min_count);
        await tx.feeTier.createMany({
          data: tiers.map((tier, idx) => ({
            policy_seq,
            min_count: tier.min_count,
            max_count: tier.max_count,
            tier_price: tier.tier_price,
            sort_order: idx + 1,
            created_by: payload.actor ?? null,
            updated_by: payload.actor ?? null,
          })),
        });
      }
    });
  } catch (error) {
    console.error("Failed to update fee policy:", error);
    return { ok: false, message: "수정 중 오류가 발생했습니다." };
  }

  revalidatePath("/dashboard/finance/code");
  return { ok: true, message: "단가 정책이 수정되었습니다." };
}

export async function deleteFeePolicy(policy_seq: number): Promise<ActionResult> {
  try {
    await prisma.feePolicy.delete({ where: { policy_seq } });
  } catch (error) {
    console.error("Failed to delete fee policy:", error);
    return { ok: false, message: "삭제 중 오류가 발생했습니다." };
  }
  revalidatePath("/dashboard/finance/code");
  return { ok: true, message: "단가 정책이 삭제되었습니다." };
}

export async function createFeePromotion(payload: FeePromotionPayload): Promise<ActionResult> {
  const invalid = validatePromotionPayload(payload);
  if (invalid) return invalid;

  try {
    await prisma.$transaction(async (tx) => {
      const promo = await tx.feePromotion.create({
        data: {
          policy_seq: payload.policy_seq,
          promo_name: payload.promo_name.trim(),
          promo_type: payload.promo_type,
          start_dt: new Date(payload.start_dt),
          end_dt: new Date(payload.end_dt),
          is_sliding: payload.is_sliding,
          promo_price: payload.is_sliding === "Y" ? 0 : payload.promo_price ?? 0,
          created_by: payload.actor ?? null,
          updated_by: payload.actor ?? null,
        },
      });

      if (payload.is_sliding === "Y") {
        const tiers = (payload.tiers ?? []).slice().sort((a, b) => a.min_count - b.min_count);
        await tx.feePromoTier.createMany({
          data: tiers.map((tier, idx) => ({
            promo_seq: promo.promo_seq,
            min_count: tier.min_count,
            max_count: tier.max_count,
            tier_price: tier.tier_price,
            sort_order: idx + 1,
            created_by: payload.actor ?? null,
            updated_by: payload.actor ?? null,
          })),
        });
      }
    });
  } catch (error) {
    console.error("Failed to create promotion:", error);
    return { ok: false, message: "프로모션 저장 중 오류가 발생했습니다." };
  }

  revalidatePath("/dashboard/finance/code");
  return { ok: true, message: "프로모션이 저장되었습니다." };
}

export async function updateFeePromotion(
  promo_seq: number,
  payload: FeePromotionPayload,
): Promise<ActionResult> {
  const invalid = validatePromotionPayload(payload);
  if (invalid) return invalid;

  try {
    await prisma.$transaction(async (tx) => {
      await tx.feePromotion.update({
        where: { promo_seq },
        data: {
          policy_seq: payload.policy_seq,
          promo_name: payload.promo_name.trim(),
          promo_type: payload.promo_type,
          start_dt: new Date(payload.start_dt),
          end_dt: new Date(payload.end_dt),
          is_sliding: payload.is_sliding,
          promo_price: payload.is_sliding === "Y" ? 0 : payload.promo_price ?? 0,
          updated_by: payload.actor ?? null,
        },
      });
      await tx.feePromoTier.deleteMany({ where: { promo_seq } });
      if (payload.is_sliding === "Y") {
        const tiers = (payload.tiers ?? []).slice().sort((a, b) => a.min_count - b.min_count);
        await tx.feePromoTier.createMany({
          data: tiers.map((tier, idx) => ({
            promo_seq,
            min_count: tier.min_count,
            max_count: tier.max_count,
            tier_price: tier.tier_price,
            sort_order: idx + 1,
            created_by: payload.actor ?? null,
            updated_by: payload.actor ?? null,
          })),
        });
      }
    });
  } catch (error) {
    console.error("Failed to update promotion:", error);
    return { ok: false, message: "프로모션 수정 중 오류가 발생했습니다." };
  }

  revalidatePath("/dashboard/finance/code");
  return { ok: true, message: "프로모션이 수정되었습니다." };
}

export async function deleteFeePromotion(promo_seq: number): Promise<ActionResult> {
  try {
    await prisma.feePromotion.delete({
      where: { promo_seq },
    });
  } catch (error) {
    console.error("Failed to delete promotion:", error);
    return { ok: false, message: "프로모션 삭제 중 오류가 발생했습니다." };
  }

  revalidatePath("/dashboard/finance/code");
  return { ok: true, message: "프로모션이 삭제되었습니다." };
}
