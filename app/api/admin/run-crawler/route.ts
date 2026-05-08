import { exec } from "child_process";
import { getServerSession } from "next-auth";
import { authOptions } from "../../../../lib/auth-options";
import { promisify } from "util";

const execAsync = promisify(exec);

type CrawlerResult = {
  status: "idle" | "running" | "success" | "failed";
  startedAt: string | null;
  finishedAt: string | null;
  message: string;
  log: string;
};

const globalForCrawler = globalThis as unknown as {
  crawlerIsRunning?: boolean;
  crawlerLastResult?: CrawlerResult;
};

const initialResult: CrawlerResult = {
  status: "idle",
  startedAt: null,
  finishedAt: null,
  message: "대기 중",
  log: "",
};

globalForCrawler.crawlerIsRunning ??= false;
globalForCrawler.crawlerLastResult ??= { ...initialResult };

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return Response.json({ message: "인증이 필요합니다." }, { status: 401 });
  }

  return Response.json(globalForCrawler.crawlerLastResult, { status: 200 });
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return Response.json({ message: "인증이 필요합니다." }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as { year?: number } | null;
  const selectedYear = Number(body?.year);
  const crawlYear = Number.isFinite(selectedYear) ? selectedYear : undefined;

  if (globalForCrawler.crawlerIsRunning) {
    return Response.json(
      {
        ...(globalForCrawler.crawlerLastResult ?? initialResult),
        message: "이미 크롤러가 실행 중입니다.",
      },
      { status: 409 },
    );
  }

  const startedAt = new Date().toISOString();
  globalForCrawler.crawlerIsRunning = true;
  globalForCrawler.crawlerLastResult = {
    status: "running",
    startedAt,
    finishedAt: null,
      message: crawlYear
        ? `${crawlYear}년 기준 크롤러를 실행 중입니다.`
        : "크롤러를 실행 중입니다.",
    log: "",
  };

  try {
    const { stdout, stderr } = await execAsync("node src/crawler.js", {
      cwd: process.cwd(),
      env: {
        ...process.env,
        ...(crawlYear ? { CRAWL_BASE_YEAR: String(crawlYear) } : {}),
      },
      maxBuffer: 10 * 1024 * 1024,
    });

    const finishedAt = new Date().toISOString();
    const mergedLog = [stdout, stderr].filter(Boolean).join("\n").trim();
    globalForCrawler.crawlerLastResult = {
      status: "success",
      startedAt,
      finishedAt,
      message: "크롤러 실행이 성공적으로 완료되었습니다.",
      log: mergedLog,
    };

    return Response.json(globalForCrawler.crawlerLastResult, { status: 200 });
  } catch (error) {
    const finishedAt = new Date().toISOString();
    const execError = error as Error & {
      stdout?: string;
      stderr?: string;
    };
    const mergedLog = [execError.stdout, execError.stderr].filter(Boolean).join("\n").trim();
    globalForCrawler.crawlerLastResult = {
      status: "failed",
      startedAt,
      finishedAt,
      message: "크롤러 실행이 실패했습니다.",
      log: mergedLog || execError.message,
    };

    return Response.json(globalForCrawler.crawlerLastResult, { status: 500 });
  } finally {
    globalForCrawler.crawlerIsRunning = false;
  }
}
