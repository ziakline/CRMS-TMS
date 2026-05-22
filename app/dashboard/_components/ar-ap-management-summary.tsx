type ArApManagementSummaryProps = {
  module: "ar" | "ap";
  selectedYear: number;
  totalAmount: number;
  pendingAmount?: number;
  latestSyncText: string;
};

function formatWon(n: number) {
  return `${n.toLocaleString("ko-KR")}원`;
}

export default function ArApManagementSummary({
  module,
  selectedYear,
  totalAmount,
  pendingAmount,
  latestSyncText,
}: ArApManagementSummaryProps) {
  const totalLabel = module === "ar" ? "총 매출" : "총 매입";
  const pendingLabel = module === "ar" ? "미청구" : "미지급";
  const tone = module === "ar" ? "border-blue-200 bg-blue-50/80" : "border-rose-200 bg-rose-50/80";
  const accent = module === "ar" ? "text-blue-900" : "text-rose-900";
  const pendingAccent = "text-amber-700";

  return (
    <div
      className={`mb-4 flex flex-wrap items-baseline gap-x-8 gap-y-2 rounded-lg border px-4 py-2.5 text-sm ${tone}`}
    >
      <p className="text-slate-700">
        <span className="font-medium">{selectedYear}년 {totalLabel} 합계</span>
        <span className={`ml-2 text-base font-bold tabular-nums ${accent}`}>{formatWon(totalAmount)}</span>
      </p>
      {pendingAmount !== undefined && (
        <p className="text-slate-700">
          <span className="font-medium">{pendingLabel} (대기)</span>
          <span className={`ml-2 text-base font-bold tabular-nums ${pendingAccent}`}>{formatWon(pendingAmount)}</span>
          {totalAmount > 0 && (
            <span className="ml-1 text-xs text-slate-500">
              ({Math.round((pendingAmount / totalAmount) * 100)}%)
            </span>
          )}
        </p>
      )}
      <p className="text-slate-700">
        <span className="font-medium">최신 정보 조회</span>
        <span className="ml-2 font-semibold tabular-nums text-slate-900">{latestSyncText}</span>
      </p>
    </div>
  );
}
