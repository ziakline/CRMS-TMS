/**
 * CRMS에서 이미 삭제됐지만 DB에 is_deleted:"N"으로 남아있는 항목을 수동 정리합니다.
 * 크롤러가 이후 실행에서 자동 처리하지만, 기존 데이터 즉시 정리를 위해 사용합니다.
 *
 * 사용법: node scripts/soft-delete-removed.js
 * 옵션: --dry-run  실제 삭제 없이 대상만 출력
 */
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const isDryRun = process.argv.includes("--dry-run");

async function run() {
  if (isDryRun) console.log("[DRY RUN 모드 - 실제 삭제 없음]\n");

  // 여기에 CRMS에서 사라진 것이 확인된 항목의 ar_seq를 입력합니다
  // check-ar-group.js 실행 결과에서 확인한 값:
  //   ar_seq=269  신한제휴              2026-12-31  410,000,000원
  //   ar_seq=271  HANA 관제시스템 구축  2026-12-31  500,000,000원
  const arSeqsToDelete = [269, 271];

  if (arSeqsToDelete.length === 0) {
    console.log("삭제 대상 없음");
    await prisma.$disconnect();
    return;
  }

  // 삭제 대상 확인 출력
  const targets = await prisma.ar.findMany({
    where: { ar_seq: { in: arSeqsToDelete } },
    select: { ar_seq: true, biz_group_nm: true, description: true, amount: true, issue_dt: true, is_deleted: true },
  });

  console.log("=== 소프트 삭제 대상 AR ===");
  for (const r of targets) {
    console.log(
      `  ar_seq=${r.ar_seq}, is_deleted=${r.is_deleted}, ` +
        `issue_dt=${r.issue_dt?.toISOString().slice(0, 10)}, ` +
        `amount=${Number(r.amount).toLocaleString()}원, ` +
        `desc=${r.description?.slice(0, 50)}`,
    );
  }

  if (isDryRun) {
    console.log("\n[DRY RUN] 위 항목들이 is_deleted=Y로 업데이트될 예정입니다.");
    await prisma.$disconnect();
    return;
  }

  const result = await prisma.ar.updateMany({
    where: { ar_seq: { in: arSeqsToDelete } },
    data: { is_deleted: "Y" },
  });

  console.log(`\nAR 소프트 삭제 완료: ${result.count}건`);
  await prisma.$disconnect();
  console.log("완료");
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
