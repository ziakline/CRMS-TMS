"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

type YearSelectProps = {
  selectedYear: number;
  startYear?: number;
  endYear?: number;
};

export default function YearSelect({ selectedYear, startYear = 2022, endYear }: YearSelectProps) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const currentYear = new Date().getFullYear();
  const maxYear = endYear ?? currentYear;

  const years: number[] = [];
  for (let year = maxYear; year >= startYear; year -= 1) {
    years.push(year);
  }

  const onChangeYear = (nextYear: number) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("year", String(nextYear));
    router.push(`${pathname}?${params.toString()}`);
  };

  return (
    <label className="inline-flex items-center gap-2 text-sm text-slate-700">
      <span className="font-medium">조회연도</span>
      <select
        value={selectedYear}
        onChange={(event) => onChangeYear(Number(event.target.value))}
        className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800"
      >
        {years.map((year) => (
          <option key={year} value={year}>
            {year}년
          </option>
        ))}
      </select>
    </label>
  );
}
