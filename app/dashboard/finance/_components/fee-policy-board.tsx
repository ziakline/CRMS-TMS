"use client";

import { useMemo, useState, type FormEvent } from "react";
import { Plus, Trash2, X } from "lucide-react";
import { formatKstDateTime } from "../../../../lib/time";
import { createFeePolicy } from "../code/actions";

type FeeTierItem = {
  tier_seq: number;
  tier_name: string | null;
  min_count: number;
  max_count: number;
  tier_price: number;
  sort_order: number;
};

type FeePromoTierItem = {
  promo_tier_seq: number;
  tier_name: string | null;
  min_count: number;
  max_count: number;
  tier_price: number;
  sort_order: number;
};

type FeePromotionItem = {
  promo_seq: number;
  promo_name: string;
  promo_type: string;
  start_dt: string | null;
  end_dt: string | null;
  is_sliding: string;
  promo_price: number;
  is_active: string;
  priority: number;
  promoTiers: FeePromoTierItem[];
};

type FeePolicyItem = {
  policy_seq: number;
  bank_cd: string;
  fee_category: string;
  service_type: string;
  is_sliding: string;
  standard_price: number;
  is_active: string;
  priority: number;
  tiers: FeeTierItem[];
  promotions: FeePromotionItem[];
};

type FeePolicyBoardProps = {
  policies: FeePolicyItem[];
  actorName?: string;
};

const bankTabs = [
  { code: "HANA", label: "하나은행" },
  { code: "IM", label: "iM뱅크" },
  { code: "BUSAN", label: "부산은행" },
] as const;

function formatWon(value: number) {
  return `${value.toLocaleString("ko-KR")}원`;
}

function formatCountRange(minCount: number, maxCount: number) {
  return `${minCount.toLocaleString("ko-KR")} ~ ${maxCount.toLocaleString("ko-KR")}개`;
}

function isNowInRange(start: string | null, end: string | null, now: Date) {
  if (!start && !end) return true;
  const startDate = start ? new Date(start) : null;
  const endDate = end ? new Date(end) : null;
  if (startDate && now < startDate) return false;
  if (endDate && now > endDate) return false;
  return true;
}

function buildPromoTooltip(promo: FeePromotionItem) {
  const period = `${promo.start_dt ? formatKstDateTime(promo.start_dt) : "-"} ~ ${
    promo.end_dt ? formatKstDateTime(promo.end_dt) : "-"
  }`;
  if (promo.is_sliding === "Y") {
    const tierText = promo.promoTiers
      .map((tier) => `${formatCountRange(tier.min_count, tier.max_count)}: ${formatWon(tier.tier_price)}`)
      .join(" | ");
    return `${promo.promo_name}\n기간: ${period}\n구간: ${tierText}`;
  }
  return `${promo.promo_name}\n기간: ${period}\n적용 단가: ${formatWon(promo.promo_price)}`;
}

function PolicySection({
  title,
  policies,
}: {
  title: string;
  policies: FeePolicyItem[];
}) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-base font-bold text-slate-900">{title}</h2>
      <div className="mt-4 space-y-3">
        {policies.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-4 text-sm text-slate-500">
            등록된 데이터가 없습니다.
          </div>
        ) : (
          policies.map((policy) => {
            const now = new Date();
            const activePromotions = policy.promotions
              .filter((promo) => promo.is_active === "Y" && isNowInRange(promo.start_dt, promo.end_dt, now))
              .sort((a, b) => a.priority - b.priority);
            const primaryPromo = activePromotions[0] ?? null;

            return (
              <details
                key={policy.policy_seq}
                className="overflow-hidden rounded-lg border border-slate-200 bg-slate-50/60"
              >
                <summary className="cursor-pointer list-none px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-slate-900">{policy.service_type}</span>
                      {policy.is_active !== "Y" ? (
                        <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[11px] text-slate-600">
                          비활성
                        </span>
                      ) : null}
                      {primaryPromo ? (
                        <span
                          title={buildPromoTooltip(primaryPromo)}
                          className="rounded-full bg-blue-100 px-2 py-0.5 text-[11px] font-semibold text-blue-700"
                        >
                          프로모션 적용 중
                        </span>
                      ) : null}
                    </div>
                    <div className="text-sm font-semibold text-slate-800">
                      {policy.is_sliding === "Y" ? "구간별 단가 적용 (▼)" : formatWon(policy.standard_price)}
                    </div>
                  </div>
                </summary>

                {policy.is_sliding === "Y" ? (
                  <div className="border-t border-slate-200 bg-white px-4 py-3">
                    <ul className="space-y-2 text-sm text-slate-700">
                      {policy.tiers
                        .slice()
                        .sort((a, b) => a.sort_order - b.sort_order || a.min_count - b.min_count)
                        .map((tier) => (
                          <li key={tier.tier_seq} className="flex items-center justify-between rounded bg-slate-50 px-3 py-2">
                            <span>
                              {tier.tier_name ? `${tier.tier_name} · ` : ""}
                              {formatCountRange(tier.min_count, tier.max_count)}
                            </span>
                            <span className="font-semibold">{formatWon(tier.tier_price)}</span>
                          </li>
                        ))}
                    </ul>
                  </div>
                ) : null}
              </details>
            );
          })
        )}
      </div>
    </section>
  );
}

type TierDraft = {
  id: string;
  min_count: string;
  max_count: string;
  tier_price: string;
};

const initialTier = (): TierDraft => ({
  id: `${Date.now()}-${Math.random()}`,
  min_count: "",
  max_count: "",
  tier_price: "",
});

export default function FeePolicyBoard({ policies, actorName }: FeePolicyBoardProps) {
  const [selectedBank, setSelectedBank] = useState<(typeof bankTabs)[number]["code"]>("HANA");
  const [openCreateModal, setOpenCreateModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const [bankCd, setBankCd] = useState<"HANA" | "IM" | "BUSAN">("HANA");
  const [feeCategory, setFeeCategory] = useState<"SETUP" | "OPERATION">("SETUP");
  const [serviceType, setServiceType] = useState("");
  const [isActive, setIsActive] = useState<"Y" | "N">("Y");
  const [isSliding, setIsSliding] = useState<"Y" | "N">("N");
  const [standardPrice, setStandardPrice] = useState("");
  const [tiers, setTiers] = useState<TierDraft[]>([initialTier()]);

  const filtered = useMemo(
    () => policies.filter((policy) => policy.bank_cd === selectedBank),
    [policies, selectedBank],
  );
  const setupPolicies = filtered.filter((policy) => policy.fee_category === "SETUP");
  const operationPolicies = filtered.filter((policy) => policy.fee_category === "OPERATION");

  const closeModal = () => {
    setOpenCreateModal(false);
    setFormError(null);
  };

  const addTier = () => {
    setTiers((prev) => [...prev, initialTier()]);
  };

  const removeTier = (id: string) => {
    setTiers((prev) => {
      const next = prev.filter((tier) => tier.id !== id);
      return next.length > 0 ? next : [initialTier()];
    });
  };

  const updateTier = (id: string, key: keyof Omit<TierDraft, "id">, value: string) => {
    setTiers((prev) => prev.map((tier) => (tier.id === id ? { ...tier, [key]: value } : tier)));
  };

  const validateClient = () => {
    if (!serviceType.trim()) return "서비스 유형을 입력해 주세요.";
    if (isSliding === "N" && standardPrice.trim() === "") return "기본 단가를 입력해 주세요.";
    if (isSliding === "Y") {
      if (tiers.length === 0) return "슬라이딩 구간을 1개 이상 입력해 주세요.";
      for (const tier of tiers) {
        if (!tier.min_count || !tier.max_count || !tier.tier_price) {
          return "슬라이딩 구간의 시작/종료/단가를 모두 입력해 주세요.";
        }
      }
    }
    return null;
  };

  const handleCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);
    setToast(null);
    const clientInvalid = validateClient();
    if (clientInvalid) {
      setFormError(clientInvalid);
      return;
    }

    setSubmitting(true);
    try {
      const result = await createFeePolicy({
        bank_cd: bankCd,
        fee_category: feeCategory,
        service_type: serviceType,
        is_active: isActive,
        is_sliding: isSliding,
        standard_price: isSliding === "N" ? Number(standardPrice) : undefined,
        tiers:
          isSliding === "Y"
            ? tiers.map((tier) => ({
                min_count: Number(tier.min_count),
                max_count: Number(tier.max_count),
                tier_price: Number(tier.tier_price),
              }))
            : [],
        actor: actorName,
      });

      if (!result.ok) {
        setFormError(result.message);
        return;
      }

      setToast({ type: "success", message: result.message });
      setOpenCreateModal(false);
      setServiceType("");
      setStandardPrice("");
      setTiers([initialTier()]);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "요청 처리 중 오류가 발생했습니다.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {bankTabs.map((tab) => (
            <button
              key={tab.code}
              type="button"
              onClick={() => setSelectedBank(tab.code)}
              className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${
                selectedBank === tab.code
                  ? "bg-indigo-600 text-white"
                  : "bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-100"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setOpenCreateModal(true)}
          className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700"
        >
          <Plus size={16} />
          단가 등록
        </button>
      </div>

      {toast ? (
        <div
          className={`rounded-lg px-4 py-3 text-sm font-medium ${
            toast.type === "success"
              ? "border border-emerald-200 bg-emerald-50 text-emerald-700"
              : "border border-rose-200 bg-rose-50 text-rose-700"
          }`}
        >
          {toast.message}
        </div>
      ) : null}

      <div className="grid gap-5">
        <PolicySection title="개설단가 (SETUP)" policies={setupPolicies} />
        <PolicySection title="운영단가 (OPERATION)" policies={operationPolicies} />
      </div>

      {openCreateModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 px-4">
          <div className="w-full max-w-2xl rounded-xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <h3 className="text-lg font-bold text-slate-900">단가 등록</h3>
              <button type="button" onClick={closeModal} className="rounded p-1 text-slate-500 hover:bg-slate-100">
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleCreate} className="space-y-4 px-5 py-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-1 text-sm">
                  <span className="font-medium text-slate-700">은행</span>
                  <select
                    value={bankCd}
                    onChange={(e) => setBankCd(e.target.value as "HANA" | "IM" | "BUSAN")}
                    className="w-full rounded-md border border-slate-300 px-3 py-2"
                  >
                    <option value="HANA">하나은행</option>
                    <option value="IM">iM뱅크</option>
                    <option value="BUSAN">부산은행</option>
                  </select>
                </label>
                <label className="space-y-1 text-sm">
                  <span className="font-medium text-slate-700">구분</span>
                  <select
                    value={feeCategory}
                    onChange={(e) => setFeeCategory(e.target.value as "SETUP" | "OPERATION")}
                    className="w-full rounded-md border border-slate-300 px-3 py-2"
                  >
                    <option value="SETUP">개설단가</option>
                    <option value="OPERATION">운영단가</option>
                  </select>
                </label>
              </div>

              <label className="block space-y-1 text-sm">
                <span className="font-medium text-slate-700">서비스 유형</span>
                <input
                  value={serviceType}
                  onChange={(e) => setServiceType(e.target.value)}
                  placeholder="예: 단독형, 서버형, 연계형"
                  className="w-full rounded-md border border-slate-300 px-3 py-2"
                />
              </label>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-1 text-sm">
                  <span className="font-medium text-slate-700">활성 상태</span>
                  <select
                    value={isActive}
                    onChange={(e) => setIsActive(e.target.value as "Y" | "N")}
                    className="w-full rounded-md border border-slate-300 px-3 py-2"
                  >
                    <option value="Y">활성(Y)</option>
                    <option value="N">비활성(N)</option>
                  </select>
                </label>
                <label className="space-y-1 text-sm">
                  <span className="font-medium text-slate-700">요금제 방식</span>
                  <select
                    value={isSliding}
                    onChange={(e) => setIsSliding(e.target.value as "Y" | "N")}
                    className="w-full rounded-md border border-slate-300 px-3 py-2"
                  >
                    <option value="N">단일 요금제</option>
                    <option value="Y">슬라이딩(구간) 요금제</option>
                  </select>
                </label>
              </div>

              {isSliding === "N" ? (
                <label className="block space-y-1 text-sm">
                  <span className="font-medium text-slate-700">기본 단가</span>
                  <input
                    type="number"
                    min={0}
                    value={standardPrice}
                    onChange={(e) => setStandardPrice(e.target.value)}
                    placeholder="예: 22000"
                    className="w-full rounded-md border border-slate-300 px-3 py-2"
                  />
                </label>
              ) : (
                <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium text-slate-700">슬라이딩 구간</p>
                    <button
                      type="button"
                      onClick={addTier}
                      className="rounded-md bg-slate-800 px-2 py-1 text-xs font-semibold text-white hover:bg-slate-900"
                    >
                      구간 추가
                    </button>
                  </div>
                  <div className="space-y-2">
                    {tiers.map((tier, idx) => (
                      <div key={tier.id} className="grid grid-cols-12 gap-2">
                        <input
                          type="number"
                          min={0}
                          value={tier.min_count}
                          onChange={(e) => updateTier(tier.id, "min_count", e.target.value)}
                          placeholder="시작"
                          className="col-span-3 rounded-md border border-slate-300 px-2 py-2 text-sm"
                        />
                        <input
                          type="number"
                          min={0}
                          value={tier.max_count}
                          onChange={(e) => updateTier(tier.id, "max_count", e.target.value)}
                          placeholder="종료"
                          className="col-span-3 rounded-md border border-slate-300 px-2 py-2 text-sm"
                        />
                        <input
                          type="number"
                          min={0}
                          value={tier.tier_price}
                          onChange={(e) => updateTier(tier.id, "tier_price", e.target.value)}
                          placeholder="단가"
                          className="col-span-5 rounded-md border border-slate-300 px-2 py-2 text-sm"
                        />
                        <button
                          type="button"
                          onClick={() => removeTier(tier.id)}
                          className="col-span-1 inline-flex items-center justify-center rounded-md border border-rose-200 text-rose-600 hover:bg-rose-50"
                          title={`구간 ${idx + 1} 삭제`}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {formError ? (
                <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                  {formError}
                </p>
              ) : null}

              <div className="flex justify-end gap-2 border-t border-slate-200 pt-3">
                <button
                  type="button"
                  onClick={closeModal}
                  className="rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  취소
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
                >
                  {submitting ? "저장 중..." : "저장"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </section>
  );
}
