"use client";

import { Fragment, memo, useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { isOpCostSubtotalManualRow } from "../../../../lib/pnl-crms-shared";
import { useSearchParams } from "next/navigation";
import {
  PnlCellAuditHost,
  type PnlCellAuditHostRef,
  type PnlCellTargetPayload,
  cellNoteFlagKey,
  isPnlCellCompleted,
  readCellCompletion,
} from "../pnl-plan/_components/pnl-cell-audit";

// ── Types ──────────────────────────────────────────────────────────────────────
type DepthType = "AR" | "AP" | "OP_COST" | "PROFIT";
type ViewTab   = "goal" | "actual";
type RowType   = "QTY_INPUT" | "AMT_INPUT" | "AMT_CALC" | "SUBTOTAL" | "TOTAL" | "GRAND_TOTAL" | "PROFIT_CALC";
type CompareKind = "tab" | "goal" | "actual" | "crms";

type PnlRow = {
  pnl_seq: number; base_year: number; pnl_type: DepthType; row_code: string;
  parent_row_code: string | null; grade: string | null;
  category1: string | null; category2: string | null; category3: string | null;
  biz_detail: string | null; biz_group: string | null;
  row_label: string | null; client_name: string | null;
  row_type: RowType; calc_mode: string; formula_targets: string | null;
  ref_qty_row_code: string | null; ref_unit_price_cd: string | null;
  promo_apply_actual?: boolean; vat_included_price?: boolean;
  actual_explicit_months?: string | null;
  sort_order: number; prev_year_actual: number; company_target: number; base_ratio: number;
  [key: string]: unknown;
};

type FeeOption = {
  code: string; label: string; unitPrice: number;
  bankCd?: string; feeCategory?: string; serviceType?: string; isSliding?: string;
  tiers?: { minCount: number; maxCount: number; price: number }[];
  promotions?: { promoSeq: number; startDate: string | null; endDate: string | null; isSliding: string; price: number; tiers: { minCount: number; maxCount: number; price: number }[] }[];
};

type CrmsMonthDetail = { col_detail: string; col_category: string; col_code: string; col_client: string; col_item: string; amount: number };
type CrmsSheetRow   = { hasAny: boolean; months: Record<string, CrmsMonthDetail | null>; yearSum: number };

type AddForm = {
  grade: string; category1: string; category2: string; category3: string;
  biz_detail: string; biz_group: string; client_name: string; row_label: string;
  row_type: RowType; formula_targets: string[];
  profit_ar_targets: string[]; profit_ap_targets: string[];
  ref_qty_row_code: string; ref_unit_price_cd: string;
  promo_apply_actual: boolean; vat_included_price: boolean;
};
const EMPTY_FORM: AddForm = {
  grade:"", category1:"", category2:"", category3:"", biz_detail:"", biz_group:"", client_name:"", row_label:"",
  row_type:"QTY_INPUT", formula_targets:[], profit_ar_targets:[], profit_ap_targets:[],
  ref_qty_row_code:"", ref_unit_price_cd:"", promo_apply_actual:false, vat_included_price:false,
};

// ── Constants ─────────────────────────────────────────────────────────────────
const GOAL_KEYS   = Array.from({ length: 12 }, (_, i) => `t_m${String(i + 1).padStart(2, "0")}`);
const ACTUAL_KEYS = Array.from({ length: 12 }, (_, i) => `a_m${String(i + 1).padStart(2, "0")}`);
const MONTH_LABELS = ["1월","2월","3월","4월","5월","6월","7월","8월","9월","10월","11월","12월"];

const SECTIONS: { key: DepthType; label: string; titleCls: string }[] = [
  { key:"AR",      label:"AR (매출)",   titleCls:"bg-indigo-600 text-white"  },
  { key:"AP",      label:"AP (매입)",   titleCls:"bg-rose-600 text-white"    },
  { key:"OP_COST", label:"부서운영비",  titleCls:"bg-amber-600 text-white"   },
  { key:"PROFIT",  label:"영업이익",    titleCls:"bg-emerald-700 text-white" },
];

const META_COLS = [
  { key:"grade",       label:"등급"    },
  { key:"category1",  label:"계정과목" },
  { key:"category2",  label:"구분"    },
  { key:"category3",  label:"사업상세" },
  { key:"biz_detail", label:"사업구분" },
  { key:"biz_group",  label:"코드"    },
  { key:"client_name",label:"거래처"  },
  { key:"row_label",  label:"항목"    },
] as const;
type MetaKey = typeof META_COLS[number]["key"];

/** 월 열 우측에 표시되는 분석 열 (항목설정에서 ON/OFF) */
const ANALYSIS_COLS = (yy: number) => [
  { key:"prev_year_actual", label:`${yy-1}년도 실적`,       computed:false },
  { key:"target_sum",       label:`${yy}년 목표`,           computed:true  },
  { key:"actual_sum",       label:`${yy}년 실적`,           computed:true  },
  { key:"gap1",             label:`${yy}-${yy-1} GAP`,      computed:true  },
  { key:"gap1_rate",        label:`${yy}-${yy-1} GAP 비율`, computed:true  },
  { key:"company_target",   label:"회사목표",               computed:false },
  { key:"gap2",             label:"실적-목표 GAP",           computed:true  },
  { key:"gap2_rate",        label:"실적-목표 GAP 비율",      computed:true  },
  { key:"base_ratio",       label:`${yy}년비율`,             computed:false },
] as const;
type AnalysisKey = ReturnType<typeof ANALYSIS_COLS>[number]["key"];
const ANALYSIS_STORAGE_KEY = "pnl-unified-r2-analysis-cols";

// ── effectiveRows helpers (mirror of pnl-grid-client logic) ──────────────────
function toNumber(v: unknown) { const n = Number(String(v ?? "").replace(/,/g,"")); return Number.isFinite(n) ? n : 0; }
function parseActualExplicit(csv: unknown): Set<string> { return new Set(String(csv??"").split(",").map(s=>s.trim()).filter(s=>ACTUAL_KEYS.includes(s))); }
function explicitCsv(set: Set<string>): string | null { return set.size > 0 ? [...set].sort().join(",") : null; }
function inputMouseDownSelectAll(e: MouseEvent<HTMLInputElement>) {
  if (e.currentTarget.disabled) return;
  if (e.button === 2) { e.preventDefault(); return; }
  if (document.activeElement === e.currentTarget) e.preventDefault();
}
function pnlCellInputId(pnlSeq: number, key: string) { return `${pnlSeq}:${key}`; }
function fmtWon(n: number) { return Math.round(n).toLocaleString("ko-KR"); }

type PnlMonthInputProps = {
  pnlSeq: number;
  cellKey: string;
  val: number;
  editable: boolean;
  focused: boolean;
  isEstimate: boolean;
  isActualCol: boolean;
  cellCompleted: boolean;
  onCommit: (raw: string) => void;
  onFocusCell: () => void;
  onBlurCell: () => void;
  onTab: (reverse: boolean) => void;
  onContextMenu: (e: MouseEvent<HTMLDivElement>) => void;
  registerActiveEditor: (editor: { commit: () => void } | null) => void;
};

const PnlMonthInput = memo(function PnlMonthInput({
  pnlSeq,
  cellKey,
  val,
  editable,
  focused,
  isEstimate,
  isActualCol,
  cellCompleted,
  onCommit,
  onFocusCell,
  onBlurCell,
  onTab,
  onContextMenu,
  registerActiveEditor,
}: PnlMonthInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const draftRef = useRef("");
  const [draft, setDraft] = useState("");
  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;

  useEffect(() => {
    if (!focused) return;
    registerActiveEditor({
      commit: () => onCommitRef.current(draftRef.current),
    });
    return () => registerActiveEditor(null);
  }, [focused, registerActiveEditor]);

  const displayValue = focused ? draft : (val === 0 ? "" : fmtWon(val));
  const monthInputCls = [
    "box-border h-[22px] w-full min-w-[88px] max-w-[88px] border border-transparent bg-transparent px-2 py-0 text-right text-xs tabular-nums outline-none",
    "focus:border-indigo-400 focus:bg-white",
    editable ? "cursor-text" : "cursor-default",
    cellCompleted
      ? "font-black text-[#0B4BFF] drop-shadow-[0_0_0_rgba(0,0,0,0)] disabled:text-[#0B4BFF]"
      : isEstimate
        ? "font-bold text-red-600"
        : val < 0
          ? "text-red-600"
          : "",
  ].join(" ");

  return (
    <div
      onMouseDown={(e) => { if (e.button === 2) e.preventDefault(); }}
      onContextMenu={onContextMenu}
      className={`relative p-0 text-right tabular-nums whitespace-nowrap ${editable ? "hover:bg-indigo-50/40" : ""} ${isActualCol ? "bg-rose-50/20" : ""}`}
    >
      <input
        ref={inputRef}
        type="text"
        inputMode="numeric"
        data-pnl-cell={pnlCellInputId(pnlSeq, cellKey)}
        value={displayValue}
        disabled={!editable}
        readOnly={!editable}
        onMouseDown={editable ? inputMouseDownSelectAll : undefined}
        onFocus={(e) => {
          if (!editable) return;
          const init = val === 0 ? "" : String(Math.trunc(val));
          draftRef.current = init;
          setDraft(init);
          onFocusCell();
          const el = e.currentTarget;
          el.select();
          requestAnimationFrame(() => { if (document.activeElement === el) el.select(); });
        }}
        onBlur={(e) => {
          const rt = e.relatedTarget as HTMLElement | null;
          if (rt?.dataset?.pnlCell) return;
          if (focused) {
            onCommitRef.current(draftRef.current);
            onBlurCell();
          }
        }}
        onChange={(e) => {
          if (!focused) return;
          const digits = e.target.value.replace(/\D/g, "");
          draftRef.current = digits;
          setDraft(digits);
        }}
        onKeyDown={(e) => {
          if (e.key === "Tab" && editable) {
            e.preventDefault();
            onTab(e.shiftKey);
          } else if (e.key === "Enter" && editable) {
            onCommitRef.current(draftRef.current);
            onBlurCell();
            (e.target as HTMLInputElement).blur();
          } else if (e.key === "Escape") {
            onBlurCell();
            (e.target as HTMLInputElement).blur();
          }
        }}
        className={monthInputCls}
      />
    </div>
  );
}, (prev, next) =>
  prev.pnlSeq === next.pnlSeq
  && prev.cellKey === next.cellKey
  && prev.val === next.val
  && prev.editable === next.editable
  && prev.focused === next.focused
  && prev.isEstimate === next.isEstimate
  && prev.isActualCol === next.isActualCol
  && prev.cellCompleted === next.cellCompleted);
function parseProfitTargets(ft: string | null | undefined) {
  if (!ft) return { ar:[] as string[], ap:[] as string[] };
  try { const p = JSON.parse(ft) as { ar?:string[]; ap?:string[] }; return { ar:Array.isArray(p?.ar)?p.ar:[], ap:Array.isArray(p?.ap)?p.ap:[] }; }
  catch { return { ar:[], ap:[] }; }
}
function inRange(d: Date, s: string|null, e: string|null) {
  const ms = d.getTime();
  if (s) { const sd=new Date(s); sd.setHours(0,0,0,0); if (ms<sd.getTime()) return false; }
  if (e) { const ed=new Date(e); ed.setHours(23,59,59,999); if (ms>ed.getTime()) return false; }
  return true;
}
function slidingAmt(qty:number,cum:number,tiers:{minCount:number;maxCount:number;price:number}[]) {
  const q=Math.max(0,Math.floor(qty)),c=Math.max(0,Math.floor(cum));
  if (!q) return 0;
  let amt=0;
  for (const t of [...tiers].sort((a,b)=>a.minCount-b.minCount)) { const os=Math.max(c+1,t.minCount),oe=Math.min(c+q,t.maxCount); if(oe>=os) amt+=(oe-os+1)*t.price; }
  return amt;
}
function calcAmt(year:number,qty:number[],pol:FeeOption|undefined,allowPromo:boolean,vatInc:boolean) {
  if (!pol) return qty.map(()=>0);
  const stdT=pol.tiers??[],isOp=pol.feeCategory==="OPERATION",promos=allowPromo?(pol.promotions??[]):[];
  let stdCum=0; const promoCum=new Map<number,number>();
  return qty.map((qRaw,mi)=>{ const q=Math.max(0,Math.floor(qRaw)),dt=new Date(year,mi,1); const promo=promos.find(p=>inRange(dt,p.startDate,p.endDate));
    if (promo) { const pc=promoCum.get(promo.promoSeq)??0; let a=promo.isSliding==="Y"?slidingAmt(q,isOp?0:pc,promo.tiers??[]):q*toNumber(promo.price); if(vatInc)a=Math.round(a/1.1); if(!isOp){promoCum.set(promo.promoSeq,pc+q);stdCum+=q;} return a; }
    let a=pol.isSliding==="Y"?slidingAmt(q,isOp?0:stdCum,stdT):q*toNumber(pol.unitPrice); if(vatInc)a=Math.round(a/1.1); if(!isOp)stdCum+=q; return a;
  });
}
function allowGoalPromo(p:FeeOption|undefined){return String(p?.feeCategory??"").toUpperCase()==="SETUP";}
function allowActualPromo(p:FeeOption|undefined,row:PnlRow){if(!p)return false; return String(p.feeCategory??"").toUpperCase()==="SETUP"||Boolean(row.promo_apply_actual);}
function isImOp(p:FeeOption|undefined){if(!p||String(p.bankCd??"").toUpperCase()!=="IM"||String(p.feeCategory??"").toUpperCase()!=="OPERATION")return false; return `${p.serviceType??""} ${p.label??""}`.toLowerCase().replace(/\s+/g,"").match(/운영료|유지운영/)!==null;}
function isTotalPartialGoal(row:PnlRow,all:PnlRow[],polMap:Map<string,FeeOption>){
  if(row.row_type!=="TOTAL")return false;
  const codes=(row.formula_targets||"").split(",").map(s=>s.trim()).filter(Boolean); if(!codes.length)return false;
  const byCode=new Map(all.map(r=>[r.row_code,r]));
  const targets=codes.map(c=>byCode.get(c)).filter(Boolean) as PnlRow[];
  return targets.length===codes.length&&targets.every(t=>t.row_type==="AMT_CALC"&&t.ref_unit_price_cd&&isImOp(polMap.get(t.ref_unit_price_cd!)));
}
function computeEffective(allRows:PnlRow[],feeOptions:FeeOption[],year:number):PnlRow[] {
  const sorted=[...allRows].sort((a,b)=>a.sort_order-b.sort_order);
  const byCode=new Map(sorted.map(r=>[r.row_code,r]));
  const polMap=new Map(feeOptions.map(f=>[f.code,f]));
  const cache=new Map<string,PnlRow>();
  const resolve=(row:PnlRow):PnlRow=>{
    if(cache.has(row.row_code))return cache.get(row.row_code)!;
    const expl=parseActualExplicit(row.actual_explicit_months);
    let next={...row} as PnlRow;
    const rA=(r:PnlRow,ak:string,gk:string)=>{ const v=toNumber(r[ak]); if(expl.has(ak))return v; return v!==0?v:toNumber(r[gk]); };
    if(row.row_type==="AMT_CALC"&&row.calc_mode==="MANUAL_OVERRIDE"){
      const qr=row.ref_qty_row_code?byCode.get(row.ref_qty_row_code):undefined;
      const pol=row.ref_unit_price_cd?polMap.get(row.ref_unit_price_cd):undefined;
      if(qr&&pol){const q=resolve(qr);const aA=calcAmt(year,ACTUAL_KEYS.map(k=>toNumber(q[k])),pol,allowActualPromo(pol,row),Boolean(row.vat_included_price));for(let i=0;i<12;i++){next[GOAL_KEYS[i]]=toNumber(row[GOAL_KEYS[i]]);next[ACTUAL_KEYS[i]]=expl.has(ACTUAL_KEYS[i])?toNumber(row[ACTUAL_KEYS[i]]):aA[i];}}
      else{for(let i=0;i<12;i++)next[ACTUAL_KEYS[i]]=rA(row,ACTUAL_KEYS[i],GOAL_KEYS[i]);}
    }else if(row.row_type==="AMT_CALC"&&row.ref_qty_row_code&&row.ref_unit_price_cd){
      const qr=byCode.get(row.ref_qty_row_code),pol=polMap.get(row.ref_unit_price_cd);
      if(qr&&pol){const q=resolve(qr);const gA=calcAmt(year,GOAL_KEYS.map(k=>toNumber(q[k])),pol,allowGoalPromo(pol),Boolean(row.vat_included_price));const aA=calcAmt(year,ACTUAL_KEYS.map(k=>toNumber(q[k])),pol,allowActualPromo(pol,row),Boolean(row.vat_included_price));for(let i=0;i<12;i++){next[GOAL_KEYS[i]]=gA[i];next[ACTUAL_KEYS[i]]=aA[i];}}
    }
    if(row.row_type==="QTY_INPUT"||row.row_type==="AMT_INPUT"){for(let i=0;i<12;i++)next[ACTUAL_KEYS[i]]=rA(row,ACTUAL_KEYS[i],GOAL_KEYS[i]);}
    const tCodes=(row.formula_targets||"").split(",").map(s=>s.trim()).filter(Boolean);
    const tRows=tCodes.map(c=>byCode.get(c)).filter(Boolean) as PnlRow[];
    if(row.row_type==="SUBTOTAL"&&tRows.length){
      const rs=tRows.map(resolve);
      if(isOpCostSubtotalManualRow(row)){
        for(const gk of GOAL_KEYS)next[gk]=rs.reduce((s,r)=>s+toNumber(r[gk]),0);
        for(const ak of ACTUAL_KEYS){
          next[ak]=expl.has(ak)?toNumber(row[ak]):rs.reduce((s,r)=>s+toNumber(r[ak]),0);
        }
      }else{
        for(const k of[...GOAL_KEYS,...ACTUAL_KEYS])next[k]=rs.reduce((s,r)=>s+toNumber(r[k]),0);
      }
    }
    else if(row.row_type==="TOTAL"&&row.calc_mode==="MANUAL_OVERRIDE"&&isTotalPartialGoal(row,sorted,polMap)&&tRows.length){const rs=tRows.map(resolve);for(let i=0;i<12;i++){next[ACTUAL_KEYS[i]]=rs.reduce((s,r)=>s+toNumber(r[ACTUAL_KEYS[i]]),0);next[GOAL_KEYS[i]]=toNumber(row[GOAL_KEYS[i]]);}}
    else if((row.row_type==="TOTAL"||row.row_type==="GRAND_TOTAL")&&row.calc_mode!=="MANUAL_OVERRIDE"&&tRows.length){const rs=tRows.map(resolve);for(const k of[...GOAL_KEYS,...ACTUAL_KEYS])next[k]=rs.reduce((s,r)=>s+toNumber(r[k]),0);}
    if(row.row_type==="PROFIT_CALC"&&row.calc_mode!=="MANUAL_OVERRIDE"){
      const pt=parseProfitTargets(row.formula_targets);
      const arR=pt.ar.map(c=>byCode.get(c)).filter(Boolean) as PnlRow[];
      const apR=pt.ap.map(c=>byCode.get(c)).filter(Boolean) as PnlRow[];
      for(const k of[...GOAL_KEYS,...ACTUAL_KEYS])next[k]=arR.reduce((s,r)=>s+toNumber(resolve(r)[k]),0)-apR.reduce((s,r)=>s+toNumber(resolve(r)[k]),0);
    }
    cache.set(row.row_code,next);return next;
  };
  return sorted.map(resolve);
}
function rowStyle(row:PnlRow):string {
  if(row.row_type==="GRAND_TOTAL")return"bg-cyan-100 font-bold";
  if(row.row_type==="TOTAL")return"bg-amber-100 font-bold";
  if(row.row_type==="SUBTOTAL")return"bg-violet-100 font-semibold";
  if(row.row_type==="PROFIT_CALC")return"bg-lime-100 font-bold";
  if(row.row_type==="AMT_CALC")return"bg-slate-100";
  return"";
}
const EDITABLE_TYPES:RowType[]=["QTY_INPUT","AMT_INPUT","AMT_CALC","TOTAL","GRAND_TOTAL","PROFIT_CALC"];

// ── Component ─────────────────────────────────────────────────────────────────
export default function PnlUnifiedClient({ initialYear }:{ initialYear:number }) {
  const yearOptions=useMemo(()=>{const b=new Date().getFullYear();return Array.from({length:6},(_,i)=>b-2+i);},[]);

  const sp=useSearchParams();
  const queryYearRaw=sp.get("year") ?? sp.get("base_year");
  const queryYear =
    queryYearRaw != null && queryYearRaw.trim() !== ""
      ? Number(queryYearRaw)
      : Number.NaN;
  const initialYearFromQuery=Number.isFinite(queryYear)?queryYear:initialYear;

  const queryViewTab=sp.get("view_tab");
  const initialViewTab:ViewTab=queryViewTab==="actual"?"actual":"goal";

  const cg=sp.get("compare_goal_actual");
  const cc=sp.get("compare_crms");
  const initialCompareGoalActual = cg==="1" || cg==="true";
  const initialCompareCrms = cc==="1" || cc==="true";

  const [year,setYear]               = useState(initialYearFromQuery);
  const [viewTab,setViewTab]         = useState<ViewTab>(initialViewTab);
  const [goalEditMode,setGoalEditMode] = useState(false);
  const [sectionRows,setSectionRows] = useState<Record<DepthType,PnlRow[]>>({AR:[],AP:[],OP_COST:[],PROFIT:[]});
  const [dirty,setDirty]             = useState<Record<number,PnlRow>>({});
  const [feeOptions,setFeeOptions]   = useState<FeeOption[]>([]);
  const [loading,setLoading]         = useState(false);
  const [saving,setSaving]           = useState(false);
  const [message,setMessage]         = useState<string|null>(null);
  const [editFocus,setEditFocus]     = useState<{seq:number;key:string}|null>(null);
  const activeMonthEditorRef = useRef<{ commit: () => void } | null>(null);
  const registerActiveMonthEditor = useCallback((editor: { commit: () => void } | null) => {
    activeMonthEditorRef.current = editor;
  }, []);
  const cellAuditRef = useRef<PnlCellAuditHostRef>(null);
  const gridScrollRef = useRef<HTMLDivElement>(null);

  // 분석 열 설정 — 서버/클라이언트 hydration 오류 방지: 기본값으로 초기화 후 useEffect에서 localStorage 복원
  const [visibleAnalysis,setVisibleAnalysis] = useState<AnalysisKey[]>([]);
  const analysisCols = useMemo(()=>ANALYSIS_COLS(year).filter(c=>visibleAnalysis.includes(c.key)),[year,visibleAnalysis]);

  // 항목설정 — 기본값으로 초기화 후 useEffect에서 localStorage 복원
  const VISIBLE_META_KEY = "pnl-unified-r2-visible-meta";
  const [visibleMeta,setVisibleMeta] = useState<MetaKey[]>(["grade","row_label"]);

  // localStorage 복원 (클라이언트에서만)
  useEffect(()=>{
    try{
      const savedMeta=localStorage.getItem(VISIBLE_META_KEY);
      if(savedMeta){const p=JSON.parse(savedMeta) as MetaKey[];if(Array.isArray(p))setVisibleMeta(p);}
      const savedAnalysis=localStorage.getItem(ANALYSIS_STORAGE_KEY);
      if(savedAnalysis){const p=JSON.parse(savedAnalysis) as AnalysisKey[];if(Array.isArray(p))setVisibleAnalysis(p);}
    }catch{/*ignore*/}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);
  const [showColSetting,setShowColSetting] = useState(false);

  // 같이보기
  const [showCompareModal,setShowCompareModal]       = useState(false);
  const [compareDraftGoalActual,setCompareDraftGoalActual] = useState(false);
  const [compareDraftCrms,setCompareDraftCrms]       = useState(false);
  const [compareSavedGoalActual,setCompareSavedGoalActual] = useState(initialCompareGoalActual);
  const [compareSavedCrms,setCompareSavedCrms]       = useState(initialCompareCrms);
  const [crmsSheetBySec,setCrmsSheetBySec]           = useState<Record<DepthType,Record<number,CrmsSheetRow>>>({AR:{},AP:{},OP_COST:{},PROFIT:{}});
  const [cellNoteFlags,setCellNoteFlags]             = useState<Record<string,boolean>>({});
  const [cellHistoryFlags,setCellHistoryFlags]       = useState<Record<string,boolean>>({});
  const comparePaneActive = compareSavedGoalActual || compareSavedCrms;

  // 행추가
  const [addModal,setAddModal] = useState<{sectionKey:DepthType}|null>(null);
  const [addForm,setAddForm]   = useState<AddForm>(EMPTY_FORM);
  const [addSaving,setAddSaving] = useState(false);

  // ── Helpers ──────────────────────────────────────────────────────────────────
  const readJson = async (res:Response)=>{ const raw=await res.text(); if(!raw)return{}; try{return JSON.parse(raw) as Record<string,unknown>;}catch{return{};} };

  // ── Load rows ────────────────────────────────────────────────────────────────
  const loadAll = useCallback(async ()=>{
    setLoading(true);setMessage(null);
    try {
      const [arR,apR,opR,prR,metaR]=await Promise.all([
        fetch(`/api/pnl?year=${year}&type=AR`),fetch(`/api/pnl?year=${year}&type=AP`),
        fetch(`/api/pnl?year=${year}&type=OP_COST`),fetch(`/api/pnl?year=${year}&type=PROFIT`),
        fetch(`/api/pnl?mode=meta&viewTab=goal&depthType=AR`),
      ]);
      const [arJ,apJ,opJ,prJ,metaJ]=await Promise.all([arR,apR,opR,prR,metaR].map(readJson));
      setSectionRows({
        AR:     Array.isArray(arJ.rows)  ?(arJ.rows   as PnlRow[]):[],
        AP:     Array.isArray(apJ.rows)  ?(apJ.rows   as PnlRow[]):[],
        OP_COST:Array.isArray(opJ.rows)  ?(opJ.rows   as PnlRow[]):[],
        PROFIT: Array.isArray(prJ.rows)  ?(prJ.rows   as PnlRow[]):[],
      });
      setFeeOptions(Array.isArray(metaJ.feeOptions)?(metaJ.feeOptions as FeeOption[]):[]);
      setDirty({});
    } catch(e){setMessage(e instanceof Error?e.message:"조회 오류");}
    finally{setLoading(false);}
  },[year]);
  useEffect(()=>{void loadAll();},[loadAll]);

  // ── Load CRMS sheets ─────────────────────────────────────────────────────────
  const loadCrmsSheets = useCallback(async ()=>{
    if(!compareSavedCrms){setCrmsSheetBySec({AR:{},AP:{},OP_COST:{},PROFIT:{}});return;}
    const results=await Promise.all(
      (["AR","AP","OP_COST","PROFIT"] as DepthType[]).map(async(type)=>{
        try{
          const res=await fetch(`/api/pnl/crms-mapping?mode=sheet_grid&base_year=${year}&pnl_type=${type}`);
          const j=await readJson(res); if(!res.ok)return[type,{}] as const;
          const raw=(j.byPnlSeq as Record<string,CrmsSheetRow>)||{};
          const mapped:Record<number,CrmsSheetRow>={};
          for(const[k,v]of Object.entries(raw))mapped[Number(k)]=v;
          return[type,mapped] as const;
        }catch{return[type,{}] as const;}
      })
    );
    const out:Record<DepthType,Record<number,CrmsSheetRow>>={AR:{},AP:{},OP_COST:{},PROFIT:{}};
    for(const[t,m]of results)out[t as DepthType]=m as Record<number,CrmsSheetRow>;
    setCrmsSheetBySec(out);
  },[year,compareSavedCrms]);
  useEffect(()=>{void loadCrmsSheets();},[loadCrmsSheets]);

  // ── Cell note/history summary flags (for corner indicators) ─────────────────
  const loadCellFlags = useCallback(async ()=>{
    try{
      const types:DepthType[]=["AR","AP","OP_COST","PROFIT"];
      const responses = await Promise.all(types.map(async(type)=>{
        const res = await fetch(`/api/pnl/cell?summary=1&base_year=${year}&pnl_type=${type}`);
        const j = await readJson(res);
        return {
          flags: (j.flags && typeof j.flags==="object" && !Array.isArray(j.flags)) ? (j.flags as Record<string,boolean>) : {},
          historyFlags: (j.historyFlags && typeof j.historyFlags==="object" && !Array.isArray(j.historyFlags)) ? (j.historyFlags as Record<string,boolean>) : {},
        };
      }));
      const nextFlags:Record<string,boolean>={};
      const nextHistory:Record<string,boolean>={};
      for(const item of responses){
        Object.assign(nextFlags,item.flags);
        Object.assign(nextHistory,item.historyFlags);
      }
      setCellNoteFlags(nextFlags);
      setCellHistoryFlags(nextHistory);
    }catch{
      setCellNoteFlags({});
      setCellHistoryFlags({});
    }
  },[year]);
  useEffect(()=>{void loadCellFlags();},[loadCellFlags]);

  // ── Effective rows ───────────────────────────────────────────────────────────
  const allEffective=useMemo(()=>{
    const allRaw=(["AR","AP","OP_COST","PROFIT"] as DepthType[]).flatMap(t=>sectionRows[t]);
    // sort_order는 sectionRows 기준 유지 — dirty 의 오래된 sort_order 가 덮어쓰지 않도록
    const merged=allRaw.map(r=>{
      const d=dirty[r.pnl_seq];
      if(!d)return r;
      return{...r,...d,sort_order:r.sort_order} as PnlRow;
    });
    return computeEffective(merged,feeOptions,year);
  },[sectionRows,dirty,feeOptions,year]);

  const effectiveBySec=useMemo(()=>{
    const out:Record<DepthType,PnlRow[]>={AR:[],AP:[],OP_COST:[],PROFIT:[]};
    for(const r of allEffective)out[r.pnl_type].push(r);
    return out;
  },[allEffective]);

  // ── Compare layers ───────────────────────────────────────────────────────────
  const compareLayersForRow=(row:PnlRow,secKey:DepthType):{label:string;kind:CompareKind}[]=>{
    if(!comparePaneActive)return[{label:"",kind:"tab"}];
    const crmsOn=compareSavedCrms&&Boolean(crmsSheetBySec[secKey][row.pnl_seq]?.hasAny);
    if(compareSavedGoalActual&&crmsOn)return[{label:"목표",kind:"goal"},{label:"실적",kind:"actual"},{label:"CRMS",kind:"crms"}];
    if(compareSavedGoalActual)return[{label:"목표",kind:"goal"},{label:"실적",kind:"actual"}];
    if(crmsOn)return[{label:viewTab==="goal"?"목표":"실적",kind:"tab"},{label:"CRMS",kind:"crms"}];
    return[{label:viewTab==="goal"?"목표":"실적",kind:"tab"}];
  };

  // ── Save ─────────────────────────────────────────────────────────────────────
  const saveChanges=async()=>{
    const updates=Object.values(dirty); if(!updates.length)return;
    setSaving(true);setMessage(null);
    try{
      const res=await fetch("/api/pnl",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({updates})});
      const j=await readJson(res); if(!res.ok)throw new Error(typeof j.message==="string"?j.message:"저장 실패");
      setMessage(typeof j.message==="string"?j.message:"저장되었습니다.");
      await loadAll();
    }catch(e){setMessage(e instanceof Error?e.message:"저장 오류");}
    finally{setSaving(false);}
  };

  // ── 행 삭제 / 순서이동 / 수정 ────────────────────────────────────────────────
  const [editRowSeq,setEditRowSeq] = useState<number|null>(null);
  const [editForm,setEditForm]     = useState<AddForm>(EMPTY_FORM);
  const [showEdit,setShowEdit]     = useState(false);

  const deleteRow=async(row:PnlRow)=>{
    const label=row.row_label?.trim()||row.row_code||"이름 없음";
    if(!confirm(`이 작업은 되돌릴 수 없습니다.\n\n삭제 대상: ${label}\n행 코드: ${row.row_code}\n\n정말 DB에서 이 행을 삭제하시겠습니까?`))return;
    const res=await fetch(`/api/pnl?pnlSeq=${row.pnl_seq}`,{method:"DELETE"});
    const j=await readJson(res);
    if(!res.ok){setMessage(typeof j.message==="string"?j.message:"삭제 실패");return;}
    setMessage(typeof j.message==="string"?j.message:"삭제되었습니다.");
    await loadAll();
  };

  const sectionRowsRef=useRef(sectionRows);
  useEffect(()=>{sectionRowsRef.current=sectionRows;},[sectionRows]);

  const moveRow=(pnlSeq:number,secKey:DepthType,direction:"up"|"down")=>{
    const cur=sectionRowsRef.current;
    const secList=[...cur[secKey]].sort((a,b)=>a.sort_order-b.sort_order);
    const idx=secList.findIndex(r=>r.pnl_seq===pnlSeq);
    if(idx<0)return;
    const targetIdx=direction==="up"?idx-1:idx+1;
    if(targetIdx<0||targetIdx>=secList.length)return;
    const a=secList[idx]!;
    const b=secList[targetIdx]!;
    // 인접 두 행만 sort_order 교환 — 전체 1..N 재번호 부여하지 않음
    const swapped=secList.map((r,i)=>{
      if(i===idx)return{...a,sort_order:b.sort_order};
      if(i===targetIdx)return{...b,sort_order:a.sort_order};
      return r;
    }).sort((x,y)=>x.sort_order-y.sort_order);
    setSectionRows(prev=>({...prev,[secKey]:swapped}));
    setDirty(p=>{
      const n={...p};
      const movedA=swapped.find(r=>r.pnl_seq===a.pnl_seq)!;
      const movedB=swapped.find(r=>r.pnl_seq===b.pnl_seq)!;
      n[movedA.pnl_seq]={...(n[movedA.pnl_seq]??movedA),sort_order:movedA.sort_order} as PnlRow;
      n[movedB.pnl_seq]={...(n[movedB.pnl_seq]??movedB),sort_order:movedB.sort_order} as PnlRow;
      return n;
    });
  };

  const parseProfitTargets=(ft:string|null):{ar:string[];ap:string[]}=>{
    if(!ft)return{ar:[],ap:[]};
    try{const p=JSON.parse(ft) as {ar?:string[];ap?:string[]};return{ar:p.ar??[],ap:p.ap??[]};}
    catch{return{ar:[],ap:[]};}
  };

  const openEditModal=(row:PnlRow)=>{
    const pt=parseProfitTargets(row.formula_targets as string|null);
    setEditRowSeq(row.pnl_seq);
    setEditForm({
      grade:String(row.grade??""),category1:String(row.category1??""),
      category2:String(row.category2??""),category3:String(row.category3??""),
      biz_detail:String(row.biz_detail??""),biz_group:String(row.biz_group??""),
      client_name:String(row.client_name??""),row_label:String(row.row_label??""),
      row_type:row.row_type,
      formula_targets:String(row.formula_targets??"").split(",").map(s=>s.trim()).filter(Boolean),
      profit_ar_targets:pt.ar,profit_ap_targets:pt.ap,
      ref_qty_row_code:String(row.ref_qty_row_code??""),
      ref_unit_price_cd:String(row.ref_unit_price_cd??""),
      promo_apply_actual:Boolean(row.promo_apply_actual),
      vat_included_price:Boolean(row.vat_included_price),
    });
    setShowEdit(true);
  };

  const applyEditRow=async()=>{
    if(!editRowSeq)return;
    const cur=sectionRowsRef.current;
    let found:PnlRow|undefined;
    for(const k of ["AR","AP","OP_COST","PROFIT"] as DepthType[]){
      found=cur[k].find(r=>r.pnl_seq===editRowSeq);
      if(found)break;
    }
    if(!found)return;
    const patch={
      grade:editForm.grade||null,category1:editForm.category1||null,
      category2:editForm.category2||null,category3:editForm.category3||null,
      biz_detail:editForm.biz_detail||null,biz_group:editForm.biz_group||null,
      client_name:editForm.client_name||null,row_label:editForm.row_label||null,
      row_type:editForm.row_type,
      formula_targets:editForm.row_type==="PROFIT_CALC"
        ?JSON.stringify({ar:editForm.profit_ar_targets,ap:editForm.profit_ap_targets})
        :(editForm.row_type==="SUBTOTAL"||editForm.row_type==="TOTAL"||editForm.row_type==="GRAND_TOTAL")
          ?editForm.formula_targets.join(","):null,
      ref_qty_row_code:editForm.row_type==="AMT_CALC"?editForm.ref_qty_row_code||null:null,
      ref_unit_price_cd:editForm.row_type==="AMT_CALC"?editForm.ref_unit_price_cd||null:null,
      promo_apply_actual:editForm.row_type==="AMT_CALC"?editForm.promo_apply_actual:false,
      vat_included_price:editForm.row_type==="AMT_CALC"?editForm.vat_included_price:false,
      sort_order:found.sort_order,
    };
    const res=await fetch("/api/pnl",{method:"PUT",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({updates:[{pnl_seq:editRowSeq,...patch}]})});
    const j=await readJson(res);
    if(!res.ok){setMessage(typeof j.message==="string"?j.message:"수정 실패");return;}
    // 스크롤 위치 유지: loadAll 대신 로컬 상태만 업데이트
    const seq=editRowSeq;
    setSectionRows(prev=>{
      const next={...prev};
      for(const k of Object.keys(next) as DepthType[]){
        next[k]=next[k].map(r=>r.pnl_seq===seq?{...r,...patch} as PnlRow:r);
      }
      return next;
    });
    setDirty(p=>{const n={...p};if(n[seq])n[seq]={...n[seq],...patch} as PnlRow;return n;});
    setShowEdit(false);setEditRowSeq(null);
    setMessage("행이 수정되었습니다.");
  };

  // ── 행추가 ───────────────────────────────────────────────────────────────────
  const submitAddRow=async()=>{
    if(!addModal)return;
    setAddSaving(true);
    try{
      const payload={...addForm,baseYear:year,pnlType:addModal.sectionKey,
        formula_targets:addForm.row_type==="PROFIT_CALC"?JSON.stringify({ar:addForm.profit_ar_targets,ap:addForm.profit_ap_targets}):addForm.formula_targets.join(","),
        ref_qty_row_code:addForm.ref_qty_row_code||null,ref_unit_price_cd:addForm.ref_unit_price_cd||null};
      const res=await fetch("/api/pnl",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
      const j=await readJson(res); if(!res.ok)throw new Error(typeof j.message==="string"?j.message:"행 추가 실패");
      const created=j.row as PnlRow|undefined;
      const secKey=addModal.sectionKey;
      if(created){
        setSectionRows(prev=>({
          ...prev,
          [secKey]:[...prev[secKey],created].sort((a,b)=>a.sort_order-b.sort_order),
        }));
      }
      setAddModal(null);setAddForm(EMPTY_FORM);
      setMessage(typeof j.message==="string"?j.message:"항목이 추가되었습니다.");
    }catch(e){setMessage(e instanceof Error?e.message:"행 추가 오류");}
    finally{setAddSaving(false);}
  };

  // ── Cell edit ────────────────────────────────────────────────────────────────
  const isCellEditable=(row:PnlRow,key:string):boolean=>{
    if(comparePaneActive&&!compareSavedGoalActual)return false;
    if(isOpCostSubtotalManualRow(row)&&ACTUAL_KEYS.includes(key))return true;
    const t=row.row_type as RowType; if(!EDITABLE_TYPES.includes(t))return false;
    if(key.startsWith("t_")){if(!goalEditMode)return false; if(t==="SUBTOTAL")return false;}
    if(["AMT_CALC","SUBTOTAL","TOTAL","GRAND_TOTAL","PROFIT_CALC"].includes(t)&&row.calc_mode!=="MANUAL_OVERRIDE")return false;
    return true;
  };
  const commitDraft=useCallback((row:PnlRow,key:string,raw:string)=>{
    const num=Number(raw.replace(/,/g,"")); if(!Number.isFinite(num))return;
    setDirty((p)=>{
      const base=(p[row.pnl_seq]??row) as PnlRow;
      const next={...base,[key]:num} as PnlRow;
      if(viewTab==="actual"&&ACTUAL_KEYS.includes(key)){
        const set=parseActualExplicit(base.actual_explicit_months);
        if(isOpCostSubtotalManualRow(row)){
          set.add(key);
          next.calc_mode="MANUAL_OVERRIDE";
        }else if(row.row_type==="AMT_CALC"&&row.calc_mode==="MANUAL_OVERRIDE"){
          set.add(key);
        }else{
          if(num===0)set.add(key); else set.delete(key);
        }
        next.actual_explicit_months=explicitCsv(set);
      }
      return {...p,[row.pnl_seq]:next};
    });
  },[viewTab]);
  const focusMonthInput=(pnlSeq:number,key:string)=>{
    requestAnimationFrame(()=>{
      const el=document.querySelector(`[data-pnl-cell="${pnlCellInputId(pnlSeq,key)}"]`) as HTMLInputElement|null;
      el?.focus();
      el?.select();
    });
  };

  /** Tab / Shift+Tab 시 다음·이전 편집 가능 셀로 이동 */
  const navigateCell=useCallback((currentRow:PnlRow,currentKey:string,reverse:boolean)=>{
    // 전체 순서대로 flat 리스트 생성 (섹션 순서 유지)
    const allRows=SECTIONS.flatMap(s=>effectiveBySec[s.key]??[]);
    const keys=viewTab==="goal"?GOAL_KEYS:ACTUAL_KEYS;
    // (row, keyIndex) 편집 가능 셀 목록
    const editables: {row:PnlRow;key:string}[]=[];
    for(const r of allRows){
      for(const k of keys){
        if(isCellEditable(r,k)) editables.push({row:r,key:k});
      }
    }
    const cur=editables.findIndex(e=>e.row.pnl_seq===currentRow.pnl_seq&&e.key===currentKey);
    if(cur<0||editables.length===0)return;
    const next=reverse?(cur-1+editables.length)%editables.length:(cur+1)%editables.length;
    const {row:nr,key:nk}=editables[next]!;
    activeMonthEditorRef.current?.commit();
    setEditFocus({seq:nr.pnl_seq,key:nk});
    focusMonthInput(nr.pnl_seq,nk);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[effectiveBySec,viewTab,goalEditMode,comparePaneActive,commitDraft]);

  const rowBase=(row:PnlRow)=>(dirty[row.pnl_seq]??row) as PnlRow;
  const dirtyOrOrig=(row:PnlRow,key:string)=>toNumber(rowBase(row)[key]);

  const patchRow=useCallback((pnlSeq:number,patch:Partial<PnlRow>)=>{
    setSectionRows((prev)=>{
      const next={...prev};
      for(const sec of Object.keys(next) as DepthType[]){
        next[sec]=next[sec].map((r)=>(r.pnl_seq===pnlSeq?{...r,...patch} as PnlRow:r));
      }
      return next;
    });
  },[]);

  const buildCellAuditPayload=(row:PnlRow,key:string,monthIdx:number):PnlCellTargetPayload=>{
    const base=rowBase(row);
    return{
      pnl_seq:row.pnl_seq, cell_key:key, monthLabel:`${monthIdx+1}월`,
      cell_completion:readCellCompletion(base as { cell_completion?: unknown }),
      snap:{
        category3:base.category3, category2:base.category2,
        biz_group:base.biz_group, client_name:base.client_name,
        row_label:base.row_label, biz_detail:base.biz_detail,
        goalVal:toNumber(base[GOAL_KEYS[monthIdx]]),
        actualVal:toNumber(base[ACTUAL_KEYS[monthIdx]]),
      },
    };
  };

  // ── Layout ───────────────────────────────────────────────────────────────────
  const visibleMetaCols=META_COLS.filter(c=>visibleMeta.includes(c.key));
  const metaW=100; // px per meta col
  const compareLabelW=40;
  const showOrderActions=goalEditMode&&!comparePaneActive;
  const TOTAL_COLS=visibleMetaCols.length+(comparePaneActive?1:0)+12+analysisCols.length+(showOrderActions?2:0);

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-full min-w-0 flex-col gap-2">
      <PnlCellAuditHost ref={cellAuditRef} patchRow={patchRow} setBanner={setMessage}
        onCellNotesMutated={()=>{void loadCellFlags();}} mappingSheet={{year,pnlType:"AR"}} />
      {/* 공유 컨트롤 바 — 고정 영역 */}
      <div className="flex flex-none flex-wrap items-center gap-2">
        <h1 className="text-xl font-bold text-slate-900 shrink-0">{year}년 손익계획_R2</h1>
        <select value={year} onChange={e=>setYear(Number(e.target.value)||initialYear)}
          className="rounded border border-slate-300 bg-white px-2 py-1 text-sm">
          {yearOptions.map(y=><option key={y} value={y}>{y}년</option>)}
        </select>
        <div className="flex rounded border border-slate-300 overflow-hidden text-sm">
          {(["goal","actual"] as ViewTab[]).map(t=>(
            <button key={t} type="button" onClick={()=>setViewTab(t)}
              className={`px-3 py-1 font-medium ${viewTab===t&&!compareSavedGoalActual?"bg-indigo-600 text-white":"bg-white text-slate-600 hover:bg-slate-50"}`}>
              {t==="goal"?"목표":"실적"}
            </button>
          ))}
        </div>
        {/* 같이보기 */}
        <button type="button"
          onClick={()=>{setCompareDraftGoalActual(compareSavedGoalActual);setCompareDraftCrms(compareSavedCrms);setShowCompareModal(true);}}
          className={`rounded-md border px-3 py-1.5 text-sm font-semibold ${comparePaneActive?"border-indigo-400 bg-indigo-50 text-indigo-800":"border-slate-300 text-slate-700 hover:bg-slate-50"}`}>
          같이보기
        </button>
        {/* 항목설정 */}
        <button type="button" onClick={()=>setShowColSetting(v=>!v)}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">
          항목 설정
        </button>
        <div className="ml-auto flex items-center gap-2">
          <button type="button" onClick={()=>setGoalEditMode(v=>!v)}
            className={`rounded px-3 py-1.5 text-sm font-semibold border ${goalEditMode?"bg-amber-500 text-white border-amber-500":"bg-white text-slate-700 border-slate-300"}`}>
            목표 편집 {goalEditMode?"ON":"OFF"}
          </button>
          <button type="button" onClick={saveChanges} disabled={saving||Object.keys(dirty).length===0}
            className="rounded bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-40">
            {saving?"저장 중…":`저장 (${Object.keys(dirty).length})`}
          </button>
        </div>
      </div>

      {/* 항목설정 패널 */}
      {showColSetting&&(
        <div className="flex-none rounded-lg border border-slate-200 bg-white p-3 shadow-sm space-y-3">
          <div>
            <p className="mb-2 text-xs font-semibold text-slate-700">고정 열 (좌측 스티키)</p>
            <div className="flex flex-wrap gap-3">
              {META_COLS.map(col=>(
                <label key={col.key} className="inline-flex items-center gap-1 text-xs text-slate-700">
                  <input type="checkbox" checked={visibleMeta.includes(col.key)}
                    onChange={e=>{
                      setVisibleMeta(p=>{
                        const next=e.target.checked?[...p,col.key]:p.filter(k=>k!==col.key);
                        try{localStorage.setItem(VISIBLE_META_KEY,JSON.stringify(next));}catch{/*ignore*/}
                        return next;
                      });
                    }}/>
                  {col.label}
                </label>
              ))}
            </div>
          </div>
          <div>
            <p className="mb-2 text-xs font-semibold text-slate-700">분석 열 (월 열 우측)</p>
            <div className="flex flex-wrap gap-3">
              {ANALYSIS_COLS(year).map(col=>(
                <label key={col.key} className="inline-flex items-center gap-1 text-xs text-slate-700">
                  <input type="checkbox" checked={visibleAnalysis.includes(col.key)}
                    onChange={e=>{
                      setVisibleAnalysis(p=>{
                        const next=e.target.checked?[...p,col.key as AnalysisKey]:p.filter(k=>k!==col.key);
                        try{localStorage.setItem(ANALYSIS_STORAGE_KEY,JSON.stringify(next));}catch{/*ignore*/}
                        return next;
                      });
                    }}/>
                  {col.label}
                </label>
              ))}
            </div>
          </div>
        </div>
      )}

      {message&&(
        <p className={`flex-none rounded px-3 py-1.5 text-xs ${message.includes("오류")||message.includes("실패")?"bg-red-50 text-red-700":"bg-green-50 text-green-700"}`}>
          {message}
        </p>
      )}
      {loading&&<p className="py-4 text-center text-sm text-slate-500">불러오는 중…</p>}

      {/* ── 단일 그리드 — 남은 공간 전체 차지 + 내부 스크롤 ── */}
      {!loading&&(
        <div ref={gridScrollRef} className="min-h-0 flex-1 overflow-auto rounded-lg border border-slate-200 bg-white shadow-sm">
          <table className="border-collapse text-xs min-w-max w-full">
            <thead className="sticky top-0 z-20 bg-slate-100">
              <tr>
                {visibleMetaCols.map((col,idx)=>(
                  <th key={col.key}
                    style={{left:idx*metaW,minWidth:metaW,width:metaW}}
                    className="sticky z-30 bg-slate-100 border-b border-slate-300 px-2 py-1.5 text-left whitespace-nowrap font-semibold text-slate-700">
                    {col.label}
                  </th>
                ))}
                {analysisCols.map(col=>(
                  <th key={col.key} className="border-b border-r border-slate-300 px-2 py-1.5 text-right whitespace-nowrap font-semibold min-w-[96px] text-slate-600 bg-slate-50">
                    {col.label}
                  </th>
                ))}
                {comparePaneActive&&(
                  <th style={{minWidth:compareLabelW,width:compareLabelW}}
                    className="bg-slate-100 border-b border-l-2 border-l-slate-400 border-slate-300 px-1 py-1.5 text-center whitespace-nowrap font-semibold text-slate-700">
                    구분
                  </th>
                )}
                {MONTH_LABELS.map((m,i)=>(
                  <th key={i} className={`border-b border-slate-300 px-2 py-1.5 text-right whitespace-nowrap font-semibold min-w-[88px] ${compareSavedGoalActual?"text-slate-700":viewTab==="goal"?"text-indigo-700":"text-rose-700"}`}>
                    {comparePaneActive?m:`${m} ${viewTab==="goal"?"목표":"실적"}`}
                  </th>
                ))}
                {goalEditMode&&!comparePaneActive&&(<>
                  <th className="border-b border-l-2 border-l-amber-300 border-slate-300 px-1 py-1.5 text-center whitespace-nowrap font-semibold text-slate-600 min-w-[36px]">순서</th>
                  <th className="border-b border-slate-300 px-1 py-1.5 text-center whitespace-nowrap font-semibold text-slate-600 min-w-[48px]">편집</th>
                </>)}
              </tr>
            </thead>

            <tbody>
              {SECTIONS.map(section=>{
                const secRows=effectiveBySec[section.key]??[];
                return (
                  <>
                    {/* 섹션 헤더 */}
                    <tr key={`hdr-${section.key}`}>
                      <td colSpan={TOTAL_COLS} className={`${section.titleCls} px-3 py-1.5 text-sm font-bold`}>
                        <span className="mr-3">[ {section.label} ]</span>
                        {section.key!=="PROFIT"&&(
                          <a
                            href={`/dashboard/finance/pnl-plan-r2/crms-mapping?type=${section.key}&base_year=${year}&from=/dashboard/finance/pnl-plan-r2&view_tab=${viewTab}&compare_goal_actual=${compareSavedGoalActual?1:0}&compare_crms=${compareSavedCrms?1:0}`}
                            className="mr-2 rounded bg-white/20 px-2 py-0.5 text-xs font-normal hover:bg-white/30">매핑</a>
                        )}
                        <button type="button"
                          onClick={()=>{setAddModal({sectionKey:section.key});setAddForm(EMPTY_FORM);}}
                          className="rounded bg-white/20 px-2 py-0.5 text-xs font-normal hover:bg-white/30">행 추가</button>
                      </td>
                    </tr>

                    {secRows.length===0&&(
                      <tr key={`empty-${section.key}`}>
                        <td colSpan={TOTAL_COLS} className="py-3 text-center text-slate-400 italic text-[11px]">데이터 없음</td>
                      </tr>
                    )}

                    {secRows.map(row=>{
                      const rs=rowStyle(row);
                      const rowLabel=String(row.row_label??"");
                      const isEstimate=rowLabel.includes("추정")&&!rowLabel.includes("외")&&(["AMT_INPUT","AMT_CALC","SUBTOTAL","TOTAL","GRAND_TOTAL"] as RowType[]).includes(row.row_type);
                      const estimateCls=isEstimate?"font-bold text-red-600":"";
                      const layers=compareLayersForRow(row,section.key);
                      const subCount=layers.length;
                      return (
                        <Fragment key={row.pnl_seq}>
                          {layers.map((layer,si)=>{
                            const isFirst=si===0;
                            const subBorder=si===0?"border-t border-slate-200":"border-t border-slate-100";
                            const subEnd=comparePaneActive&&si===subCount-1&&subCount>1?"border-b-2 border-slate-300":"";
                            return (
                              <tr key={`${row.pnl_seq}-${si}`} className={`${subBorder} ${subEnd} ${rs} ${estimateCls} hover:bg-blue-50/20`}>
                                {/* Meta cols — only on first sub-row */}
                                {isFirst&&visibleMetaCols.map((col,idx)=>(
                                  <td key={col.key}
                                    style={{left:idx*metaW}}
                                    rowSpan={subCount>1?subCount:undefined}
                                    className={`sticky z-10 border-r border-slate-200 px-2 py-0.5 whitespace-nowrap truncate max-w-[160px] ${rs||"bg-white"}`}>
                                    {String(row[col.key]??"")}
                                  </td>
                                ))}

                                {/* 분석 열 — 첫 레이어에서만 rowSpan, 월 열 앞 */}
                                {isFirst&&analysisCols.map(col=>{
                                  const layers2=compareLayersForRow(row,section.key);
                                  const analysisRs=layers2.length>1?layers2.length:undefined;
                                  const tSum=GOAL_KEYS.reduce((s,k)=>s+toNumber((dirty[row.pnl_seq]??row)[k]),0);
                                  const aSum=ACTUAL_KEYS.reduce((s,k)=>s+toNumber((dirty[row.pnl_seq]??row)[k]),0);
                                  const prev=toNumber((dirty[row.pnl_seq]??row).prev_year_actual);
                                  const gap1v=tSum-prev;
                                  const gap1Rate=prev===0?0:(tSum/prev)*100;
                                  const gap2v=aSum-tSum;
                                  const gap2Rate=tSum===0?0:(aSum/tSum)*100;
                                  const cellMap:Record<string,string>={
                                    prev_year_actual:prev===0?"":fmtWon(prev),
                                    target_sum:tSum===0?"":fmtWon(tSum),
                                    actual_sum:aSum===0?"":fmtWon(aSum),
                                    gap1:gap1v===0?"":fmtWon(gap1v),
                                    gap1_rate:`${gap1Rate.toFixed(2)}%`,
                                    company_target:toNumber((dirty[row.pnl_seq]??row).company_target)===0?"":fmtWon(toNumber((dirty[row.pnl_seq]??row).company_target)),
                                    gap2:gap2v===0?"":fmtWon(gap2v),
                                    gap2_rate:`${gap2Rate.toFixed(2)}%`,
                                    base_ratio:`${toNumber((dirty[row.pnl_seq]??row).base_ratio).toFixed(2)}%`,
                                  };
                                  const isNeg=(col.key==="gap1"&&gap1v<0)||(col.key==="gap2"&&gap2v<0);
                                  return(
                                    <td key={col.key} rowSpan={analysisRs}
                                      className={`border-r border-slate-200 px-2 py-0.5 text-right tabular-nums whitespace-nowrap text-xs bg-slate-50/50 ${isNeg?"text-red-600":""}`}>
                                      {cellMap[col.key]??""}
                                    </td>
                                  );
                                })}

                                {/* 구분 col — 1월 좌측 */}
                                {comparePaneActive&&(
                                  <td style={{minWidth:compareLabelW,width:compareLabelW}}
                                    className={`border-r border-l-2 border-l-slate-400 border-slate-200 px-0.5 py-0.5 text-center text-[10px] ${rs||"bg-white"} ${layer.kind==="crms"?"font-bold text-sky-700":"font-semibold text-slate-700"}`}>
                                    {layer.label}
                                  </td>
                                )}

                                {/* Month cells */}
                                {Array.from({length:12},(_,mi)=>{
                                  const monthNum=mi+1;

                                  if(layer.kind==="crms"){
                                    const cx=crmsSheetBySec[section.key][row.pnl_seq]?.months[String(monthNum)]??null;
                                    const hasActualCompareLayer=layers.some((l)=>l.kind==="actual")
                                      ||(viewTab==="actual"&&layers.some((l)=>l.kind==="crms"));
                                    const actualForCrms=hasActualCompareLayer&&compareSavedCrms
                                      ? dirtyOrOrig(row,ACTUAL_KEYS[mi])
                                      : null;
                                    const crmsMismatch=Boolean(
                                      compareSavedCrms
                                      &&cx
                                      &&actualForCrms!=null
                                      &&Math.round(actualForCrms)!==Math.round(toNumber(cx.amount)),
                                    );
                                    return (
                                      <td key={mi} className="px-2 py-0.5 text-right tabular-nums whitespace-nowrap bg-sky-50/50 font-bold">
                                        {cx?(
                                          <span
                                            className={`font-bold tabular-nums ${crmsMismatch?"text-red-800":"text-slate-900"}`}
                                            title={crmsMismatch
                                              ? `실적 ${fmtWon(actualForCrms!)} / CRMS ${fmtWon(cx.amount)}`
                                              :[cx.col_detail,cx.col_category,cx.col_code,cx.col_client,cx.col_item].filter(Boolean).join(" · ")||undefined}
                                          >
                                            {fmtWon(cx.amount)}
                                          </span>
                                        ):<span className="text-slate-400">—</span>}
                                      </td>
                                    );
                                  }

                                  const cellKey=layer.kind==="goal"?GOAL_KEYS[mi]:layer.kind==="actual"?ACTUAL_KEYS[mi]:viewTab==="goal"?GOAL_KEYS[mi]:ACTUAL_KEYS[mi];
                                  const val=dirtyOrOrig(row,cellKey);
                                  const editable=isCellEditable(row,cellKey);
                                  const monthFocused=!comparePaneActive&&editFocus?.seq===row.pnl_seq&&editFocus?.key===cellKey;
                                  const isActualCol=layer.kind==="actual"||(layer.kind==="tab"&&viewTab==="actual");
                                  const monthCompleted=isPnlCellCompleted(rowBase(row) as { cell_completion?: unknown },cellKey);
                                  const noteFlagKey=cellNoteFlagKey(row.pnl_seq,cellKey);
                                  const hasCellNotes=Boolean(cellNoteFlags[noteFlagKey]);
                                  const hasCellHistory=Boolean(cellHistoryFlags[noteFlagKey]);
                                  return (
                                    <td key={mi} className={`relative p-0 ${Boolean(isActualCol&&compareSavedGoalActual)?"bg-rose-50/20":""}`}>
                                      {hasCellHistory ? (
                                        <span
                                          className="pointer-events-none absolute left-0 top-0 z-[2] border-r-[6px] border-r-transparent border-t-[6px] border-t-emerald-600 drop-shadow-[0_0_1px_rgba(0,0,0,0.35)]"
                                          title="타임라인 이력 있음"
                                          aria-hidden
                                        />
                                      ) : null}
                                      {hasCellNotes ? (
                                        <span
                                          className="pointer-events-none absolute right-0 top-0 z-[2] border-l-[6px] border-l-transparent border-t-[6px] border-t-red-500 drop-shadow-[0_0_1px_rgba(0,0,0,0.35)]"
                                          title="비고 있음"
                                          aria-hidden
                                        />
                                      ) : null}
                                      <PnlMonthInput
                                        pnlSeq={row.pnl_seq}
                                        cellKey={cellKey}
                                        val={val}
                                        editable={editable}
                                        focused={monthFocused}
                                        isEstimate={isEstimate}
                                        isActualCol={false}
                                        cellCompleted={monthCompleted}
                                        onCommit={(raw)=>commitDraft(row,cellKey,raw)}
                                        onFocusCell={()=>setEditFocus({seq:row.pnl_seq,key:cellKey})}
                                        onBlurCell={()=>setEditFocus(null)}
                                        onTab={(reverse)=>navigateCell(row,cellKey,reverse)}
                                        registerActiveEditor={registerActiveMonthEditor}
                                        onContextMenu={(e)=>{
                                          e.preventDefault();e.stopPropagation();
                                          cellAuditRef.current?.openContextMenu(e,buildCellAuditPayload(row,cellKey,mi));
                                        }}
                                      />
                                    </td>
                                  );
                                })}

                                {/* 순서/편집 버튼 — 첫 레이어에만 rowSpan */}
                                {showOrderActions&&isFirst&&(()=>{
                                  const secRows=effectiveBySec[section.key];
                                  const rowIdx=secRows.indexOf(row);
                                  const rs=layers.length>1?layers.length:undefined;
                                  return(<>
                                    <td rowSpan={rs} className="border-l-2 border-l-amber-300 border-slate-200 px-1 py-0.5 text-center">
                                      <div className="inline-flex flex-col items-center gap-0 leading-none">
                                        <button type="button" onClick={()=>moveRow(row.pnl_seq,section.key,"up")}
                                          disabled={rowIdx===0}
                                          className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-sm border border-slate-300 bg-white p-0 text-[8px] leading-none text-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
                                          title="위로 이동">▲</button>
                                        <button type="button" onClick={()=>moveRow(row.pnl_seq,section.key,"down")}
                                          disabled={rowIdx===secRows.length-1}
                                          className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-sm border border-slate-300 bg-white p-0 text-[8px] leading-none text-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
                                          title="아래로 이동">▼</button>
                                      </div>
                                    </td>
                                    <td rowSpan={rs} className="px-1 py-0.5 text-center">
                                      <button type="button" onClick={()=>openEditModal(row)}
                                        className="mr-0.5 inline-flex h-4.5 w-4.5 items-center justify-center rounded border border-indigo-200 bg-indigo-50 p-0 text-[9px] text-indigo-600 hover:bg-indigo-100"
                                        title="행 수정">✎</button>
                                      <button type="button" onClick={()=>deleteRow(row)}
                                        className="inline-flex h-4.5 w-4.5 items-center justify-center rounded border border-rose-200 bg-rose-50 p-0 text-[9px] text-rose-600 hover:bg-rose-100"
                                        title="행 삭제">✕</button>
                                    </td>
                                  </>);
                                })()}
                                            </tr>
                                          );
                                        })}
                                      </Fragment>
                                    );
                                  })}
                                </>
                              );
                            })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── 같이보기 모달 ── */}
      {showCompareModal&&(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={()=>setShowCompareModal(false)}>
          <div className="w-full max-w-md rounded-lg bg-white p-4 shadow-lg" onClick={e=>e.stopPropagation()}>
            <h3 className="mb-3 text-base font-bold text-slate-900">같이보기</h3>
            <div className="space-y-2 text-sm text-slate-800">
              <label className="flex cursor-pointer items-center gap-2">
                <input type="checkbox" checked={compareDraftGoalActual} onChange={e=>setCompareDraftGoalActual(e.target.checked)}/>
                실적/목표 같이보기
              </label>
              <label className="flex cursor-pointer items-center gap-2">
                <input type="checkbox" checked={compareDraftCrms} onChange={e=>setCompareDraftCrms(e.target.checked)}/>
                CRMS 같이보기
              </label>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className="rounded border border-slate-300 px-3 py-1.5 text-sm" onClick={()=>setShowCompareModal(false)}>취소</button>
              <button type="button" className="rounded bg-slate-900 px-3 py-1.5 text-sm font-semibold text-white"
                onClick={()=>{setCompareSavedGoalActual(compareDraftGoalActual);setCompareSavedCrms(compareDraftCrms);setShowCompareModal(false);}}>
                저장
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 행추가 모달 ── */}
      {addModal&&(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={()=>setAddModal(null)}>
          <div className="w-full max-w-3xl rounded-lg bg-white p-4 shadow-xl" onClick={e=>e.stopPropagation()}>
            <h3 className="mb-3 text-sm font-bold">행 추가 — {SECTIONS.find(s=>s.key===addModal.sectionKey)?.label}</h3>
            <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-4">
              {([["grade","등급"],["category1","계정과목"],["category2","구분"],["category3","사업상세"],["biz_detail","사업구분"],["biz_group","코드"],["client_name","거래처"],["row_label","항목"]] as const).map(([k,lbl])=>(
                <label key={k} className="text-[11px] font-medium text-slate-600">
                  {lbl}<input value={addForm[k as keyof AddForm] as string} onChange={e=>setAddForm(p=>({...p,[k]:e.target.value}))}
                    className="mt-1 h-8 w-full rounded border border-slate-300 px-2 text-sm outline-none focus:border-indigo-400"/>
                </label>
              ))}
              <label className="text-[11px] font-medium text-slate-600">
                행 타입
                <select value={addForm.row_type}
                  onChange={e=>setAddForm(p=>({...p,row_type:e.target.value as RowType,formula_targets:[],profit_ar_targets:[],profit_ap_targets:[],ref_qty_row_code:"",ref_unit_price_cd:""}))}
                  className="mt-1 h-8 w-full rounded border border-slate-300 px-2 text-sm outline-none focus:border-indigo-400">
                  <option value="QTY_INPUT">개수 입력 행</option>
                  <option value="AMT_INPUT">금액 입력 행</option>
                  <option value="AMT_CALC">금액 계산 행</option>
                  <option value="SUBTOTAL">소계 계산 행</option>
                  <option value="TOTAL">합계 계산 행</option>
                  <option value="GRAND_TOTAL">총계 계산 행</option>
                  <option value="PROFIT_CALC">영업이익 계산 행</option>
                </select>
              </label>
              {addForm.row_type==="AMT_CALC"&&(<>
                <label className="text-[11px] font-medium text-slate-600">참조 개수행
                  <select value={addForm.ref_qty_row_code} onChange={e=>setAddForm(p=>({...p,ref_qty_row_code:e.target.value}))}
                    className="mt-1 h-8 w-full rounded border border-slate-300 px-2 text-sm outline-none focus:border-indigo-400">
                    <option value="">선택</option>
                    {(effectiveBySec[addModal.sectionKey]??[]).filter(r=>r.row_type==="QTY_INPUT").map(r=>(
                      <option key={r.row_code} value={r.row_code}>{r.row_label??r.row_code}</option>
                    ))}
                  </select>
                </label>
                <label className="text-[11px] font-medium text-slate-600">참조 단가
                  <select value={addForm.ref_unit_price_cd} onChange={e=>setAddForm(p=>({...p,ref_unit_price_cd:e.target.value}))}
                    className="mt-1 h-8 w-full rounded border border-slate-300 px-2 text-sm outline-none focus:border-indigo-400">
                    <option value="">선택</option>
                    {feeOptions.map(f=><option key={f.code} value={f.code}>{f.label} ({f.unitPrice.toLocaleString()})</option>)}
                  </select>
                </label>
              </>)}
              {(addForm.row_type==="SUBTOTAL"||addForm.row_type==="TOTAL")&&(
                <label className="text-[11px] font-medium text-slate-600 sm:col-span-3 lg:col-span-4">계산 대상 행
                  <div className="mt-1 max-h-28 overflow-auto rounded border border-slate-300 p-2">
                    {(effectiveBySec[addModal.sectionKey]??[]).map(row=>(
                      <label key={row.row_code} className="mr-3 inline-flex items-center gap-1 text-[11px] font-normal text-slate-700">
                        <input type="checkbox" checked={addForm.formula_targets.includes(row.row_code)}
                          onChange={e=>setAddForm(p=>({...p,formula_targets:e.target.checked?[...p.formula_targets,row.row_code]:p.formula_targets.filter(c=>c!==row.row_code)}))}/>
                        {row.row_label??row.row_code}
                      </label>
                    ))}
                  </div>
                </label>
              )}
              {addForm.row_type==="GRAND_TOTAL"&&(
                <div className="text-[11px] font-medium text-slate-600 sm:col-span-3 lg:col-span-4">
                  <p className="mb-1">계산 대상 행 <span className="text-[10px] font-normal text-slate-400">(AR · AP · 부서운영비 · 현재 섹션)</span></p>
                  <div className="max-h-40 overflow-auto rounded border border-slate-300 p-2">
                    {[
                      {label:"AR (매출)",    rows:effectiveBySec.AR??[]},
                      {label:"AP (매입)",    rows:effectiveBySec.AP??[]},
                      {label:"부서운영비",   rows:effectiveBySec.OP_COST??[]},
                      {label:"현재 섹션",    rows:(addModal.sectionKey==="AR"||addModal.sectionKey==="AP"||addModal.sectionKey==="OP_COST")?[]:effectiveBySec[addModal.sectionKey]??[]},
                    ].filter(g=>g.rows.length>0).map(group=>(
                      <div key={group.label} className="mb-2">
                        <p className="mb-0.5 text-[10px] font-semibold text-slate-500">{group.label}</p>
                        <div className="flex flex-wrap gap-x-3">
                          {group.rows.map(row=>(
                            <label key={row.row_code} className="inline-flex items-center gap-1 text-[11px] font-normal text-slate-700">
                              <input type="checkbox" checked={addForm.formula_targets.includes(row.row_code)}
                                onChange={e=>setAddForm(p=>({...p,formula_targets:e.target.checked?[...p.formula_targets,row.row_code]:p.formula_targets.filter(c=>c!==row.row_code)}))}/>
                              {row.row_label??row.row_code}
                            </label>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {addForm.row_type==="PROFIT_CALC"&&(<>
                <div className="sm:col-span-3 lg:col-span-2">
                  <p className="text-[11px] font-medium text-slate-600 mb-1">합계할 행 <span className="text-[10px] text-slate-400">(AR 매출 · AP 추정)</span></p>
                  <div className="max-h-32 overflow-auto rounded border border-slate-300 p-2">
                    {(()=>{
                      const apEstimate=effectiveBySec.AP.filter(r=>{
                        const lbl=String(r.row_label??"");
                        return lbl.includes("추정")&&!lbl.includes("외");
                      });
                      const groups=[
                        {label:"AR (매출)",rows:effectiveBySec.AR},
                        ...(apEstimate.length>0?[{label:"AP 추정",rows:apEstimate}]:[]),
                      ];
                      return groups.map(group=>(
                        <div key={group.label} className="mb-1">
                          <p className="text-[10px] font-semibold text-slate-500 mb-0.5">{group.label}</p>
                          {group.rows.map(row=>(
                            <label key={`sum-${row.row_code}`} className="mr-3 inline-flex items-center gap-1 text-[11px] font-normal text-slate-700">
                              <input type="checkbox" checked={addForm.profit_ar_targets.includes(row.row_code)}
                                onChange={e=>setAddForm(p=>({...p,profit_ar_targets:e.target.checked?[...p.profit_ar_targets,row.row_code]:p.profit_ar_targets.filter(c=>c!==row.row_code)}))}/>
                              <span className={(() => {
                                const lbl=String(row.row_label??"");
                                return lbl.includes("추정")&&!lbl.includes("외") ? "text-red-600 font-semibold" : "";
                              })()}>{row.row_label??row.row_code}</span>
                            </label>
                          ))}
                        </div>
                      ));
                    })()}
                  </div>
                </div>
                <div className="sm:col-span-3 lg:col-span-2">
                  <p className="text-[11px] font-medium text-slate-600 mb-1">차감할 행 <span className="text-[10px] text-slate-400">(AP · 부서운영비 · AR 추정항목)</span></p>
                  <div className="max-h-32 overflow-auto rounded border border-slate-300 p-2">
                    {(()=>{
                      const arEstimate=effectiveBySec.AR.filter(r=>{
                        const lbl=String(r.row_label??"");
                        return lbl.includes("추정")&&!lbl.includes("외");
                      });
                      const groups=[
                        {label:"AP (매입)",rows:effectiveBySec.AP},
                        {label:"부서운영비",rows:effectiveBySec.OP_COST},
                        ...(arEstimate.length>0?[{label:"AR 추정",rows:arEstimate}]:[]),
                        ...(addModal.sectionKey!=="AR"&&addModal.sectionKey!=="AP"&&addModal.sectionKey!=="OP_COST"?[{label:"현재 섹션",rows:effectiveBySec[addModal.sectionKey]}]:[]),
                      ].filter(g=>g.rows.length>0);
                      return groups.map(group=>(
                        <div key={group.label} className="mb-1">
                          <p className="text-[10px] font-semibold text-slate-500 mb-0.5">{group.label}</p>
                          {group.rows.map(row=>(
                            <label key={`sub-${row.row_code}`} className="mr-3 inline-flex items-center gap-1 text-[11px] font-normal text-slate-700">
                              <input type="checkbox" checked={addForm.profit_ap_targets.includes(row.row_code)}
                                onChange={e=>setAddForm(p=>({...p,profit_ap_targets:e.target.checked?[...p.profit_ap_targets,row.row_code]:p.profit_ap_targets.filter(c=>c!==row.row_code)}))}/>
                              <span className={(() => {
                                const lbl=String(row.row_label??"");
                                return lbl.includes("추정")&&!lbl.includes("외") ? "text-red-600 font-semibold" : "";
                              })()}>{row.row_label??row.row_code}</span>
                            </label>
                          ))}
                        </div>
                      ));
                    })()}
                  </div>
                </div>
              </>)}
            </div>
            <div className="mt-3 flex justify-end gap-2">
              <button type="button" onClick={()=>setAddModal(null)} className="rounded border border-slate-300 px-3 py-1 text-xs">취소</button>
              <button type="button" onClick={submitAddRow} disabled={addSaving}
                className="rounded bg-indigo-600 px-3 py-1 text-xs font-semibold text-white disabled:opacity-40">
                {addSaving?"추가 중…":"저장"}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* ── 행 수정 모달 ── */}
      {showEdit&&(
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-auto bg-black/30 p-4" onClick={()=>setShowEdit(false)}>
          <div className="w-full max-w-xl rounded-lg bg-white p-5 shadow-xl" onClick={e=>e.stopPropagation()}>
            <h3 className="mb-4 text-sm font-bold text-slate-900">행 수정</h3>
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
              <div><label className="mb-0.5 block text-[11px] font-medium text-slate-600">등급</label>
                <input className="w-full rounded border border-slate-300 px-2 py-1 text-xs" value={editForm.grade} onChange={e=>setEditForm(p=>({...p,grade:e.target.value}))}/></div>
              <div><label className="mb-0.5 block text-[11px] font-medium text-slate-600">항목명</label>
                <input className="w-full rounded border border-slate-300 px-2 py-1 text-xs" value={editForm.row_label} onChange={e=>setEditForm(p=>({...p,row_label:e.target.value}))}/></div>
              <div><label className="mb-0.5 block text-[11px] font-medium text-slate-600">계정과목(1)</label>
                <input className="w-full rounded border border-slate-300 px-2 py-1 text-xs" value={editForm.category1} onChange={e=>setEditForm(p=>({...p,category1:e.target.value}))}/></div>
              <div><label className="mb-0.5 block text-[11px] font-medium text-slate-600">계정과목(2)</label>
                <input className="w-full rounded border border-slate-300 px-2 py-1 text-xs" value={editForm.category2} onChange={e=>setEditForm(p=>({...p,category2:e.target.value}))}/></div>
              <div><label className="mb-0.5 block text-[11px] font-medium text-slate-600">거래처</label>
                <input className="w-full rounded border border-slate-300 px-2 py-1 text-xs" value={editForm.client_name} onChange={e=>setEditForm(p=>({...p,client_name:e.target.value}))}/></div>
              <div><label className="mb-0.5 block text-[11px] font-medium text-slate-600">사업그룹</label>
                <input className="w-full rounded border border-slate-300 px-2 py-1 text-xs" value={editForm.biz_group} onChange={e=>setEditForm(p=>({...p,biz_group:e.target.value}))}/></div>
              <div><label className="mb-0.5 block text-[11px] font-medium text-slate-600">사업상세</label>
                <input className="w-full rounded border border-slate-300 px-2 py-1 text-xs" value={editForm.biz_detail} onChange={e=>setEditForm(p=>({...p,biz_detail:e.target.value}))}/></div>
              <div><label className="mb-0.5 block text-[11px] font-medium text-slate-600">행 유형</label>
                <select className="w-full rounded border border-slate-300 px-2 py-1 text-xs" value={editForm.row_type} onChange={e=>setEditForm(p=>({...p,row_type:e.target.value as RowType,formula_targets:[],profit_ar_targets:[],profit_ap_targets:[],ref_qty_row_code:"",ref_unit_price_cd:""}))}>
                  <option value="QTY_INPUT">개수 입력 행</option>
                  <option value="AMT_INPUT">금액 입력 행</option>
                  <option value="AMT_CALC">금액 계산 행</option>
                  <option value="SUBTOTAL">소계 계산 행</option>
                  <option value="TOTAL">합계 계산 행</option>
                  <option value="GRAND_TOTAL">총계 계산 행</option>
                  <option value="PROFIT_CALC">영업이익 계산 행</option>
                </select></div>
              {editForm.row_type==="AMT_CALC"&&(<>
                <div><label className="mb-0.5 block text-[11px] font-medium text-slate-600">참조 수량 행 코드</label>
                  <input className="w-full rounded border border-slate-300 px-2 py-1 text-xs" value={editForm.ref_qty_row_code} onChange={e=>setEditForm(p=>({...p,ref_qty_row_code:e.target.value}))}/></div>
                <div><label className="mb-0.5 block text-[11px] font-medium text-slate-600">단가 코드</label>
                  <input className="w-full rounded border border-slate-300 px-2 py-1 text-xs" value={editForm.ref_unit_price_cd} onChange={e=>setEditForm(p=>({...p,ref_unit_price_cd:e.target.value}))}/></div>
                <label className="col-span-2 inline-flex items-center gap-2 text-xs">
                  <input type="checkbox" checked={editForm.promo_apply_actual} onChange={e=>setEditForm(p=>({...p,promo_apply_actual:e.target.checked}))}/>
                  실적에 프로모션 적용
                </label>
                <label className="col-span-2 inline-flex items-center gap-2 text-xs">
                  <input type="checkbox" checked={editForm.vat_included_price} onChange={e=>setEditForm(p=>({...p,vat_included_price:e.target.checked}))}/>
                  단가에 VAT 포함
                </label>
              </>)}
              {(editForm.row_type==="SUBTOTAL"||editForm.row_type==="TOTAL"||editForm.row_type==="GRAND_TOTAL")&&(
                <div className="col-span-2">
                  <p className="mb-0.5 text-[11px] font-medium text-slate-600">계산 대상 행 코드</p>
                  <div className="max-h-32 overflow-auto rounded border border-slate-300 p-2">
                    {[{label:"AR",rows:effectiveBySec.AR},{label:"AP",rows:effectiveBySec.AP},{label:"부서운영비",rows:effectiveBySec.OP_COST}].filter(g=>g.rows.length>0).map(group=>(
                      <div key={group.label} className="mb-1">
                        <p className="mb-0.5 text-[10px] font-semibold text-slate-500">{group.label}</p>
                        {group.rows.map(row=>(
                          <label key={row.row_code} className="mr-3 inline-flex items-center gap-1 text-[11px]">
                            <input type="checkbox" checked={editForm.formula_targets.includes(row.row_code)}
                              onChange={e=>setEditForm(p=>({...p,formula_targets:e.target.checked?[...p.formula_targets,row.row_code]:p.formula_targets.filter(c=>c!==row.row_code)}))}/>
                            {row.row_label??row.row_code}
                          </label>
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {editForm.row_type==="PROFIT_CALC"&&(<>
                <div className="col-span-2">
                  <p className="mb-0.5 text-[11px] font-medium text-slate-600">합계할 행 <span className="text-[10px] text-slate-400">(AR 매출 · AP 추정)</span></p>
                  <div className="max-h-28 overflow-auto rounded border border-slate-300 p-2">
                    {(()=>{
                      const apEst=effectiveBySec.AP.filter(r=>{
                        const lbl=String(r.row_label??"");
                        return lbl.includes("추정")&&!lbl.includes("외");
                      });
                      return[
                        {label:"AR (매출)",rows:effectiveBySec.AR},
                        ...(apEst.length>0?[{label:"AP 추정",rows:apEst}]:[]),
                      ].map(group=>(
                        <div key={group.label} className="mb-1">
                          <p className="mb-0.5 text-[10px] font-semibold text-slate-500">{group.label}</p>
                          {group.rows.map(row=>(
                            <label key={`esum-${row.row_code}`} className="mr-3 inline-flex items-center gap-1 text-[11px] font-normal text-slate-700">
                              <input type="checkbox" checked={editForm.profit_ar_targets.includes(row.row_code)}
                                onChange={e=>setEditForm(p=>({...p,profit_ar_targets:e.target.checked?[...p.profit_ar_targets,row.row_code]:p.profit_ar_targets.filter(c=>c!==row.row_code)}))}/>
                              <span className={(() => {
                                const lbl=String(row.row_label??"");
                                return lbl.includes("추정")&&!lbl.includes("외") ? "text-red-600 font-semibold" : "";
                              })()}>{row.row_label??row.row_code}</span>
                            </label>
                          ))}
                        </div>
                      ));
                    })()}
                  </div>
                </div>
                <div className="col-span-2">
                  <p className="mb-0.5 text-[11px] font-medium text-slate-600">차감할 행 <span className="text-[10px] text-slate-400">(AP · 부서운영비 · AR 추정항목)</span></p>
                  <div className="max-h-28 overflow-auto rounded border border-slate-300 p-2">
                    {(()=>{
                      const arEst=effectiveBySec.AR.filter(r=>{
                        const lbl=String(r.row_label??"");
                        return lbl.includes("추정")&&!lbl.includes("외");
                      });
                      return[
                        {label:"AP (매입)",rows:effectiveBySec.AP},
                        {label:"부서운영비",rows:effectiveBySec.OP_COST},
                        ...(arEst.length>0?[{label:"AR 추정",rows:arEst}]:[]),
                      ].filter(g=>g.rows.length>0).map(group=>(
                        <div key={group.label} className="mb-1">
                          <p className="mb-0.5 text-[10px] font-semibold text-slate-500">{group.label}</p>
                          {group.rows.map(row=>(
                            <label key={`esub-${row.row_code}`} className="mr-3 inline-flex items-center gap-1 text-[11px] font-normal text-slate-700">
                              <input type="checkbox" checked={editForm.profit_ap_targets.includes(row.row_code)}
                                onChange={e=>setEditForm(p=>({...p,profit_ap_targets:e.target.checked?[...p.profit_ap_targets,row.row_code]:p.profit_ap_targets.filter(c=>c!==row.row_code)}))}/>
                              <span className={(() => {
                                const lbl=String(row.row_label??"");
                                return lbl.includes("추정")&&!lbl.includes("외") ? "text-red-600 font-semibold" : "";
                              })()}>{row.row_label??row.row_code}</span>
                            </label>
                          ))}
                        </div>
                      ));
                    })()}
                  </div>
                </div>
              </>)}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={()=>setShowEdit(false)} className="rounded border border-slate-300 px-3 py-1 text-xs">취소</button>
              <button type="button" onClick={()=>void applyEditRow()} className="rounded bg-indigo-600 px-3 py-1 text-xs font-semibold text-white">저장</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
