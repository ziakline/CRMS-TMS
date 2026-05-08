import { getServerSession } from "next-auth";
import { authOptions } from "../../../../lib/auth-options";
import { prisma } from "../../../../lib/prisma";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return Response.json({ message: "인증이 필요합니다." }, { status: 401 });
  }

  const targets = await prisma.crawlTarget.findMany({
    orderBy: { target_seq: "desc" },
    select: {
      target_seq: true,
      base_year: true,
      project_name: true,
      project_cd: true,
      biz_sector_nm: true,
      biz_dept_nm: true,
      is_active: true,
    },
  });

  return Response.json({ targets }, { status: 200 });
}
