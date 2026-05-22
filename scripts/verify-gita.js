const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
async function run() {
  const rows = await prisma.ar.findMany({
    where: {
      is_deleted: "N",
      biz_group_nm: "기타",
      issue_dt: { gte: new Date("2026-01-01"), lt: new Date("2027-01-01") },
    },
    select: { ar_seq: true, amount: true, description: true, issue_dt: true },
    orderBy: { ar_seq: "asc" },
  });
  const total = rows.reduce((s, r) => s + Number(r.amount), 0);
  console.log("기타 AR 건수:", rows.length, "/ 합계:", total.toLocaleString(), "원");
  for (const r of rows) {
    console.log(`  ar_seq=${r.ar_seq}, ${r.issue_dt?.toISOString().slice(0,10)}, ${Number(r.amount).toLocaleString()}원, ${r.description}`);
  }
  await prisma.$disconnect();
}
run().catch(console.error);
