const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function run() {
  const year = 2026;
  const rows = await prisma.ar.findMany({
    where: {
      is_deleted: "N",
      issue_dt: {
        gte: new Date(Date.UTC(year, 0, 1)),
        lt: new Date(Date.UTC(year + 1, 0, 1)),
      },
    },
    select: {
      ar_seq: true,
      source_id: true,
      biz_group_nm: true,
      issue_dt: true,
      description: true,
      amount: true,
      is_estimate: true,
    },
    orderBy: { ar_seq: "asc" },
  });

  // 사업그룹별 집계
  const groups = new Map();
  for (const row of rows) {
    const key = (row.biz_group_nm ?? "").trim() || "미분류";
    if (!groups.has(key)) groups.set(key, { total: 0, count: 0, rows: [] });
    const g = groups.get(key);
    g.total += Number(row.amount);
    g.count++;
    g.rows.push(row);
  }

  console.log("\n=== 사업그룹별 집계 ===");
  for (const [name, g] of groups) {
    console.log(`${name}: ${g.count}건, ${g.total.toLocaleString()}원`);
  }

  // "기타" 그룹 상세 (biz_group_nm contains "기타")
  const gitaGroups = [...groups.entries()].filter(([k]) => k.includes("기타"));
  for (const [name, g] of gitaGroups) {
    console.log(`\n=== '${name}' 상세 ===`);
    for (const row of g.rows) {
      console.log(
        `  ar_seq=${row.ar_seq}, source_id=${row.source_id ?? "null"}, is_estimate=${row.is_estimate}, ` +
        `issue_dt=${row.issue_dt?.toISOString().slice(0, 10)}, amount=${Number(row.amount).toLocaleString()}, ` +
        `desc=${row.description?.slice(0, 40)}`,
      );
    }
  }

  // is_estimate별 집계
  const estimateY = rows.filter((r) => r.is_estimate === "Y");
  const estimateN = rows.filter((r) => r.is_estimate === "N");
  console.log(`\n=== is_estimate 집계 ===`);
  console.log(`is_estimate=Y: ${estimateY.length}건, ${estimateY.reduce((s, r) => s + Number(r.amount), 0).toLocaleString()}원`);
  console.log(`is_estimate=N: ${estimateN.length}건, ${estimateN.reduce((s, r) => s + Number(r.amount), 0).toLocaleString()}원`);

  await prisma.$disconnect();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
