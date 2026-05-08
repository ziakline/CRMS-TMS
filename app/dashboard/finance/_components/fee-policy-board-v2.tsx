"use client";

import { useMemo, useState, type Dispatch, type FormEvent, type SetStateAction } from "react";
import { Pencil, Plus, Trash2, X } from "lucide-react";
import { formatKstDateTime } from "../../../../lib/time";
import {
  createFeePolicy,
  createFeePromotion,
  deleteFeePolicy,
  deleteFeePromotion,
  updateFeePolicy,
  updateFeePromotion,
} from "../code/actions";

type FeeTierItem = { tier_seq: number; min_count: number; max_count: number; tier_price: number; sort_order: number };
type FeePromoTierItem = { promo_tier_seq: number; min_count: number; max_count: number; tier_price: number; sort_order: number };
type FeePromotionItem = {
  promo_seq: number; promo_name: string; promo_type: string; start_dt: string | null; end_dt: string | null;
  is_sliding: string; promo_price: number; is_active: string; priority: number; promoTiers: FeePromoTierItem[];
};
type FeePolicyItem = {
  policy_seq: number; bank_cd: string; fee_category: string; service_type: string; is_sliding: string;
  standard_price: number; is_active: string; priority: number; tiers: FeeTierItem[]; promotions: FeePromotionItem[];
};
type Props = { policies: FeePolicyItem[]; actorName?: string };
type TierDraft = { id: string; min_count: string; max_count: string; tier_price: string };

const bankTabs = [{ code: "HANA", label: "하나은행" }, { code: "IM", label: "iM뱅크" }, { code: "BUSAN", label: "부산은행" }] as const;
const initialTier = (): TierDraft => ({ id: `${Date.now()}-${Math.random()}`, min_count: "", max_count: "", tier_price: "" });
const won = (v: number) => `${v.toLocaleString("ko-KR")}원`;
const countRange = (min: number, max: number) => `${min.toLocaleString("ko-KR")}~${max.toLocaleString("ko-KR")}개`;

export default function FeePolicyBoardV2({ policies, actorName }: Props) {
  const [selectedBank, setSelectedBank] = useState<(typeof bankTabs)[number]["code"]>("HANA");
  const [toast, setToast] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [openPolicyModal, setOpenPolicyModal] = useState(false);
  const [openPromoModal, setOpenPromoModal] = useState(false);
  const [editingPolicySeq, setEditingPolicySeq] = useState<number | null>(null);
  const [editingPromoSeq, setEditingPromoSeq] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  const [bankCd, setBankCd] = useState<"HANA" | "IM" | "BUSAN">("HANA");
  const [feeCategory, setFeeCategory] = useState<"SETUP" | "OPERATION">("SETUP");
  const [serviceType, setServiceType] = useState("");
  const [isActive, setIsActive] = useState<"Y" | "N">("Y");
  const [isSliding, setIsSliding] = useState<"Y" | "N">("N");
  const [standardPrice, setStandardPrice] = useState("");
  const [tiers, setTiers] = useState<TierDraft[]>([initialTier()]);

  const [targetPolicySeq, setTargetPolicySeq] = useState<number | "">("");
  const [promoName, setPromoName] = useState("");
  const [promoType, setPromoType] = useState<"SETUP_P" | "OP_P">("SETUP_P");
  const [promoStartDt, setPromoStartDt] = useState("");
  const [promoEndDt, setPromoEndDt] = useState("");
  const [promoSliding, setPromoSliding] = useState<"Y" | "N">("N");
  const [promoPrice, setPromoPrice] = useState("");
  const [promoTiers, setPromoTiers] = useState<TierDraft[]>([initialTier()]);

  const filtered = useMemo(() => policies.filter((p) => p.bank_cd === selectedBank), [policies, selectedBank]);
  const allPromos = useMemo(() => policies.flatMap((p) => p.promotions.map((m) => ({ ...m, policy_seq: p.policy_seq }))), [policies]);

  const setTier = (setter: Dispatch<SetStateAction<TierDraft[]>>, id: string, k: keyof Omit<TierDraft, "id">, v: string) =>
    setter((prev) => prev.map((t) => (t.id === id ? { ...t, [k]: v } : t)));

  const openCreatePolicy = () => {
    setEditingPolicySeq(null); setBankCd("HANA"); setFeeCategory("SETUP"); setServiceType(""); setIsActive("Y"); setIsSliding("N"); setStandardPrice(""); setTiers([initialTier()]); setError(""); setOpenPolicyModal(true);
  };
  const openEditPolicy = (p: FeePolicyItem) => {
    setEditingPolicySeq(p.policy_seq); setBankCd(p.bank_cd as "HANA" | "IM" | "BUSAN"); setFeeCategory(p.fee_category as "SETUP" | "OPERATION"); setServiceType(p.service_type); setIsActive(p.is_active as "Y" | "N"); setIsSliding(p.is_sliding as "Y" | "N"); setStandardPrice(String(p.standard_price)); setTiers(p.tiers.length ? p.tiers.map((t) => ({ id: String(t.tier_seq), min_count: String(t.min_count), max_count: String(t.max_count), tier_price: String(t.tier_price) })) : [initialTier()]); setError(""); setOpenPolicyModal(true);
  };
  const openCreatePromo = (policySeq?: number) => {
    setEditingPromoSeq(null); setTargetPolicySeq(policySeq ?? ""); setPromoName(""); setPromoType("SETUP_P"); setPromoStartDt(""); setPromoEndDt(""); setPromoSliding("N"); setPromoPrice(""); setPromoTiers([initialTier()]); setError(""); setOpenPromoModal(true);
  };
  const openEditPromo = (promoSeq: number) => {
    const promo = allPromos.find((p) => p.promo_seq === promoSeq); if (!promo) return;
    setEditingPromoSeq(promoSeq); setTargetPolicySeq((promo as { policy_seq: number }).policy_seq); setPromoName(promo.promo_name); setPromoType(promo.promo_type as "SETUP_P" | "OP_P"); setPromoStartDt(promo.start_dt?.slice(0, 10) ?? ""); setPromoEndDt(promo.end_dt?.slice(0, 10) ?? ""); setPromoSliding(promo.is_sliding as "Y" | "N"); setPromoPrice(String(promo.promo_price)); setPromoTiers(promo.promoTiers.length ? promo.promoTiers.map((t) => ({ id: String(t.promo_tier_seq), min_count: String(t.min_count), max_count: String(t.max_count), tier_price: String(t.tier_price) })) : [initialTier()]); setError(""); setOpenPromoModal(true);
  };

  const submitPolicy = async (e: FormEvent) => {
    e.preventDefault(); setLoading(true); setError(""); setToast("");
    const payload = { bank_cd: bankCd, fee_category: feeCategory, service_type: serviceType, is_active: isActive, is_sliding: isSliding, standard_price: isSliding === "N" ? Number(standardPrice) : undefined, tiers: isSliding === "Y" ? tiers.map((t) => ({ min_count: Number(t.min_count), max_count: Number(t.max_count), tier_price: Number(t.tier_price) })) : [], actor: actorName };
    const res = editingPolicySeq ? await updateFeePolicy(editingPolicySeq, payload) : await createFeePolicy(payload);
    setLoading(false); if (!res.ok) return setError(res.message); setToast(res.message); setOpenPolicyModal(false);
  };
  const submitPromo = async (e: FormEvent) => {
    e.preventDefault(); setLoading(true); setError(""); setToast("");
    const payload = { policy_seq: Number(targetPolicySeq), promo_name: promoName, promo_type: promoType, start_dt: promoStartDt, end_dt: promoEndDt, is_sliding: promoSliding, promo_price: promoSliding === "N" ? Number(promoPrice) : undefined, tiers: promoSliding === "Y" ? promoTiers.map((t) => ({ min_count: Number(t.min_count), max_count: Number(t.max_count), tier_price: Number(t.tier_price) })) : [], actor: actorName };
    const res = editingPromoSeq ? await updateFeePromotion(editingPromoSeq, payload) : await createFeePromotion(payload);
    setLoading(false); if (!res.ok) return setError(res.message); setToast(res.message); setOpenPromoModal(false);
  };
  const onDeletePromotion = async (promoSeq: number) => {
    if (!confirm("정말 이 프로모션을 삭제하시겠습니까?")) return;
    setToast("");
    setError("");
    const result = await deleteFeePromotion(promoSeq);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setToast(result.message);
  };

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-2">{bankTabs.map((t) => <button key={t.code} type="button" onClick={() => setSelectedBank(t.code)} className={`rounded px-3 py-2 text-sm ${selectedBank === t.code ? "bg-indigo-600 text-white" : "bg-white ring-1 ring-slate-200"}`}>{t.label}</button>)}</div>
        <div className="flex gap-2">
          <button type="button" onClick={openCreatePolicy} className="rounded bg-emerald-600 px-3 py-2 text-sm text-white">단가 등록</button>
          <button type="button" onClick={() => openCreatePromo()} className="rounded bg-blue-600 px-3 py-2 text-sm text-white">프로모션 등록</button>
        </div>
      </div>
      {toast ? <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{toast}</div> : null}
      {error ? <div className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div> : null}

      {(["SETUP", "OPERATION"] as const).map((cat) => (
        <section key={cat} className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="text-base font-bold">{cat === "SETUP" ? "개설단가 (SETUP)" : "운영단가 (OPERATION)"}</h2>
          <div className="mt-3 space-y-2">
            {filtered.filter((p) => p.fee_category === cat).map((p) => {
              const now = new Date();
              const activePromo = p.promotions.find((m) => m.is_active === "Y" && (!m.start_dt || new Date(m.start_dt) <= now) && (!m.end_dt || new Date(m.end_dt) >= now));
              return (
                <details key={p.policy_seq} className="rounded border border-slate-200 bg-slate-50">
                  <summary className="cursor-pointer px-3 py-2 text-sm font-semibold">{p.service_type} · {p.is_sliding === "Y" ? "구간별 단가 적용 (▼)" : won(p.standard_price)}</summary>
                  <div className="space-y-2 border-t border-slate-200 bg-white p-3">
                    {p.is_sliding === "Y" ? p.tiers.map((t) => <div key={t.tier_seq} className="text-sm">{t.min_count.toLocaleString()}~{t.max_count.toLocaleString()}개: {won(t.tier_price)}</div>) : null}
                    <div className="flex gap-2">
                      <button type="button" onClick={() => openEditPolicy(p)} className="rounded border px-2 py-1 text-xs"><Pencil size={12} className="inline" /> 수정</button>
                      <button type="button" onClick={async () => { if (!confirm("삭제하시겠습니까?")) return; const r = await deleteFeePolicy(p.policy_seq); setToast(r.message); }} className="rounded border border-rose-200 px-2 py-1 text-xs text-rose-700">삭제</button>
                      <button type="button" onClick={() => openCreatePromo(p.policy_seq)} className="rounded border border-blue-200 px-2 py-1 text-xs text-blue-700">프로모션 등록</button>
                      {activePromo ? <button type="button" onClick={() => openEditPromo(activePromo.promo_seq)} className="rounded border border-indigo-200 px-2 py-1 text-xs text-indigo-700">프로모션 수정</button> : null}
                      {activePromo ? <button type="button" onClick={() => void onDeletePromotion(activePromo.promo_seq)} className="rounded border border-rose-200 px-2 py-1 text-xs text-rose-700">프로모션 삭제</button> : null}
                    </div>
                    {activePromo ? (
                      <div className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800">
                        <p className="font-semibold">
                          프로모션 적용 중: {activePromo.promo_name}
                        </p>
                        <p className="mt-1">
                          기간: {activePromo.start_dt ? formatKstDateTime(activePromo.start_dt) : "-"} ~{" "}
                          {activePromo.end_dt ? formatKstDateTime(activePromo.end_dt) : "-"}
                        </p>
                        {activePromo.is_sliding === "Y" ? (
                          <ul className="mt-2 space-y-1">
                            {activePromo.promoTiers
                              .slice()
                              .sort((a, b) => a.sort_order - b.sort_order || a.min_count - b.min_count)
                              .map((tier) => (
                                <li key={tier.promo_tier_seq}>
                                  {countRange(tier.min_count, tier.max_count)}: {won(tier.tier_price)}
                                </li>
                              ))}
                          </ul>
                        ) : (
                          <p className="mt-1">적용 단가: {won(activePromo.promo_price)}</p>
                        )}
                      </div>
                    ) : null}
                  </div>
                </details>
              );
            })}
          </div>
        </section>
      ))}

      {openPolicyModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 px-4">
          <form onSubmit={submitPolicy} className="w-full max-w-2xl space-y-3 rounded-xl bg-white p-5">
            <div className="flex justify-between"><h3 className="font-bold">{editingPolicySeq ? "단가 수정" : "단가 등록"}</h3><button type="button" onClick={() => setOpenPolicyModal(false)}><X size={18} /></button></div>
            <div className="grid gap-2 sm:grid-cols-2">
              <select value={bankCd} onChange={(e) => setBankCd(e.target.value as "HANA" | "IM" | "BUSAN")} className="rounded border px-2 py-2"><option value="HANA">하나은행</option><option value="IM">iM뱅크</option><option value="BUSAN">부산은행</option></select>
              <select value={feeCategory} onChange={(e) => setFeeCategory(e.target.value as "SETUP" | "OPERATION")} className="rounded border px-2 py-2"><option value="SETUP">개설단가</option><option value="OPERATION">운영단가</option></select>
              <input value={serviceType} onChange={(e) => setServiceType(e.target.value)} placeholder="서비스 유형" className="rounded border px-2 py-2" />
              <select value={isActive} onChange={(e) => setIsActive(e.target.value as "Y" | "N")} className="rounded border px-2 py-2"><option value="Y">활성</option><option value="N">비활성</option></select>
              <select value={isSliding} onChange={(e) => setIsSliding(e.target.value as "Y" | "N")} className="rounded border px-2 py-2"><option value="N">단일</option><option value="Y">슬라이딩</option></select>
            </div>
            {isSliding === "N" ? <input type="number" min={0} value={standardPrice} onChange={(e) => setStandardPrice(e.target.value)} placeholder="기본 단가" className="w-full rounded border px-2 py-2" /> : (
              <div className="space-y-2 rounded border p-2">
                <button type="button" onClick={() => setTiers((v) => [...v, initialTier()])} className="rounded bg-slate-800 px-2 py-1 text-xs text-white">구간 추가</button>
                {tiers.map((t) => <div key={t.id} className="grid grid-cols-12 gap-2"><input type="number" min={0} value={t.min_count} onChange={(e) => setTier(setTiers, t.id, "min_count", e.target.value)} placeholder="시작" className="col-span-3 rounded border px-2 py-2 text-sm" /><input type="number" min={0} value={t.max_count} onChange={(e) => setTier(setTiers, t.id, "max_count", e.target.value)} placeholder="종료" className="col-span-3 rounded border px-2 py-2 text-sm" /><input type="number" min={0} value={t.tier_price} onChange={(e) => setTier(setTiers, t.id, "tier_price", e.target.value)} placeholder="단가" className="col-span-5 rounded border px-2 py-2 text-sm" /><button type="button" onClick={() => setTiers((prev) => prev.length > 1 ? prev.filter((x) => x.id !== t.id) : prev)} className="col-span-1 rounded border border-rose-200 text-rose-700"><Trash2 size={12} /></button></div>)}
              </div>
            )}
            <div className="flex justify-end gap-2"><button type="button" onClick={() => setOpenPolicyModal(false)} className="rounded border px-3 py-2 text-sm">취소</button><button type="submit" disabled={loading} className="rounded bg-indigo-600 px-3 py-2 text-sm text-white">{loading ? "저장 중..." : editingPolicySeq ? "수정" : "저장"}</button></div>
          </form>
        </div>
      ) : null}

      {openPromoModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 px-4">
          <form onSubmit={submitPromo} className="w-full max-w-2xl space-y-3 rounded-xl bg-white p-5">
            <div className="flex justify-between"><h3 className="font-bold">{editingPromoSeq ? "프로모션 수정" : "프로모션 등록"}</h3><button type="button" onClick={() => setOpenPromoModal(false)}><X size={18} /></button></div>
            <select value={targetPolicySeq} onChange={(e) => setTargetPolicySeq(Number(e.target.value))} className="w-full rounded border px-2 py-2"><option value="">대상 정책 선택</option>{policies.map((p) => <option key={p.policy_seq} value={p.policy_seq}>[{p.bank_cd}] {p.fee_category} · {p.service_type}</option>)}</select>
            <div className="grid gap-2 sm:grid-cols-2">
              <input value={promoName} onChange={(e) => setPromoName(e.target.value)} placeholder="프로모션명" className="rounded border px-2 py-2" />
              <select value={promoType} onChange={(e) => setPromoType(e.target.value as "SETUP_P" | "OP_P")} className="rounded border px-2 py-2"><option value="SETUP_P">개설단가P</option><option value="OP_P">운영단가P</option></select>
              <input type="date" value={promoStartDt} onChange={(e) => setPromoStartDt(e.target.value)} className="rounded border px-2 py-2" />
              <input type="date" value={promoEndDt} onChange={(e) => setPromoEndDt(e.target.value)} className="rounded border px-2 py-2" />
              <select value={promoSliding} onChange={(e) => setPromoSliding(e.target.value as "Y" | "N")} className="rounded border px-2 py-2"><option value="N">단일 할인가</option><option value="Y">슬라이딩 할인가</option></select>
            </div>
            {promoSliding === "N" ? <input type="number" min={0} value={promoPrice} onChange={(e) => setPromoPrice(e.target.value)} placeholder="적용 단가" className="w-full rounded border px-2 py-2" /> : (
              <div className="space-y-2 rounded border p-2">
                <button type="button" onClick={() => setPromoTiers((v) => [...v, initialTier()])} className="rounded bg-slate-800 px-2 py-1 text-xs text-white">구간 추가</button>
                {promoTiers.map((t) => <div key={t.id} className="grid grid-cols-12 gap-2"><input type="number" min={0} value={t.min_count} onChange={(e) => setTier(setPromoTiers, t.id, "min_count", e.target.value)} placeholder="시작" className="col-span-3 rounded border px-2 py-2 text-sm" /><input type="number" min={0} value={t.max_count} onChange={(e) => setTier(setPromoTiers, t.id, "max_count", e.target.value)} placeholder="종료" className="col-span-3 rounded border px-2 py-2 text-sm" /><input type="number" min={0} value={t.tier_price} onChange={(e) => setTier(setPromoTiers, t.id, "tier_price", e.target.value)} placeholder="단가" className="col-span-5 rounded border px-2 py-2 text-sm" /><button type="button" onClick={() => setPromoTiers((prev) => prev.length > 1 ? prev.filter((x) => x.id !== t.id) : prev)} className="col-span-1 rounded border border-rose-200 text-rose-700"><Trash2 size={12} /></button></div>)}
              </div>
            )}
            <div className="flex justify-end gap-2"><button type="button" onClick={() => setOpenPromoModal(false)} className="rounded border px-3 py-2 text-sm">취소</button><button type="submit" disabled={loading} className="rounded bg-blue-600 px-3 py-2 text-sm text-white">{loading ? "저장 중..." : editingPromoSeq ? "수정" : "저장"}</button></div>
          </form>
        </div>
      ) : null}
    </section>
  );
}
