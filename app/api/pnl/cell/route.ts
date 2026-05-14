import { getServerSession } from "next-auth";
import { Prisma } from "@prisma/client";
import { authOptions } from "../../../../lib/auth-options";
import { prisma } from "../../../../lib/prisma";

function toNumber(value: unknown) {
  const n = Number(String(value ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function parseCellCompletion(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === "string") out[k] = v;
  }
  return out;
}

/** GET: 비고·타임라인·완료 여부 (셀 단위) */
export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return Response.json({ message: "인증이 필요합니다." }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);

  /** 그리드에 비고 표시(셀당 1건 이상) — `pnl_seq:cell_key` → true */
  if (searchParams.get("summary") === "1") {
    const baseYear = Number(searchParams.get("base_year"));
    const pnlType = String(searchParams.get("pnl_type") || "AR").toUpperCase();
    if (!Number.isFinite(baseYear) || !["AR", "AP", "OP_COST", "PROFIT"].includes(pnlType)) {
      return Response.json({ message: "base_year, pnl_type가 필요합니다." }, { status: 400 });
    }
    const masters = await prisma.pnlMaster.findMany({
      where: { base_year: baseYear, pnl_type: pnlType },
      select: { pnl_seq: true },
    });
    const ids = masters.map((m) => m.pnl_seq);
    if (ids.length === 0) {
      return Response.json({ flags: {} as Record<string, boolean>, historyFlags: {} as Record<string, boolean> }, { status: 200 });
    }
    const grouped = await prisma.pnlCellNote.groupBy({
      by: ["pnl_seq", "cell_key"],
      where: { pnl_seq: { in: ids } },
      _count: { _all: true },
    });
    const flags: Record<string, boolean> = {};
    for (const g of grouped) {
      flags[`${g.pnl_seq}:${g.cell_key}`] = true;
    }
    const historyGrouped = await prisma.pnlCellHistory.groupBy({
      by: ["pnl_seq", "cell_key"],
      where: { pnl_seq: { in: ids } },
      _count: { _all: true },
    });
    const historyFlags: Record<string, boolean> = {};
    for (const g of historyGrouped) {
      historyFlags[`${g.pnl_seq}:${g.cell_key}`] = true;
    }
    return Response.json({ flags, historyFlags }, { status: 200 });
  }

  const pnlSeq = Number(searchParams.get("pnl_seq"));
  const cellKey = String(searchParams.get("cell_key") ?? "").trim();
  if (!Number.isFinite(pnlSeq) || pnlSeq <= 0 || !cellKey) {
    return Response.json({ message: "pnl_seq, cell_key가 필요합니다." }, { status: 400 });
  }

  const [master, notesRaw, history] = await Promise.all([
    prisma.pnlMaster.findUnique({
      where: { pnl_seq: pnlSeq },
      select: { cell_completion: true },
    }),
    prisma.pnlCellNote.findMany({
      where: { pnl_seq: pnlSeq, cell_key: cellKey },
      orderBy: { created_at: "asc" },
    }),
    prisma.pnlCellHistory.findMany({
      where: { pnl_seq: pnlSeq, cell_key: cellKey },
      orderBy: { created_at: "desc" },
      take: 200,
      select: {
        history_seq: true,
        old_value: true,
        new_value: true,
        author: true,
        created_at: true,
      },
    }),
  ]);

  const notes = notesRaw as unknown as Array<{
    note_seq: number;
    content: string;
    author: string;
    created_at: Date;
    deleted_at: Date | null;
  }>;

  const completion = parseCellCompletion(master?.cell_completion);
  const completed = completion[cellKey] === "COMPLETED";

  return Response.json(
    {
      completed,
      cell_completion: completion,
      notes: notes.map((n) => ({
        note_seq: n.note_seq,
        content: n.content,
        author: n.author,
        created_at: n.created_at.toISOString(),
        deleted_at: n.deleted_at ? n.deleted_at.toISOString() : null,
      })),
      history: history.map((h) => ({
        history_seq: h.history_seq,
        old_value: h.old_value,
        new_value: h.new_value,
        author: h.author,
        created_at: h.created_at.toISOString(),
      })),
    },
    { status: 200 },
  );
}

/** POST: 비고 추가 | 완료/해제 */
export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return Response.json({ message: "인증이 필요합니다." }, { status: 401 });
  }

  const body = (await request.json()) as Record<string, unknown>;
  const action = String(body.action ?? "");
  const pnlSeq = toNumber(body.pnl_seq);
  const cellKey = String(body.cell_key ?? "").trim();
  const author = session.user.name?.trim() || session.user.email;

  if (!Number.isFinite(pnlSeq) || pnlSeq <= 0 || !cellKey) {
    return Response.json({ message: "pnl_seq, cell_key가 필요합니다." }, { status: 400 });
  }

  if (action === "note") {
    const content = String(body.content ?? "").trim();
    if (!content) {
      return Response.json({ message: "내용을 입력해 주세요." }, { status: 400 });
    }
    await prisma.pnlCellNote.create({
      data: { pnl_seq: pnlSeq, cell_key: cellKey, content, author },
    });
    return Response.json({ ok: true, message: "비고가 등록되었습니다." }, { status: 201 });
  }

  if (action === "note_delete") {
    const noteSeq = toNumber(body.note_seq);
    const cellKeyBody = String(body.cell_key ?? "").trim();
    if (!Number.isFinite(noteSeq) || noteSeq <= 0) {
      return Response.json({ message: "note_seq가 필요합니다." }, { status: 400 });
    }
    if (!cellKeyBody) {
      return Response.json({ message: "cell_key가 필요합니다." }, { status: 400 });
    }
    const note = (await prisma.pnlCellNote.findUnique({
      where: { note_seq: noteSeq },
    })) as {
      note_seq: number;
      pnl_seq: number;
      cell_key: string;
      deleted_at: Date | null;
    } | null;
    if (!note || note.pnl_seq !== pnlSeq || note.cell_key !== cellKeyBody) {
      return Response.json({ message: "비고를 찾을 수 없습니다." }, { status: 404 });
    }
    if (note.deleted_at) {
      return Response.json({ message: "이미 삭제된 비고입니다." }, { status: 400 });
    }
    await prisma.pnlCellNote.update({
      where: { note_seq: noteSeq },
      data: { deleted_at: new Date() } as { deleted_at: Date },
    });
    return Response.json({ ok: true, message: "비고를 삭제 처리했습니다." }, { status: 200 });
  }

  if (action === "complete") {
    const completed = Boolean(body.completed);
    const row = await prisma.pnlMaster.findUnique({
      where: { pnl_seq: pnlSeq },
      select: { cell_completion: true },
    });
    const cur = parseCellCompletion(row?.cell_completion);
    if (completed) cur[cellKey] = "COMPLETED";
    else delete cur[cellKey];
    await prisma.pnlMaster.update({
      where: { pnl_seq: pnlSeq },
      data: {
        cell_completion:
          Object.keys(cur).length > 0 ? (cur as Prisma.InputJsonValue) : Prisma.DbNull,
      },
    });
    return Response.json({ ok: true, cell_completion: cur }, { status: 200 });
  }

  return Response.json({ message: "지원하지 않는 action입니다." }, { status: 400 });
}
