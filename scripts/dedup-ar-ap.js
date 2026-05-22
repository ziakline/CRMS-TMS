const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function run() {
  // AR 중복 처리
  const allAr = await prisma.ar.findMany({
    where: { is_deleted: "N" },
    select: { ar_seq: true, project_cd: true, source_id: true, amount: true, biz_group_nm: true },
    orderBy: { ar_seq: "asc" },
  });

  const arByKey = new Map();
  for (const row of allAr) {
    if (!row.source_id) continue;
    const k = row.project_cd + "|" + row.source_id;
    if (!arByKey.has(k)) arByKey.set(k, []);
    arByKey.get(k).push(row);
  }

  const arToDelete = [];
  for (const [k, items] of arByKey) {
    if (items.length <= 1) continue;
    const sorted = [...items].sort((a, b) => b.ar_seq - a.ar_seq);
    console.log(
      "AR 중복:",
      k,
      "/ 건수:",
      items.length,
      "/ 금액:",
      items.map((i) => Number(i.amount)).join(" + "),
      "/ 그룹:",
      items[0].biz_group_nm,
    );
    for (const item of sorted.slice(1)) arToDelete.push(item.ar_seq);
  }

  // AP 중복 처리
  const allAp = await prisma.ap.findMany({
    where: { is_deleted: "N" },
    select: { ap_seq: true, project_cd: true, source_id: true, amount: true, biz_group_nm: true },
    orderBy: { ap_seq: "asc" },
  });

  const apByKey = new Map();
  for (const row of allAp) {
    if (!row.source_id) continue;
    const k = row.project_cd + "|" + row.source_id;
    if (!apByKey.has(k)) apByKey.set(k, []);
    apByKey.get(k).push(row);
  }

  const apToDelete = [];
  for (const [k, items] of apByKey) {
    if (items.length <= 1) continue;
    const sorted = [...items].sort((a, b) => b.ap_seq - a.ap_seq);
    console.log(
      "AP 중복:",
      k,
      "/ 건수:",
      items.length,
      "/ 금액:",
      items.map((i) => Number(i.amount)).join(" + "),
      "/ 그룹:",
      items[0].biz_group_nm,
    );
    for (const item of sorted.slice(1)) apToDelete.push(item.ap_seq);
  }

  console.log("\nAR 삭제 대상:", arToDelete.length, "건 / AP 삭제 대상:", apToDelete.length, "건");

  if (arToDelete.length > 0) {
    const r = await prisma.ar.updateMany({
      where: { ar_seq: { in: arToDelete } },
      data: { is_deleted: "Y" },
    });
    console.log("AR 소프트 삭제 완료:", r.count, "건");
  } else {
    console.log("AR 중복 없음");
  }

  if (apToDelete.length > 0) {
    const r = await prisma.ap.updateMany({
      where: { ap_seq: { in: apToDelete } },
      data: { is_deleted: "Y" },
    });
    console.log("AP 소프트 삭제 완료:", r.count, "건");
  } else {
    console.log("AP 중복 없음");
  }

  await prisma.$disconnect();
  console.log("\n완료");
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
