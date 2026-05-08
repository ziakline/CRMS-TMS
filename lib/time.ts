const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

function toKstDate(input: Date | string) {
  const date = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(date.getTime())) return null;
  return new Date(date.getTime() + KST_OFFSET_MS);
}

export function formatKstDateTime(input: Date | string, withSeconds = false) {
  const kstDate = toKstDate(input);
  if (!kstDate) return "-";

  const yyyy = kstDate.getUTCFullYear();
  const mm = String(kstDate.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(kstDate.getUTCDate()).padStart(2, "0");
  const hh = String(kstDate.getUTCHours()).padStart(2, "0");
  const min = String(kstDate.getUTCMinutes()).padStart(2, "0");
  const sec = String(kstDate.getUTCSeconds()).padStart(2, "0");

  return withSeconds
    ? `${yyyy}. ${mm}. ${dd}. ${hh}:${min}:${sec}`
    : `${yyyy}. ${mm}. ${dd}. ${hh}:${min}`;
}
