import { getServerSession } from "next-auth";
import { authOptions } from "../../../../lib/auth-options";
import { prisma } from "../../../../lib/prisma";

/**
 * POST /api/admin/dedup-ar-ap
 * DB에 source_id 중복 AR/AP 레코드가 있을 경우, 낮은 ar_seq/ap_seq(구 레코드)를 is_deleted:"Y"로 표시합니다.
 * CRMS에서 issue_dt가 변경되면 크롤러가 새 레코드를 생성하여 중복이 발생할 수 있습니다.
 */
export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return Response.json({ message: "인증이 필요합니다." }, { status: 401 });
  }

  // AR 중복 처리
  const allAr = await prisma.ar.findMany({
    where: { is_deleted: "N" },
    select: { ar_seq: true, project_cd: true, source_id: true },
    orderBy: { ar_seq: "asc" },
  });

  const arByKey = new Map<string, { ar_seq: number }[]>();
  for (const row of allAr) {
    if (!row.source_id) continue;
    const k = `${row.project_cd}|${row.source_id}`;
    if (!arByKey.has(k)) arByKey.set(k, []);
    arByKey.get(k)!.push({ ar_seq: row.ar_seq });
  }

  const arToDelete: number[] = [];
  for (const [, items] of arByKey) {
    if (items.length <= 1) continue;
    const sorted = [...items].sort((a, b) => b.ar_seq - a.ar_seq);
    // 가장 높은 ar_seq(최신)를 제외한 나머지 소프트 삭제
    for (const item of sorted.slice(1)) {
      arToDelete.push(item.ar_seq);
    }
  }

  // AP 중복 처리
  const allAp = await prisma.ap.findMany({
    where: { is_deleted: "N" },
    select: { ap_seq: true, project_cd: true, source_id: true },
    orderBy: { ap_seq: "asc" },
  });

  const apByKey = new Map<string, { ap_seq: number }[]>();
  for (const row of allAp) {
    if (!row.source_id) continue;
    const k = `${row.project_cd}|${row.source_id}`;
    if (!apByKey.has(k)) apByKey.set(k, []);
    apByKey.get(k)!.push({ ap_seq: row.ap_seq });
  }

  const apToDelete: number[] = [];
  for (const [, items] of apByKey) {
    if (items.length <= 1) continue;
    const sorted = [...items].sort((a, b) => b.ap_seq - a.ap_seq);
    for (const item of sorted.slice(1)) {
      apToDelete.push(item.ap_seq);
    }
  }

  let arDeleted = 0;
  let apDeleted = 0;

  if (arToDelete.length > 0) {
    const result = await prisma.ar.updateMany({
      where: { ar_seq: { in: arToDelete } },
      data: { is_deleted: "Y" },
    });
    arDeleted = result.count;
  }

  if (apToDelete.length > 0) {
    const result = await prisma.ap.updateMany({
      where: { ap_seq: { in: apToDelete } },
      data: { is_deleted: "Y" },
    });
    apDeleted = result.count;
  }

  return Response.json(
    {
      message: `중복 제거 완료: AR ${arDeleted}건, AP ${apDeleted}건 소프트 삭제`,
      ar_deleted: arDeleted,
      ap_deleted: apDeleted,
    },
    { status: 200 },
  );
}
