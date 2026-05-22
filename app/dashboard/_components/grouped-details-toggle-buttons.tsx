"use client";

import { useEffect, useState } from "react";

type Props = {
  /** `section` 등 래퍼 요소의 `id` — 그 안의 모든 `details`에 `open` 적용 */
  sectionId: string;
};

export default function GroupedDetailsToggleButtons({ sectionId }: Props) {
  // SSR과 초기 클라이언트 렌더 모두 동일한 값("펼치기·접기")을 사용해 hydration 불일치를 방지
  const [label, setLabel] = useState("펼치기·접기");

  const syncLabel = () => {
    const root = document.getElementById(sectionId);
    const details = [...(root?.querySelectorAll("details") ?? [])] as HTMLDetailsElement[];
    if (details.length === 0) return;
    setLabel(details.every((d) => d.open) ? "접기" : "펼치기");
  };

  // 마운트 후 실제 DOM 상태를 읽어 레이블 동기화
  useEffect(() => {
    syncLabel();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sectionId]);

  const toggle = () => {
    const root = document.getElementById(sectionId);
    const details = [...(root?.querySelectorAll("details") ?? [])] as HTMLDetailsElement[];
    if (details.length === 0) return;
    const allOpen = details.every((d) => d.open);
    const next = !allOpen;
    details.forEach((d) => {
      d.open = next;
    });
    setLabel(next ? "접기" : "펼치기");
  };

  return (
    <button
      type="button"
      onClick={toggle}
      title="모든 사업그룹을 한 번에 펼치거나 접습니다."
      className="shrink-0 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
    >
      {label}
    </button>
  );
}
