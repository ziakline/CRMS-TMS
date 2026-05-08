"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "../../../lib/prisma";

type ActionResult = {
  ok: boolean;
  message: string;
};

type CreateTargetPayload = {
  base_year: number;
  project_name: string;
  project_cd: string;
  biz_sector_nm?: string;
  biz_dept_nm?: string;
  is_active: "Y" | "N";
};

export async function createTarget(payload: CreateTargetPayload): Promise<ActionResult> {
  if (!Number.isFinite(payload.base_year) || !payload.project_name.trim() || !payload.project_cd.trim()) {
    return { ok: false, message: "필수 입력값을 확인해 주세요." };
  }

  try {
    await prisma.crawlTarget.create({
      data: {
        base_year: payload.base_year,
        project_name: payload.project_name.trim(),
        project_cd: payload.project_cd.trim(),
        biz_sector_nm: payload.biz_sector_nm?.trim() || null,
        biz_dept_nm: payload.biz_dept_nm?.trim() || null,
        is_active: payload.is_active,
      },
    });
  } catch (error) {
    console.error("createTarget failed:", error);
    return { ok: false, message: "저장 중 오류가 발생했습니다. (프로젝트 코드 중복 여부 확인)" };
  }

  revalidatePath("/admin/targets");
  return { ok: true, message: "크롤링 타겟이 등록되었습니다." };
}

export async function updateTarget(targetSeq: number, payload: CreateTargetPayload): Promise<ActionResult> {
  if (!Number.isFinite(payload.base_year) || !payload.project_name.trim() || !payload.project_cd.trim()) {
    return { ok: false, message: "필수 입력값을 확인해 주세요." };
  }

  try {
    await prisma.crawlTarget.update({
      where: { target_seq: targetSeq },
      data: {
        base_year: payload.base_year,
        project_name: payload.project_name.trim(),
        project_cd: payload.project_cd.trim(),
        biz_sector_nm: payload.biz_sector_nm?.trim() || null,
        biz_dept_nm: payload.biz_dept_nm?.trim() || null,
        is_active: payload.is_active,
      },
    });
  } catch (error) {
    console.error("updateTarget failed:", error);
    return { ok: false, message: "수정 중 오류가 발생했습니다. (프로젝트 코드 중복 여부 확인)" };
  }

  revalidatePath("/admin/targets");
  return { ok: true, message: "크롤링 타겟이 수정되었습니다." };
}

export async function toggleTargetActive(targetSeq: number): Promise<ActionResult> {
  try {
    const target = await prisma.crawlTarget.findUnique({
      where: { target_seq: targetSeq },
      select: { target_seq: true, is_active: true },
    });
    if (!target) return { ok: false, message: "대상을 찾을 수 없습니다." };

    await prisma.crawlTarget.update({
      where: { target_seq: targetSeq },
      data: { is_active: target.is_active === "Y" ? "N" : "Y" },
    });
  } catch (error) {
    console.error("toggleTargetActive failed:", error);
    return { ok: false, message: "상태 변경 중 오류가 발생했습니다." };
  }

  revalidatePath("/admin/targets");
  return { ok: true, message: "활성 상태가 변경되었습니다." };
}

export async function deleteTarget(targetSeq: number): Promise<ActionResult> {
  try {
    await prisma.crawlTarget.delete({
      where: { target_seq: targetSeq },
    });
  } catch (error) {
    console.error("deleteTarget failed:", error);
    return { ok: false, message: "삭제 중 오류가 발생했습니다." };
  }

  revalidatePath("/admin/targets");
  return { ok: true, message: "크롤링 타겟이 삭제되었습니다." };
}
