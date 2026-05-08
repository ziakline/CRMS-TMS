const { chromium } = require("playwright");
const { PrismaClient } = require("@prisma/client");
const XLSX = require("xlsx");
require("dotenv").config();

const prisma = new PrismaClient();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomDelay(minMs = 1000, maxMs = 3000) {
  const ms = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  return sleep(ms);
}

function normalizeText(value) {
  return (value || "").toString().trim().replace(/\s+/g, "");
}

function parseHistoryDate(raw) {
  const cleaned = raw.replace(/\./g, "-");
  return new Date(cleaned);
}

function buildMatchKey(item) {
  return [
    normalizeText(item.biz_group_nm),
    normalizeText(item.client_nm),
    normalizeText(item.item_type),
    normalizeText(item.description),
    toDateKey(item.issue_dt),
  ].join("|");
}

function toDateKey(input) {
  if (!input) return "";
  const date = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(date.getTime())) return "";
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function parseAmount(raw) {
  if (raw === null || raw === undefined) return 0;
  const parsed = Number(String(raw).replace(/[^\d-]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function extractSourceIdFromOnclick(onclickText) {
  if (!onclickText) return null;

  const outMatch = onclickText.match(
    /outCstmPurcDetail\(\s*'([^']+)'\s*,\s*'[^']*'\s*,\s*'([^']+)'/i,
  );
  if (outMatch) return outMatch[2] || outMatch[1] || null;

  const allQuoted = [...onclickText.matchAll(/'([^']+)'/g)].map((m) => m[1]);
  if (allQuoted.length >= 3) return allQuoted[2];
  if (allQuoted.length >= 1) return allQuoted[0];
  return null;
}

function normalizeLooseText(value) {
  return (value || "")
    .toString()
    .replace(/[\s\u00A0_-]+/g, "")
    .trim()
    .toLowerCase();
}

function extractInspectUrl(baseUrl, rowData) {
  const candidates = [
    rowData?.inspectHref,
    rowData?.inspectOnclick,
    rowData?.onclickText,
    rowData?.rowHtml,
  ].filter(Boolean);
  for (const raw of candidates) {
    if (/^https?:\/\//i.test(raw)) return raw;
    if (raw.startsWith("/")) return new URL(raw, baseUrl).toString();

    const actMatch = raw.match(/(\/[A-Za-z0-9_./-]+\.act(?:\?[^'"\s)]*)?)/);
    if (actMatch) return new URL(actMatch[1], baseUrl).toString();

    const absoluteAct = raw.match(/([A-Za-z0-9_./:-]+\.act(?:\?[^'"\s)]*)?)/);
    if (absoluteAct && absoluteAct[1].startsWith("http")) return absoluteAct[1];
  }
  return null;
}

function htmlToPlainText(html) {
  if (!html) return null;
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeHtmlEntities(text) {
  if (!text) return "";
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"');
}

function stripTags(text) {
  return decodeHtmlEntities((text || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

function htmlFragmentToMultilineText(html) {
  if (!html) return "";
  const withBreaks = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/tr>/gi, "\n")
    .replace(/<hr[^>]*>/gi, "\n----------------------\n");

  const plain = decodeHtmlEntities(withBreaks)
    .replace(/<[^>]+>/g, "")
    .replace(/\r/g, "");

  return plain
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter((line, idx, arr) => {
      if (line !== "") return true;
      // 연속 빈 줄은 하나만 유지
      return idx > 0 && arr[idx - 1] !== "";
    })
    .join("\n")
    .trim();
}

function extractInspectPopupData(html) {
  const cleanedHtml = html || "";

  const blueTitleMatch =
    cleanedHtml.match(/<a[^>]*>([^<]+)<\/a>\s*<\/td>\s*<td[^>]*align\s*=\s*["']?right["']?[^>]*>\s*([^<]+)\s*<\/td>/i) ||
    cleanedHtml.match(/<a[^>]*class=["'][^"']*blue[^"']*["'][^>]*>([^<]+)<\/a>/i);
  const titleFromBlue = stripTags(blueTitleMatch?.[1] || "");
  const workerFromBlue = stripTags(blueTitleMatch?.[2] || "");
  const boldMatches = [...cleanedHtml.matchAll(/<b[^>]*>([\s\S]*?)<\/b>/gi)].map((m) => stripTags(m[1]));
  const titleFromBold = boldMatches.find((v) => v && !/^\d{4}-\d{2}-\d{2}/.test(v)) || "";
  const workerFromBold = boldMatches.find((v) => /^\d{4}-\d{2}-\d{2}\s+/.test(v)) || "";
  const title = titleFromBlue || titleFromBold;
  const worker = workerFromBlue || workerFromBold;

  const grayBoxMatch =
    cleanedHtml.match(/<td[^>]*id=["']CTNT["'][^>]*>([\s\S]*?)<\/td>/i) ||
    cleanedHtml.match(/<div[^>]*style=["'][^"']*border[^"']*["'][^>]*>([\s\S]*?)<\/div>/i) ||
    cleanedHtml.match(/<td[^>]*class=["'][^"']*(?:cont|box|detail)[^"']*["'][^>]*>([\s\S]*?)<\/td>/i);
  const body = htmlFragmentToMultilineText(grayBoxMatch?.[1] || "");

  const excelLinks = [...cleanedHtml.matchAll(/href=["']([^"']+\.(?:xlsx?|xlsm|xlsb)(?:\?[^"']*)?)["']/gi)].map(
    (m) => m[1],
  );

  return {
    title: title || null,
    worker: worker || null,
    body: body || null,
    excelLinks,
  };
}

async function fetchInspectDetailViaClick(page, rowData, options = {}) {
  const { parseExcel = true } = options;
  try {
    if (!Number.isInteger(rowData?.rowIndex)) return null;
    const row = page.locator("tr").nth(rowData.rowIndex);
    if ((await row.count()) === 0) return null;

    const popupPromise = page.waitForEvent("popup", { timeout: 5000 }).catch(() => null);
    const trigger =
      row.locator('a[title*="검수"], a[href*="cost_001_05"], a[onclick*="cost_001_05"], a[onclick*="cst_001_05"]').first();
    let clicked = false;
    if ((await trigger.count()) > 0) {
      await trigger.click({ force: true });
      clicked = true;
    } else {
      const imgTrigger = row.locator('img[src*="icon_complete"], img[title*="작성완료"], img[title*="검수"]').first();
      if ((await imgTrigger.count()) > 0) {
        await imgTrigger.click({ force: true });
        clicked = true;
      }
    }
    if (!clicked) return null;

    const popup = await popupPromise;
    if (!popup) return null;
    await popup.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => null);
    const html = await popup.content();
    const excelInfo = parseExcel
      ? await extractExcelFromPopup(popup)
      : { excelSummary: null, excelCount: 0 };
    await popup.close().catch(() => null);
    return {
      html,
      excelSummary: excelInfo.excelSummary,
      excelCount: excelInfo.excelCount,
    };
  } catch {
    return null;
  }
}

async function readDownloadBuffer(download) {
  const stream = await download.createReadStream();
  if (!stream) return null;
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function extractExcelFromPopup(popup) {
  let excelCount = 0;
  const summaries = [];
  try {
    const attachButtons = popup.locator('[onclick*="fileDownload"], a:has-text("xlsx"), a:has-text("xls")');
    const buttonCount = await attachButtons.count();
    const maxTry = Math.min(buttonCount, 3);
    for (let idx = 0; idx < maxTry; idx += 1) {
      const target = attachButtons.nth(idx);
      const downloadPromise = popup.waitForEvent("download", { timeout: 7000 }).catch(() => null);
      await target.click({ force: true }).catch(() => null);
      const download = await downloadPromise;
      if (!download) continue;
      const buffer = await readDownloadBuffer(download);
      if (!buffer) continue;
      const parsed = parseExcelBufferToText(buffer);
      excelCount += 1;
      if (parsed) summaries.push(parsed);
    }
  } catch (error) {
    summaries.push(`엑셀 클릭 추출 실패: ${error?.message ?? String(error)}`);
  }
  return {
    excelCount,
    excelSummary: summaries.join("\n\n") || null,
  };
}

function parseExcelBufferToText(buffer) {
  try {
    const workbook = XLSX.read(buffer, { type: "buffer" });
    const lines = [];
    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json(sheet, {
        header: 1,
        blankrows: false,
        raw: false,
      });
      const sheetRows = rows
        .map((row) =>
          Array.isArray(row)
            ? row.map((cell) => String(cell ?? "").trim()).join(" | ")
            : "",
        )
        .filter((line) => line.replace(/\|/g, "").trim().length > 0);
      if (sheetRows.length > 0) {
        lines.push(`[시트] ${sheetName}`);
        lines.push(...sheetRows);
      }
    }
    return lines.join("\n") || null;
  } catch (error) {
    return `엑셀 파싱 실패: ${error?.message ?? String(error)}`;
  }
}

async function fetchInspectDetail(page, rowData, options = {}) {
  const { parseExcel = true } = options;
  try {
    let detailUrl = extractInspectUrl(page.url(), rowData);
    let html = null;
    let excelCountFromPopup = 0;
    let excelSummaryFromPopup = null;
    if (!detailUrl) {
      const popupResult = await fetchInspectDetailViaClick(page, rowData, { parseExcel });
      html = popupResult?.html ?? null;
      excelCountFromPopup = popupResult?.excelCount ?? 0;
      excelSummaryFromPopup = popupResult?.excelSummary ?? null;
      if (!popupResult || !html) {
        return {
          text: null,
          title: null,
          worker: null,
          body: null,
          excelSummary: null,
          status: "no_url",
          excelCount: 0,
        };
      }
      detailUrl = page.url();
    }

    if (!html) {
      const response = await page.request.get(detailUrl, { timeout: 15000 });
      if (!response.ok()) {
        return {
          text: null,
          title: null,
          worker: null,
          body: null,
          excelSummary: null,
          status: "empty",
          excelCount: 0,
        };
      }
      html = await response.text();
    }
    const parsed = extractInspectPopupData(html);

    const sections = [];
    if (parsed.title) sections.push(`제목: ${parsed.title}`);
    if (parsed.worker) sections.push(`작업자: ${parsed.worker}`);
    if (parsed.body) sections.push(`상세내용: ${parsed.body}`);

    let excelCount = excelCountFromPopup;
    const excelSummaries = [];
    if (excelSummaryFromPopup) {
      excelSummaries.push(excelSummaryFromPopup);
      sections.push(`엑셀요약(${excelCount || 1}):\n${excelSummaryFromPopup}`);
    }
    if (parseExcel) {
      for (const rawLink of parsed.excelLinks.slice(0, 3)) {
        try {
          const excelUrl = rawLink.startsWith("http")
            ? rawLink
            : new URL(rawLink, detailUrl).toString();
          const excelResp = await page.request.get(excelUrl, { timeout: 20000 });
          if (!excelResp.ok()) {
            sections.push(`엑셀링크: ${excelUrl} (다운로드 실패)`);
            continue;
          }
          const buffer = Buffer.from(await excelResp.body());
          const excelText = parseExcelBufferToText(buffer);
          excelCount += 1;
          if (excelText) {
            excelSummaries.push(excelText);
            sections.push(`엑셀요약(${excelCount}):\n${excelText}`);
          }
        } catch (excelError) {
          sections.push(`엑셀 처리 실패: ${excelError?.message ?? String(excelError)}`);
        }
      }
    }

    if (sections.length === 0) {
      const fallbackText = htmlToPlainText(html);
      return {
        text: fallbackText?.slice(0, 10000) || null,
        title: parsed.title,
        worker: parsed.worker,
        body: parsed.body,
        excelSummary: excelSummaries.join("\n\n") || null,
        status: fallbackText ? "success" : "empty",
        excelCount,
      };
    }
    return {
      text: sections.join("\n\n").slice(0, 10000),
      title: parsed.title,
      worker: parsed.worker,
      body: parsed.body,
      excelSummary: excelSummaries.join("\n\n") || null,
      status: "success",
      excelCount,
    };
  } catch (error) {
    console.warn("inspect_detail fetch skipped:", error?.message ?? error);
    return {
      text: null,
      title: null,
      worker: null,
      body: null,
      excelSummary: null,
      status: "error",
      excelCount: 0,
    };
  }
}

async function extractRowsFromPopup(popup2) {
  await popup2.evaluate(() => {
    const expandLinks = document.querySelectorAll('a[onclick*="detailCtt"]');
    expandLinks.forEach((link) => link.click());
  });
  await popup2.waitForTimeout(2000);

  return popup2.evaluate(() => {
    const rows = document.querySelectorAll("tr");
    return Array.from(rows)
      .map((row, rowIndex) => {
        const tds = Array.from(row.querySelectorAll("td, th"));
        const anchorWithOnclick = row.querySelector("a[onclick]");
        const onclickText = anchorWithOnclick ? anchorWithOnclick.getAttribute("onclick") : null;

        const inspectAnchor =
          row.querySelector('a[title*="검수"]') ||
          row.querySelector('a[href*="cost_001_05"]') ||
          row.querySelector('a[onclick*="cost_001_05"]') ||
          row.querySelector('a[onclick*="cst_001_05"]') ||
          row.querySelector('a[href*="cst_001_05"]') ||
          Array.from(row.querySelectorAll("a")).find((a) => {
            const joined = [
              a.getAttribute("title") || "",
              a.getAttribute("href") || "",
              a.getAttribute("onclick") || "",
              a.textContent || "",
            ].join(" ");
            return /(검수|inspect|cost_001_05|cst_001_05)/i.test(joined);
          }) ||
          null;

        const inspectOnclickNode =
          row.querySelector('[onclick*="cost_001_05"]') ||
          row.querySelector('[onclick*="cst_001_05"]') ||
          row.querySelector('[onclick*="검수"]') ||
          null;

        const inspectHref = inspectAnchor ? inspectAnchor.getAttribute("href") : null;
        const inspectOnclick =
          (inspectAnchor ? inspectAnchor.getAttribute("onclick") : null) ||
          (inspectOnclickNode ? inspectOnclickNode.getAttribute("onclick") : null);

        const cells = tds.map((td) => {
          const targetWithTitle = td.querySelector("[title]") || (td.hasAttribute("title") ? td : null);
          let text = targetWithTitle ? targetWithTitle.getAttribute("title").trim() : td.innerText.trim();
          if (!text) text = td.innerText.trim();
          return text.replace(/\s+/g, " ");
        });

        return { rowIndex, cells, onclickText, inspectHref, inspectOnclick, rowHtml: row.innerHTML };
      })
      .filter((row) => row.cells.length >= 3);
  });
}

async function applySearchFilters(popup1, target) {
  const targetYear = target.base_year ? String(target.base_year) : null;

  if (targetYear) {
    const changedYear = await popup1.evaluate((year) => {
      const selects = Array.from(document.querySelectorAll("select"));
      for (const select of selects) {
        const options = Array.from(select.options || []);
        const matched = options.find((option) => option.textContent?.trim() === year);
        if (!matched) continue;
        if (select.value === matched.value) return true;
        select.value = matched.value;
        select.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      }
      return false;
    }, targetYear);

    if (!changedYear) {
      console.warn(`⚠️ 조회 연도 ${targetYear} 옵션을 찾지 못했습니다. 현재 기본값으로 진행합니다.`);
    } else {
      // 연도 변경 시 우측 사업장 콤보가 비동기로 초기화되므로 안전하게 대기합니다.
      await popup1.waitForLoadState("networkidle");
      await popup1.waitForTimeout(1500);
    }
  }

  if (!target.biz_sector_nm || !target.biz_dept_nm) {
    console.warn(`⚠️ target ${target.project_cd} skip: biz_sector_nm / biz_dept_nm 미설정`);
    return false;
  }

  const selectByNormalizedText = async (selectIndex, optionText, waitMs = 700) => {
    const selected = await popup1.evaluate(
      ({ idx, text }) => {
        const selects = Array.from(document.querySelectorAll("select"));
        const select = selects[idx];
        if (!select) return false;
        const norm = (v) => (v || "").toString().replace(/[-\s]+/g, "").trim().toLowerCase();
        const targetNorm = norm(text);
        const options = Array.from(select.options || []);
        const matched = options.find((opt) => norm(opt.textContent).includes(targetNorm));
        if (!matched || !matched.value) return false;
        select.value = matched.value;
        select.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      },
      { idx: selectIndex, text: optionText },
    );
    if (selected) await popup1.waitForTimeout(waitMs);
    return selected;
  };

  // 1뎁스: 웹케시(주)
  await selectByNormalizedText(0, "웹케시(주)", 700);

  // 2뎁스/3뎁스: DB 설정값만 사용 (하드코딩 fallback 제거)
  const selectedSector = await selectByNormalizedText(1, target.biz_sector_nm, 900);
  if (!selectedSector) {
    console.warn(`⚠️ target ${target.project_cd} skip: 2뎁스 매칭 실패 (${target.biz_sector_nm})`);
    return false;
  }
  const selectedDept = await selectByNormalizedText(2, target.biz_dept_nm, 900);
  if (!selectedDept) {
    console.warn(`⚠️ target ${target.project_cd} skip: 3뎁스 매칭 실패 (${target.biz_dept_nm})`);
    return false;
  }

  const clickedSearch = await popup1.evaluate(() => {
    const clickEl = (el) => {
      if (!el) return false;
      if (typeof el.click === "function") {
        try {
          el.click();
        } catch {}
      }
      el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    };

    // 0) 고정 검색 버튼 ID (CRMS 화면 실측값)
    const fixedSearchBtn = document.getElementById("search_btn");
    if (fixedSearchBtn && clickEl(fixedSearchBtn)) return true;

    // 1) 텍스트 버튼/링크
    const textCandidates = Array.from(document.querySelectorAll("button, a, span, input[type='button'], input[type='submit']"))
      .filter((el) => (el.textContent || "").replace(/\s+/g, "").includes("조회"));
    if (textCandidates.length > 0 && clickEl(textCandidates[textCandidates.length - 1])) return true;

    // 2) value/alt/title 기반 조회 버튼
    const attrCandidates = Array.from(
      document.querySelectorAll(
        "input[value*='조회'], input[alt*='조회'], img[alt*='조회'], img[title*='조회'], a[title*='조회'], button[title*='조회']",
      ),
    );
    if (attrCandidates.length > 0 && clickEl(attrCandidates[attrCandidates.length - 1])) return true;

    // 3) onclick 함수명으로 조회 트리거
    const fnCandidates = Array.from(document.querySelectorAll("[onclick]")).filter((el) =>
      /(search|조회|doSearch|fnSearch)/i.test(el.getAttribute("onclick") || ""),
    );
    if (fnCandidates.length > 0 && clickEl(fnCandidates[0])) return true;

    // 4) 전역 검색 함수가 있으면 직접 호출
    const fnNames = ["fnSearch", "doSearch", "search", "goSearch", "listSearch"];
    for (const fnName of fnNames) {
      const fn = window[fnName];
      if (typeof fn === "function") {
        try {
          fn();
          return true;
        } catch {}
      }
    }
    return false;
  });
  if (!clickedSearch) {
    console.warn(`⚠️ target ${target.project_cd} skip: 조회 버튼 클릭 실패`);
    return false;
  }
  await popup1.waitForLoadState("networkidle");
  await popup1.waitForTimeout(1000);
  return true;
}

async function setOperatingCostMonthRange(page, startMonth = 1, endMonth = 12) {
  const selected = await page.evaluate(
    ({ start, end }) => {
      const toMonthNum = (value) => {
        const raw = (value || "").toString().trim();
        if (!raw) return NaN;
        const digits = raw.replace(/[^\d]/g, "");
        if (!digits) return NaN;
        return Number.parseInt(digits, 10);
      };

      const findBestMonthValue = (select, targetMonth) => {
        const options = Array.from(select.options || []);
        for (const option of options) {
          const parsed = toMonthNum(option.value) || toMonthNum(option.textContent);
          if (parsed === targetMonth) return option.value;
        }
        return null;
      };

      const isMonthSelect = (select) => {
        const options = Array.from(select.options || []);
        if (options.length < 10) return false;
        const monthValues = options
          .map((option) => toMonthNum(option.value) || toMonthNum(option.textContent))
          .filter((month) => Number.isFinite(month) && month >= 1 && month <= 12);
        return monthValues.length >= 10;
      };

      const monthSelects = Array.from(document.querySelectorAll("select")).filter(isMonthSelect);
      if (monthSelects.length < 2) return false;

      const startSelect = monthSelects[0];
      const endSelect = monthSelects[1];
      const startValue = findBestMonthValue(startSelect, start);
      const endValue = findBestMonthValue(endSelect, end);
      if (!startValue || !endValue) return false;

      startSelect.value = startValue;
      startSelect.dispatchEvent(new Event("change", { bubbles: true }));
      endSelect.value = endValue;
      endSelect.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    },
    { start: startMonth, end: endMonth },
  );

  if (!selected) {
    console.warn(`⚠️ 운영비 기간 셀렉트(시작:${startMonth}, 종료:${endMonth})를 찾지 못했습니다.`);
    return false;
  }
  await page.waitForTimeout(500);
  return true;
}

async function syncProjectData(targetProjectCd, targetProjectName, extractedData, page) {
  await prisma.project.upsert({
    where: { project_cd: targetProjectCd },
    update: { project_nm: targetProjectName || undefined },
    create: {
      project_cd: targetProjectCd,
      project_nm: targetProjectName || targetProjectCd,
      dept_nm: "HANA사업부",
    },
  });

  let arCount = 0;
  let apCount = 0;
  let historyCount = 0;
  let parsedHistoryCount = 0;
  const inspectStats = {
    targetRows: 0,
    attempted: 0,
    success: 0,
    empty: 0,
    skippedNoUrl: 0,
    excelRead: 0,
    error: 0,
    noUrlSamples: [],
  };

  let currentMode = "UNKNOWN";
  let currentBizGroup = null;
  const arItems = [];
  const apItems = [];
  const historyItems = [];

  for (const rowData of extractedData) {
    try {
      const row = rowData.cells;
      const rowStr = row.join("");
      const sourceId = extractSourceIdFromOnclick(rowData.onclickText);

      if (rowStr.includes("건 /") && rowStr.includes("원")) {
        currentBizGroup = row[0].trim();
        continue;
      }

      if (rowStr.includes("세부매출내용")) {
        currentMode = "AR";
        continue;
      }
      if (rowStr.includes("세부매입내용")) {
        currentMode = "AP";
        continue;
      }
      if (rowStr.includes("DP") || rowStr.includes("세부DP내용")) {
        currentMode = "DP";
        continue;
      }

      if (row[0]?.includes("조회된 내용이")) continue;

      const firstCol = row[0].trim();
      const isYMD = /^\d{4}-\d{2}-\d{2}$/.test(firstCol);
      const isHistoryDate = /^\d{4}\.\d{2}\.\d{2} \d{2}:\d{2}:\d{2}$/.test(firstCol);

      if (isHistoryDate) {
        historyItems.push({
          project_cd: targetProjectCd,
          change_dt: parseHistoryDate(firstCol),
          worker_nm: row[1] || null,
          remarks: row[2] || "",
        });
        parsedHistoryCount += 1;
      } else if (isYMD) {
        const amountValue = row[4] ? Number(row[4].replace(/,/g, "")) : 0;
        inspectStats.targetRows += 1;
        const shouldParseExcel = normalizeText(currentBizGroup).includes(normalizeText("교차판매"));
        const inspectResult = await fetchInspectDetail(page, rowData, {
          parseExcel: shouldParseExcel,
        });
        const inspectDetail = inspectResult.text;
        if (inspectResult.status === "no_url") {
          inspectStats.skippedNoUrl += 1;
          if (inspectStats.noUrlSamples.length < 5) {
            inspectStats.noUrlSamples.push({
              issue_dt: firstCol,
              client: row[1] || "",
              desc: row[3] || "",
              inspectHref: rowData.inspectHref || "",
              inspectOnclick: rowData.inspectOnclick || "",
            });
          }
        } else if (inspectResult.status === "error") {
          inspectStats.error += 1;
        } else {
          inspectStats.attempted += 1;
        }
        if (inspectResult.excelCount > 0) {
          inspectStats.excelRead += inspectResult.excelCount;
        }
        if (inspectDetail) {
          inspectStats.success += 1;
        } else if (inspectResult.status !== "no_url") {
          inspectStats.empty += 1;
        }

        if (currentMode === "AR") {
          arItems.push({
            project_cd: targetProjectCd,
            source_id: sourceId,
            biz_group_nm: currentBizGroup,
            issue_dt: new Date(firstCol),
            client_nm: row[1] || null,
            item_type: row[2] || null,
            description: row[3] || "",
            amount: amountValue,
            inspect_status: row[5] || null,
            claim_status: row[6] || null,
            receive_status: row[7] || null,
            inspect_detail: inspectDetail,
            inspect_title: inspectResult.title,
            inspect_worker: inspectResult.worker,
            inspect_body: inspectResult.body,
            inspect_excel: inspectResult.excelSummary,
          });
        } else if (currentMode === "AP") {
          apItems.push({
            project_cd: targetProjectCd,
            source_id: sourceId,
            biz_group_nm: currentBizGroup,
            issue_dt: new Date(firstCol),
            client_nm: row[1] || null,
            item_type: row[2] || null,
            description: row[3] || "",
            amount: amountValue,
            inspect_status: row[5] || null,
            pay_status: row[6] || null,
            inspect_detail: inspectDetail,
            inspect_title: inspectResult.title,
            inspect_worker: inspectResult.worker,
            inspect_body: inspectResult.body,
            inspect_excel: inspectResult.excelSummary,
          });
        }
      }
    } catch (dbErr) {
      console.error(`⚠️ DB INSERT 에러 (데이터: ${rowData?.cells?.[0]}):`, dbErr.message);
    }
  }

  const [existingAr, existingAp, existingHistories] = await Promise.all([
    prisma.ar.findMany({ where: { project_cd: targetProjectCd } }),
    prisma.ap.findMany({ where: { project_cd: targetProjectCd } }),
    prisma.manualHistory.findMany({
      where: { project_cd: targetProjectCd },
      select: { change_dt: true, worker_nm: true, remarks: true },
    }),
  ]);

  const arMap = new Map();
  for (const item of existingAr) {
    const key = buildMatchKey(item);
    if (!arMap.has(key)) arMap.set(key, []);
    arMap.get(key).push(item);
  }
  const arSourceMap = new Map(
    existingAr
      .filter((item) => item.source_id)
      .map((item) => [`${item.project_cd}|${item.source_id}|${toDateKey(item.issue_dt)}`, item]),
  );

  const apMap = new Map();
  for (const item of existingAp) {
    const key = buildMatchKey(item);
    if (!apMap.has(key)) apMap.set(key, []);
    apMap.get(key).push(item);
  }
  const apSourceMap = new Map(
    existingAp
      .filter((item) => item.source_id)
      .map((item) => [`${item.project_cd}|${item.source_id}|${toDateKey(item.issue_dt)}`, item]),
  );

  async function writeChangeLog(moduleType, sourceId, issueDt, targetDesc, column, beforeValue, afterValue) {
    if (String(beforeValue ?? "") === String(afterValue ?? "")) return;
    await prisma.autoChangeLog.create({
      data: {
        project_cd: targetProjectCd,
        source_id: sourceId || null,
        issue_dt: issueDt || null,
        module_type: moduleType,
        target_desc: targetDesc,
        changed_column: column,
        before_value: beforeValue === null || beforeValue === undefined ? null : String(beforeValue),
        after_value: afterValue === null || afterValue === undefined ? null : String(afterValue),
        detected_at: new Date(),
      },
    });
  }

  for (const incoming of arItems) {
    let matched = null;
    if (incoming.source_id) {
      matched =
        arSourceMap.get(`${incoming.project_cd}|${incoming.source_id}|${toDateKey(incoming.issue_dt)}`) || null;
    }
    if (!matched) {
      const key = buildMatchKey(incoming);
      const candidates = arMap.get(key) || [];
      matched =
        candidates.find(
          (candidate) =>
            normalizeText(candidate.description) === normalizeText(incoming.description) &&
            normalizeText(candidate.client_nm) === normalizeText(incoming.client_nm),
        ) || null;
    }

    if (!matched) {
      const created = await prisma.ar.create({ data: incoming });
      if (created.source_id) {
        arSourceMap.set(`${created.project_cd}|${created.source_id}|${toDateKey(created.issue_dt)}`, created);
      }
      arCount++;
      continue;
    }

    await writeChangeLog("AR", incoming.source_id, incoming.issue_dt, incoming.description, "amount", matched.amount, incoming.amount);
    await writeChangeLog("AR", incoming.source_id, incoming.issue_dt, incoming.description, "issue_dt", matched.issue_dt, incoming.issue_dt);
    await writeChangeLog("AR", incoming.source_id, incoming.issue_dt, incoming.description, "inspect_status", matched.inspect_status, incoming.inspect_status);
    await writeChangeLog("AR", incoming.source_id, incoming.issue_dt, incoming.description, "claim_status", matched.claim_status, incoming.claim_status);
    await writeChangeLog("AR", incoming.source_id, incoming.issue_dt, incoming.description, "receive_status", matched.receive_status, incoming.receive_status);
    await writeChangeLog("AR", incoming.source_id, incoming.issue_dt, incoming.description, "inspect_detail", matched.inspect_detail, incoming.inspect_detail);
    await writeChangeLog("AR", incoming.source_id, incoming.issue_dt, incoming.description, "inspect_title", matched.inspect_title, incoming.inspect_title);
    await writeChangeLog("AR", incoming.source_id, incoming.issue_dt, incoming.description, "inspect_worker", matched.inspect_worker, incoming.inspect_worker);
    await writeChangeLog("AR", incoming.source_id, incoming.issue_dt, incoming.description, "inspect_body", matched.inspect_body, incoming.inspect_body);
    await writeChangeLog("AR", incoming.source_id, incoming.issue_dt, incoming.description, "inspect_excel", matched.inspect_excel, incoming.inspect_excel);

    await prisma.ar.update({ where: { ar_seq: matched.ar_seq }, data: incoming });
    if (incoming.source_id) {
      arSourceMap.set(`${incoming.project_cd}|${incoming.source_id}|${toDateKey(incoming.issue_dt)}`, {
        ...matched,
        ...incoming,
      });
    }
    arCount++;
  }

  for (const incoming of apItems) {
    let matched = null;
    if (incoming.source_id) {
      matched =
        apSourceMap.get(`${incoming.project_cd}|${incoming.source_id}|${toDateKey(incoming.issue_dt)}`) || null;
    }
    if (!matched) {
      const key = buildMatchKey(incoming);
      const candidates = apMap.get(key) || [];
      matched =
        candidates.find(
          (candidate) =>
            normalizeText(candidate.description) === normalizeText(incoming.description) &&
            normalizeText(candidate.client_nm) === normalizeText(incoming.client_nm),
        ) || null;
    }

    if (!matched) {
      const created = await prisma.ap.create({ data: incoming });
      if (created.source_id) {
        apSourceMap.set(`${created.project_cd}|${created.source_id}|${toDateKey(created.issue_dt)}`, created);
      }
      apCount++;
      continue;
    }

    await writeChangeLog("AP", incoming.source_id, incoming.issue_dt, incoming.description, "amount", matched.amount, incoming.amount);
    await writeChangeLog("AP", incoming.source_id, incoming.issue_dt, incoming.description, "issue_dt", matched.issue_dt, incoming.issue_dt);
    await writeChangeLog("AP", incoming.source_id, incoming.issue_dt, incoming.description, "inspect_status", matched.inspect_status, incoming.inspect_status);
    await writeChangeLog("AP", incoming.source_id, incoming.issue_dt, incoming.description, "pay_status", matched.pay_status, incoming.pay_status);
    await writeChangeLog("AP", incoming.source_id, incoming.issue_dt, incoming.description, "inspect_detail", matched.inspect_detail, incoming.inspect_detail);
    await writeChangeLog("AP", incoming.source_id, incoming.issue_dt, incoming.description, "inspect_title", matched.inspect_title, incoming.inspect_title);
    await writeChangeLog("AP", incoming.source_id, incoming.issue_dt, incoming.description, "inspect_worker", matched.inspect_worker, incoming.inspect_worker);
    await writeChangeLog("AP", incoming.source_id, incoming.issue_dt, incoming.description, "inspect_body", matched.inspect_body, incoming.inspect_body);
    await writeChangeLog("AP", incoming.source_id, incoming.issue_dt, incoming.description, "inspect_excel", matched.inspect_excel, incoming.inspect_excel);

    await prisma.ap.update({ where: { ap_seq: matched.ap_seq }, data: incoming });
    if (incoming.source_id) {
      apSourceMap.set(`${incoming.project_cd}|${incoming.source_id}|${toDateKey(incoming.issue_dt)}`, {
        ...matched,
        ...incoming,
      });
    }
    apCount++;
  }

  const historyKeySet = new Set(
    existingHistories.map(
      (h) => `${new Date(h.change_dt).toISOString()}|${normalizeText(h.worker_nm)}|${normalizeText(h.remarks)}`,
    ),
  );

  for (const item of historyItems) {
    const key = `${new Date(item.change_dt).toISOString()}|${normalizeText(item.worker_nm)}|${normalizeText(item.remarks)}`;
    if (historyKeySet.has(key)) continue;
    await prisma.manualHistory.create({ data: item });
    historyKeySet.add(key);
    historyCount++;
  }

  return { arCount, apCount, historyCount, parsedHistoryCount, inspectStats };
}

async function syncOperatingCosts(context, target) {
  let opPage = null;
  try {
    opPage = await context.newPage();
    await opPage.goto("http://crms.webcash.co.kr/cost_008_04.act", {
      waitUntil: "networkidle",
      timeout: 30000,
    });

    await setOperatingCostMonthRange(opPage, 1, 12);
    const opFilterApplied = await applySearchFilters(opPage, target);
    if (!opFilterApplied) {
      return { opCount: 0, opChangeCount: 0 };
    }

    const rows = await opPage.evaluate(() => {
      const trs = Array.from(document.querySelectorAll("tr"));
      return trs
        .map((tr) => Array.from(tr.querySelectorAll("td")).map((td) => td.innerText.replace(/\s+/g, " ").trim()))
        .filter((cells) => cells.length >= 6)
        .filter((cells) => /^\d{4}-\d{2}$/.test(cells[0]));
    });

    let opCount = 0;
    let opChangeCount = 0;
    for (const row of rows) {
      const targetMonth = row[0];
      const issueDt = new Date(`${targetMonth}-01`);
      const incoming = {
        project_cd: target.project_cd,
        base_year: target.base_year || issueDt.getFullYear(),
        target_month: targetMonth,
        labor_cost: parseAmount(row[1]),
        insurance_cost: parseAmount(row[2]),
        severance_cost: parseAmount(row[3]),
        dept_op_cost: parseAmount(row[4]),
        total_cost: parseAmount(row[5]),
      };

      const existing = await prisma.operatingCost.findUnique({
        where: {
          project_cd_target_month: {
            project_cd: target.project_cd,
            target_month: targetMonth,
          },
        },
      });

      if (!existing) {
        await prisma.operatingCost.create({ data: incoming });
        opCount += 1;
        continue;
      }

      const changes = [
        ["labor_cost", parseAmount(existing.labor_cost), incoming.labor_cost],
        ["insurance_cost", parseAmount(existing.insurance_cost), incoming.insurance_cost],
        ["severance_cost", parseAmount(existing.severance_cost), incoming.severance_cost],
        ["dept_op_cost", parseAmount(existing.dept_op_cost), incoming.dept_op_cost],
        ["total_cost", parseAmount(existing.total_cost), incoming.total_cost],
      ].filter(([, before, after]) => before !== after);

      if (changes.length > 0) {
        for (const [column, before, after] of changes) {
          await prisma.autoChangeLog.create({
            data: {
              project_cd: target.project_cd,
              source_id: null,
              issue_dt: issueDt,
              module_type: "OP",
              target_desc: targetMonth,
              changed_column: column,
              before_value: String(before),
              after_value: String(after),
              detected_at: new Date(),
            },
          });
        }
        opChangeCount += changes.length;
      }

      await prisma.operatingCost.update({
        where: { op_seq: existing.op_seq },
        data: incoming,
      });
      opCount += 1;
    }

    return { opCount, opChangeCount };
  } catch (error) {
    console.warn(`⚠️ 운영비 수집 실패(격리 처리): ${target.project_cd}`, error?.message || error);
    return { opCount: 0, opChangeCount: 0 };
  } finally {
    await opPage?.close().catch(() => null);
  }
}

async function runCrawler() {
  console.log("🚀 CRMS 추적 크롤러 시작...");
  const overrideYearRaw = process.env.CRAWL_BASE_YEAR;
  const overrideYear = Number(overrideYearRaw);
  const hasOverrideYear = Number.isFinite(overrideYear);
  const headfulMode = process.env.CRAWL_HEADFUL === "1";
  if (hasOverrideYear) {
    console.log(`🗓️ 실행 연도 오버라이드 적용: ${overrideYear}`);
  }
  if (headfulMode) {
    console.log("🖥️ 헤드풀(브라우저 표시) 모드로 실행합니다.");
  }

  try {
    await prisma.$connect();
    console.log("✅ DB 연결 성공");

    const baseTargets = await prisma.crawlTarget.findMany({
      where: { is_active: "Y" },
      orderBy: [{ base_year: "desc" }, { target_seq: "asc" }],
      select: {
        project_cd: true,
        project_name: true,
        base_year: true,
        biz_sector_nm: true,
        biz_dept_nm: true,
      },
    });

    const yearScopedTargets = hasOverrideYear
      ? baseTargets.filter((target) => {
          if (target.base_year === overrideYear) return true;
          const yy = String(overrideYear).slice(-2);
          return target.project_cd.includes(`W${yy}`);
        })
      : baseTargets;

    const activeTargets = hasOverrideYear
      ? yearScopedTargets.map((target) => ({
          ...target,
          base_year: overrideYear,
        }))
      : yearScopedTargets;

    if (activeTargets.length === 0) {
      console.log("ℹ️ 활성화된 CrawlTarget이 없습니다. 크롤링을 종료합니다.");
      return;
    }

    const browser = await chromium.launch({ headless: !headfulMode, slowMo: headfulMode ? 150 : 0 });
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto("http://crms.webcash.co.kr/login.act");
    await page.locator('input[type="text"]').first().fill(process.env.CRMS_ID);
    await page.locator('input[type="password"]').fill(process.env.CRMS_PW);
    await page.keyboard.press("Enter");
    await page.waitForLoadState("networkidle");

    await page.getByText("Report").click();
    await page.waitForTimeout(1000);
    await page.getByText("수익조회").click();
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2000);

    let popup1;
    let isPopupOpened = false;
    for (const frame of page.frames()) {
      try {
        const isFunctionExist = await frame.evaluate(() => typeof detail_manage === "function");
        if (isFunctionExist) {
          const [newPopup] = await Promise.all([page.waitForEvent("popup"), frame.evaluate(() => detail_manage("47", "all"))]);
          popup1 = newPopup;
          isPopupOpened = true;
          break;
        }
      } catch (e) {}
    }
    if (!isPopupOpened) throw new Error("❌ detail_manage 함수를 찾지 못했습니다.");
    await popup1.waitForLoadState("networkidle");

    let totalAr = 0;
    let totalAp = 0;
    let totalHistory = 0;
    let totalOp = 0;
    let totalOpChanges = 0;
    const totalInspect = {
      targetRows: 0,
      attempted: 0,
      success: 0,
      empty: 0,
      skippedNoUrl: 0,
      excelRead: 0,
      error: 0,
    };

    for (const target of activeTargets) {
      const filterApplied = await applySearchFilters(popup1, target);
      if (!filterApplied) continue;

      const clickProjectByEvaluate = async (targetText) => {
        const popupPromise = popup1.waitForEvent("popup", { timeout: 7000 }).catch(() => null);
        const clicked = await popup1.evaluate((rawTarget) => {
          const norm = (v) =>
            (v || "")
              .toString()
              .replace(/[\s\u00A0_-]+/g, "")
              .trim()
              .toLowerCase();
          const target = norm(rawTarget);
          if (!target) return false;
          const candidates = Array.from(document.querySelectorAll("a, font, td, span, div, tr"));
          const matched = candidates.find((el) => {
            const text = norm(el.textContent || "");
            return text && text.includes(target);
          });
          if (!matched) return false;
          const clickable =
            matched.closest("a,[onclick]") ||
            matched.closest("tr") ||
            matched;
          clickable.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
          return true;
        }, targetText);
        if (!clicked) return null;
        return await popupPromise;
      };

      const clickProjectInFrames = async (targetText) => {
        const frames = popup1.frames();
        const targetNorm = normalizeLooseText(targetText);
        for (const frame of frames) {
          try {
            const popupPromise = popup1.waitForEvent("popup", { timeout: 7000 }).catch(() => null);
            const clicked = await frame.evaluate((rawTarget) => {
              const norm = (v) =>
                (v || "")
                  .toString()
                  .replace(/[\s\u00A0_-]+/g, "")
                  .trim()
                  .toLowerCase();
              const target = norm(rawTarget);
              if (!target) return false;
              const candidates = Array.from(document.querySelectorAll("a, font, td, span, div, tr"));
              let matched = candidates.find((el) => {
                const text = norm(el.textContent || "");
                return text && text.includes(target);
              });
              if (!matched) {
                // 텍스트 완전일치가 안 되면 그리드 첫 데이터 행을 선택합니다.
                matched = candidates.find((el) => {
                  const text = norm(el.textContent || "");
                  return text && /w\d{2}br/.test(text);
                });
              }
              if (!matched) return false;
              const clickable = matched.closest("a,[onclick]") || matched.closest("tr") || matched;
              clickable.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
              return true;
            }, targetText);
            if (!clicked) continue;
            const popup = await popupPromise;
            if (popup) return popup;
          } catch {}
        }

        // 프레임 클릭도 실패하면 연도 접두어(W25/W26...)로 한 번 더 시도
        if (targetNorm) {
          const yearPrefixMatch = targetNorm.match(/w\d{2}br/);
          if (yearPrefixMatch) {
            for (const frame of frames) {
              try {
                const popupPromise = popup1.waitForEvent("popup", { timeout: 7000 }).catch(() => null);
                const clicked = await frame.evaluate((prefix) => {
                  const norm = (v) =>
                    (v || "")
                      .toString()
                      .replace(/[\s\u00A0_-]+/g, "")
                      .trim()
                      .toLowerCase();
                  const rows = Array.from(document.querySelectorAll("tr, a, td, font"));
                  const matched = rows.find((el) => norm(el.textContent || "").includes(prefix));
                  if (!matched) return false;
                  const clickable = matched.closest("a,[onclick]") || matched.closest("tr") || matched;
                  clickable.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
                  return true;
                }, yearPrefixMatch[0]);
                if (!clicked) continue;
                const popup = await popupPromise;
                if (popup) return popup;
              } catch {}
            }
          }
        }
        return null;
      };

      const clickFirstProjectRowInFrames = async (targetCode) => {
        const yearPrefix = (targetCode.match(/W\d{2}BR/i)?.[0] || "").toLowerCase();
        for (const frame of popup1.frames()) {
          try {
            const popupPromise = popup1.waitForEvent("popup", { timeout: 7000 }).catch(() => null);
            const clicked = await frame.evaluate((prefix) => {
              const norm = (v) =>
                (v || "")
                  .toString()
                  .replace(/[\s\u00A0_-]+/g, "")
                  .trim()
                  .toLowerCase();
              const rows = Array.from(document.querySelectorAll("tr"));
              const targetRow =
                rows.find((row) => {
                  const text = norm(row.textContent || "");
                  return prefix && text.includes(prefix);
                }) ||
                rows.find((row) => /w\d{2}br/.test(norm(row.textContent || ""))) ||
                null;
              if (!targetRow) return false;
              const clickable = targetRow.querySelector("a,[onclick]") || targetRow;
              clickable.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
              return true;
            }, yearPrefix);
            if (!clicked) continue;
            const popup = await popupPromise;
            if (popup) return popup;
          } catch {}
        }
        return null;
      };

      let targetProjectNode = popup1.getByText(target.project_cd, { exact: true }).first();
      if ((await targetProjectNode.count()) === 0) {
        targetProjectNode = popup1.locator("a", { hasText: target.project_cd }).first();
      }
      if ((await targetProjectNode.count()) === 0) {
        targetProjectNode = popup1.locator("font", { hasText: target.project_cd }).first();
      }
      if ((await targetProjectNode.count()) === 0) {
        targetProjectNode = popup1.locator("td", { hasText: target.project_cd }).first();
      }
      if ((await targetProjectNode.count()) === 0 && target.project_name) {
        targetProjectNode = popup1.locator("a", { hasText: target.project_name }).first();
      }
      if ((await targetProjectNode.count()) === 0 && target.project_name) {
        targetProjectNode = popup1.locator("font", { hasText: target.project_name }).first();
      }
      if ((await targetProjectNode.count()) === 0) {
        console.warn(`⚠️ 대상 프로젝트 링크 없음: ${target.project_cd}`);
        const sampleCandidates = await popup1.evaluate((rawTarget) => {
          const norm = (v) =>
            (v || "")
              .toString()
              .replace(/[\s\u00A0_-]+/g, "")
              .trim()
              .toLowerCase();
          const target = norm(rawTarget);
          const rows = Array.from(document.querySelectorAll("tr, a, font"))
            .map((el) => (el.textContent || "").replace(/\s+/g, " ").trim())
            .filter((text) => text.length > 0);
          const matched = rows.filter((text) => norm(text).includes(target)).slice(0, 5);
          return matched;
        }, target.project_cd);
        if (sampleCandidates.length > 0) {
          console.warn(`⚠️ 텍스트 후보 발견(${sampleCandidates.length}):`, sampleCandidates);
        }

        const popupByEval =
          (await clickProjectByEvaluate(target.project_cd)) ||
          (target.project_name ? await clickProjectByEvaluate(target.project_name) : null) ||
          (await clickProjectInFrames(target.project_cd)) ||
          (target.project_name ? await clickProjectInFrames(target.project_name) : null) ||
          (await clickFirstProjectRowInFrames(target.project_cd));
        if (popupByEval) {
          console.log(`🎯 타겟 프로젝트 시작(텍스트 fallback): ${target.project_cd}`);
          await popupByEval.waitForLoadState("networkidle");
          const extractedData = await extractRowsFromPopup(popupByEval);
          console.log(`  - 추출 건수: ${extractedData.length}`);
          const result = await syncProjectData(target.project_cd, target.project_name, extractedData, popupByEval);
          totalAr += result.arCount;
          totalAp += result.apCount;
          totalHistory += result.historyCount;
          totalInspect.targetRows += result.inspectStats.targetRows;
          totalInspect.attempted += result.inspectStats.attempted;
          totalInspect.success += result.inspectStats.success;
          totalInspect.empty += result.inspectStats.empty;
          totalInspect.skippedNoUrl += result.inspectStats.skippedNoUrl;
          totalInspect.excelRead = (totalInspect.excelRead || 0) + result.inspectStats.excelRead;
          totalInspect.error = (totalInspect.error || 0) + result.inspectStats.error;
          console.log(
            `  - inspect_detail: 대상 ${result.inspectStats.targetRows}건 / 시도 ${result.inspectStats.attempted}건 / 성공 ${result.inspectStats.success}건 / 응답없음 ${result.inspectStats.empty}건 / URL없음 ${result.inspectStats.skippedNoUrl}건 / 엑셀파싱 ${result.inspectStats.excelRead}건 / 에러 ${result.inspectStats.error}건`,
          );
          console.log(
            `  - history 파싱: ${result.parsedHistoryCount}건 / 신규 저장: ${result.historyCount}건`,
          );
          await popupByEval.close().catch(() => null);
          continue;
        }
        continue;
      }

      console.log(`🎯 타겟 프로젝트 시작: ${target.project_cd}`);
      await targetProjectNode.scrollIntoViewIfNeeded();
      let popup2 = null;
      const popupPromise = popup1.waitForEvent("popup", { timeout: 7000 }).catch(() => null);
      await targetProjectNode.click({ force: true }).catch(() => null);
      popup2 = await popupPromise;
      if (!popup2) {
        // 일부 연도 화면은 텍스트 노드가 아닌 행 클릭으로 상세 팝업이 열립니다.
        const row = targetProjectNode.locator("xpath=ancestor::tr[1]");
        const rowPopupPromise = popup1.waitForEvent("popup", { timeout: 7000 }).catch(() => null);
        await row.click({ force: true }).catch(() => null);
        popup2 = await rowPopupPromise;
      }
      if (!popup2) {
        console.warn(`⚠️ 대상 프로젝트 팝업 열기 실패: ${target.project_cd}`);
        continue;
      }
      await popup2.waitForLoadState("networkidle");

      const extractedData = await extractRowsFromPopup(popup2);
      console.log(`  - 추출 건수: ${extractedData.length}`);

      const result = await syncProjectData(target.project_cd, target.project_name, extractedData, popup2);
      totalAr += result.arCount;
      totalAp += result.apCount;
      totalHistory += result.historyCount;
      totalInspect.targetRows += result.inspectStats.targetRows;
      totalInspect.attempted += result.inspectStats.attempted;
      totalInspect.success += result.inspectStats.success;
      totalInspect.empty += result.inspectStats.empty;
      totalInspect.skippedNoUrl += result.inspectStats.skippedNoUrl;
      totalInspect.excelRead = (totalInspect.excelRead || 0) + result.inspectStats.excelRead;
      totalInspect.error = (totalInspect.error || 0) + result.inspectStats.error;
      console.log(
        `  - inspect_detail: 대상 ${result.inspectStats.targetRows}건 / 시도 ${result.inspectStats.attempted}건 / 성공 ${result.inspectStats.success}건 / 응답없음 ${result.inspectStats.empty}건 / URL없음 ${result.inspectStats.skippedNoUrl}건 / 엑셀파싱 ${result.inspectStats.excelRead}건 / 에러 ${result.inspectStats.error}건`,
      );
      if (result.inspectStats.noUrlSamples.length > 0) {
        console.log("  - inspect_detail URL 미탐지 샘플:");
        result.inspectStats.noUrlSamples.forEach((sample, idx) => {
          console.log(
            `    ${idx + 1}) ${sample.issue_dt} | ${sample.client} | ${sample.desc} | href=${sample.inspectHref} | onclick=${sample.inspectOnclick}`,
          );
        });
      }
      console.log(
        `  - history 파싱: ${result.parsedHistoryCount}건 / 신규 저장: ${result.historyCount}건`,
      );

      await popup2.close();

      const opResult = await syncOperatingCosts(context, target);
      totalOp += opResult.opCount;
      totalOpChanges += opResult.opChangeCount;
      console.log(`  - 운영비: 저장 ${opResult.opCount}건 / 변경로그 ${opResult.opChangeCount}건`);
    }

    await browser.close();

    console.log("\n🎉 [크롤러 최종 종료 보고]");
    console.log(`▶ AR 데이터: ${totalAr}건 저장`);
    console.log(`▶ AP 데이터: ${totalAp}건 저장`);
    console.log(`▶ 이력(History) 데이터: ${totalHistory}건 저장`);
    console.log(`▶ 운영비 데이터: ${totalOp}건 저장 / 변경로그 ${totalOpChanges}건`);
    console.log(
      `▶ inspect_detail 집계: 대상 ${totalInspect.targetRows}건 / 시도 ${totalInspect.attempted}건 / 성공 ${totalInspect.success}건 / 응답없음 ${totalInspect.empty}건 / URL없음 ${totalInspect.skippedNoUrl}건 / 엑셀파싱 ${totalInspect.excelRead || 0}건 / 에러 ${totalInspect.error || 0}건`,
    );
    console.log(`▶ 총 ${totalAr + totalAp + totalHistory + totalOp}건 완벽 동기화 달성!`);
  } catch (error) {
    console.error("❌ 크롤러 실행 중 치명적 에러 발생:", error);
  } finally {
    await prisma.$disconnect();
    console.log("🛑 크롤러 프로세스 정상 종료");
  }
}

runCrawler();
