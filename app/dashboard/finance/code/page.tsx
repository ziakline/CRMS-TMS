import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "../../../../lib/auth-options";
import { prisma } from "../../../../lib/prisma";
import Sidebar from "../../_components/sidebar";
import FeePolicyBoardV2 from "../_components/fee-policy-board-v2";

export default async function FinanceCodePage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) redirect("/login");

  const policies = await prisma.feePolicy.findMany({
    include: {
      tiers: {
        orderBy: [{ sort_order: "asc" }, { min_count: "asc" }],
      },
      promotions: {
        include: {
          promoTiers: {
            orderBy: [{ sort_order: "asc" }, { min_count: "asc" }],
          },
        },
        orderBy: [{ is_active: "desc" }, { priority: "asc" }, { created_at: "desc" }],
      },
    },
    orderBy: [
      { bank_cd: "asc" },
      { fee_category: "asc" },
      { priority: "asc" },
      { service_type: "asc" },
    ],
  });

  const serializedPolicies = policies.map((policy) => ({
    policy_seq: policy.policy_seq,
    bank_cd: policy.bank_cd,
    fee_category: policy.fee_category,
    service_type: policy.service_type,
    is_sliding: policy.is_sliding,
    standard_price: Number(policy.standard_price),
    is_active: policy.is_active,
    priority: policy.priority,
    tiers: policy.tiers.map((tier) => ({
      tier_seq: tier.tier_seq,
      tier_name: tier.tier_name,
      min_count: tier.min_count,
      max_count: tier.max_count,
      tier_price: Number(tier.tier_price),
      sort_order: tier.sort_order,
    })),
    promotions: policy.promotions.map((promo) => ({
      promo_seq: promo.promo_seq,
      promo_name: promo.promo_name,
      promo_type: promo.promo_type,
      start_dt: promo.start_dt ? promo.start_dt.toISOString() : null,
      end_dt: promo.end_dt ? promo.end_dt.toISOString() : null,
      is_sliding: promo.is_sliding,
      promo_price: Number(promo.promo_price),
      is_active: promo.is_active,
      priority: promo.priority,
      promoTiers: promo.promoTiers.map((tier) => ({
        promo_tier_seq: tier.promo_tier_seq,
        tier_name: tier.tier_name,
        min_count: tier.min_count,
        max_count: tier.max_count,
        tier_price: Number(tier.tier_price),
        sort_order: tier.sort_order,
      })),
    })),
  }));

  return (
    <div className="flex min-h-screen bg-slate-100">
      <Sidebar userName={session.user.name ?? "사용자"} />
      <main className="flex-1 p-6 md:p-10">
        <header className="mb-6">
          <h1 className="text-2xl font-bold text-slate-900">코드관리</h1>
        </header>
        <FeePolicyBoardV2
          policies={serializedPolicies}
          actorName={session.user.email ?? session.user.name ?? undefined}
        />
      </main>
    </div>
  );
}
