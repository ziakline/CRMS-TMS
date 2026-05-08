import { prisma } from "../../../../lib/prisma";

type PatchBody = {
  user_id?: unknown;
  is_approved?: unknown;
};

export async function GET() {
  try {
    const users = await prisma.user.findMany({
      orderBy: {
        created_at: "asc",
      },
      select: {
        user_id: true,
        email: true,
        name: true,
        is_approved: true,
        created_at: true,
      },
    });

    return Response.json({ users }, { status: 200 });
  } catch (error) {
    console.error("Failed to fetch users:", error);
    return Response.json(
      { message: "사용자 목록을 불러오지 못했습니다." },
      { status: 500 },
    );
  }
}

export async function PATCH(request: Request) {
  let body: PatchBody;

  try {
    body = (await request.json()) as PatchBody;
  } catch {
    return Response.json({ message: "요청 본문이 올바르지 않습니다." }, { status: 400 });
  }

  const userId = body.user_id;
  const nextApprovalState = body.is_approved;

  if (!Number.isInteger(userId) || typeof nextApprovalState !== "boolean") {
    return Response.json(
      { message: "user_id(number)와 is_approved(boolean)를 정확히 전달해 주세요." },
      { status: 400 },
    );
  }

  try {
    const existingUser = await prisma.user.findUnique({
      where: { user_id: userId as number },
      select: { user_id: true },
    });

    if (!existingUser) {
      return Response.json({ message: "존재하지 않는 사용자입니다." }, { status: 404 });
    }

    const updatedUser = await prisma.user.update({
      where: { user_id: userId as number },
      data: { is_approved: nextApprovalState },
      select: {
        user_id: true,
        email: true,
        name: true,
        is_approved: true,
        created_at: true,
      },
    });

    return Response.json(
      { message: "승인 상태가 변경되었습니다.", user: updatedUser },
      { status: 200 },
    );
  } catch (error) {
    console.error("Failed to update user approval:", error);
    return Response.json(
      { message: "승인 상태 변경 중 오류가 발생했습니다." },
      { status: 500 },
    );
  }
}
