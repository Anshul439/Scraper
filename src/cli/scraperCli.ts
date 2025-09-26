#!/usr/bin/env node
import { argv } from "process";
import { existsSync, readFileSync, mkdirSync, writeFileSync } from "fs";
import path from "path";
import {
  expandOneLevelUnfiltered,
  expandOneLevelMaximum,
  expandOneLevel,
} from "../crawler";
import { downloadPdf } from "../downloader";
import { AppConfig } from "../types/config.types";

function loadConfig(pathArg = "./config.json"): AppConfig {
  if (!existsSync(pathArg)) throw new Error(`Config not found at ${pathArg}`);
  const raw = readFileSync(pathArg, "utf-8");
  return JSON.parse(raw) as AppConfig;
}

function parseCliExam(): string | undefined {
  const idx = argv.indexOf("--exam");
  if (idx === -1) return undefined;
  return argv[idx + 1];
}

function parseArgFlag(flag: string) {
  const idx = argv.indexOf(flag);
  if (idx === -1) return undefined;
  const val = argv[idx + 1];
  if (!val || val.startsWith("--")) return true;
  return val;
}

/**
 * Enhanced filter: basic examKey filter + year filter for manifests
 * examKey can be string (comma-separated) or string[] in config
 */
function filterPdfsByYearsAndExamKey(
  pdfs: string[],
  targetYears?: string[],
  examKey?: any
): string[] {
  console.log(`\nFiltering ${pdfs.length} PDFs...`);
  if (targetYears && targetYears.length > 0) {
    console.log(`  Years: ${targetYears.join(", ")}`);
  }
  if (examKey) {
    const keyDisplay =
      Array.isArray(examKey) ? examKey.join(", ") : String(examKey);
    console.log(`  Exam key: "${keyDisplay}"`);
  }

  const filtered = pdfs.filter((url) => {
    if (!/\.pdf($|\?)/i.test(url)) return false;

    let matchesYear = true;
    let matchesExamKey = true;

    if (targetYears && targetYears.length > 0) {
      matchesYear = checkYearMatch(url, targetYears);
    }

    if (examKey) {
      matchesExamKey = checkExamKeyMatch(url, examKey);
    }

    return matchesYear && matchesExamKey;
  });

  console.log(`Filtered down to ${filtered.length} PDFs`);
  return filtered;
}

function checkYearMatch(url: string, targetYears: string[]): boolean {
  const directYearPattern = new RegExp(`\\b(${targetYears.join("|")})\\b`, "i");
  if (directYearPattern.test(url)) return true;

  const fileName = getFilenameFromUrl(url);
  if (directYearPattern.test(fileName)) return true;

  for (const year of targetYears) {
    const yearNum = parseInt(year);
    if (isNaN(yearNum)) continue;
    const nextYear = yearNum + 1;
    const shortNextYear = nextYear.toString().slice(-2);

    const academicYearPatterns = [
      `${year}-${nextYear}`,
      `${year}-${shortNextYear}`,
      `${year}_${nextYear}`,
      `${year}_${shortNextYear}`,
      `${year}${nextYear}`,
      `${year}${shortNextYear}`,
    ];

    for (const pattern of academicYearPatterns) {
      if (url.toLowerCase().includes(pattern.toLowerCase())) return true;
    }

    const prevYear = yearNum - 1;
    const shortPrevYear = prevYear.toString().slice(-2);
    const reversePatterns = [`${shortPrevYear}-${year}`, `${prevYear}-${year}`];
    for (const pattern of reversePatterns) {
      if (url.toLowerCase().includes(pattern.toLowerCase())) return true;
    }
  }

  return false;
}

/**
 * checkExamKeyMatch: supports examKey as string (comma-separated) or string[].
 * Enforces AND semantics: ALL tokens must appear somewhere in the URL or filename.
 */
function checkExamKeyMatch(url: string, examKey: any): boolean {
  if (!examKey) return true; // no filter

  // Normalize to array of non-empty tokens
  const keys: string[] = Array.isArray(examKey)
    ? (examKey as any[]).map((k) => String(k || "").trim()).filter(Boolean)
    : String(examKey)
        .split(",")
        .map((k) => k.trim())
        .filter(Boolean);

  if (keys.length === 0) return true;

  const urlLower = url.toLowerCase();
  const fileName = getFilenameFromUrl(url).toLowerCase();

  const matchesToken = (token: string) => {
    const t = token.toLowerCase();

    // strict word-boundary try
    try {
      const wordBoundPattern = new RegExp(`\\b${escapeRegex(t)}\\b`, "i");
      if (wordBoundPattern.test(urlLower) || wordBoundPattern.test(fileName))
        return true;
    } catch {
      // ignore regex errors and fallback
    }

    // fallback to substring match
    if (urlLower.includes(t) || fileName.includes(t)) return true;
    return false;
  };

  // REQUIRE all tokens present (AND semantics)
  return keys.every((k) => matchesToken(k));
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractYearFromUrl(url: string): string | null {
  const standardYearMatch = url.match(/\b(20[0-2]\d)\b/);
  if (standardYearMatch) return standardYearMatch[1];

  const academicYearMatch = url.match(
    /\b(20[0-2]\d)[-_](20[0-2]\d|\d{2})\b/
  );
  if (academicYearMatch) return academicYearMatch[1];

  const fileName = getFilenameFromUrl(url);
  const fileYearMatch = fileName.match(/\b(20[0-2]\d)\b/);
  if (fileYearMatch) return fileYearMatch[1];

  return null;
}

function getFilenameFromUrl(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    const filename = pathname.split("/").pop() || "";
    return filename || `file-${Date.now()}.pdf`;
  } catch {
    return `file-${Date.now()}.pdf`;
  }
}

async function downloadPdfs(
  pdfs: string[],
  outDir: string,
  examName: string,
  filterType: "all" | "filtered" = "filtered"
): Promise<void> {
  if (pdfs.length === 0) {
    console.log(`No PDFs to download`);
    return;
  }

  console.log(`\nStarting download of ${pdfs.length} ${filterType} PDFs...`);

  let successful = 0;
  let failed = 0;
  const results: Array<{
    url: string;
    status: "success" | "failed";
    fileName?: string;
    error?: string;
  }> = [];

  for (let i = 0; i < pdfs.length; i++) {
    const pdfUrl = pdfs[i];
    const progress = `[${i + 1}/${pdfs.length}]`;

    try {
      console.log(`${progress} Downloading: ${getFilenameFromUrl(pdfUrl)}`);
      console.log(`    URL: ${pdfUrl}`);

      const result = await downloadPdf(pdfUrl, `${outDir}/${examName}`);

      if ((result as any).error) {
        console.warn(`  ❌ Download failed: ${(result as any).error}`);
        failed++;
        results.push({
          url: pdfUrl,
          status: "failed",
          error: (result as any).error,
        });
      } else {
        successful++;
        const fileName = (result as any).fileName || getFilenameFromUrl(pdfUrl);
        console.log(`  ✅ Saved: ${fileName}`);
        results.push({ url: pdfUrl, status: "success", fileName });
      }
    } catch (err) {
      console.warn(`  ❌ Error downloading: ${(err as Error).message}`);
      failed++;
      results.push({
        url: pdfUrl,
        status: "failed",
        error: (err as Error).message,
      });
    }

    if (i < pdfs.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 800));
    }

    if ((i + 1) % 5 === 0) {
      console.log(
        `    Progress: ${i + 1}/${pdfs.length} completed (${successful} successful, ${failed} failed)`
      );
    }
  }

  const downloadReport = {
    examName,
    downloadTimestamp: new Date().toISOString(),
    downloadType: filterType,
    totalAttempted: pdfs.length,
    successful,
    failed,
    successRate: `${((successful / pdfs.length) * 100).toFixed(1)}%`,
    results,
  };

  const reportPath = `${outDir}/${examName}/download-report-${filterType}.json`;
  writeFileSync(reportPath, JSON.stringify(downloadReport, null, 2), "utf-8");

  console.log(`\n📊 Download Summary:`);
  console.log(`    Total attempted: ${pdfs.length}`);
  console.log(`    Successful: ${successful}`);
  console.log(`    Failed: ${failed}`);
  console.log(`    Success rate: ${downloadReport.successRate}`);
  console.log(`    Report saved: ${reportPath}`);

  if (failed > 0) {
    console.log(`\n💡 Tips for failed downloads:`);
    console.log(`    - Some PDFs might be behind authentication`);
    console.log(`    - Server might be rate-limiting requests`);
    console.log(`    - Files might have been moved or deleted`);
    console.log(`    - Try running again later`);
  }
}

async function main() {
  const cfg = loadConfig();
  const cliExam = parseCliExam();
  const doDownload = argv.includes("--download");
  const outDir = cfg.global?.outDir ?? "data";
  const crawlMode =
    (parseArgFlag("--mode") as "normal" | "maximum" | "filtered") || "maximum";
  const dryRun = argv.includes("--dry-run");
  const downloadAll = argv.includes("--download-all");
  const runLLMFilter = argv.includes("--llm-filter");

  const examsToRun = cfg.exams.filter((e) => !cliExam || e.examName === cliExam);
  if (examsToRun.length === 0) {
    console.error("No exams found in config (or check --exam parameter).");
    console.log("Available exams:", cfg.exams.map((e) => e.examName).join(", "));
    process.exit(1);
  }

  console.log(`\n=== Enhanced PDF Scraper with ExamKey & LLM Support ===`);
  console.log(`Crawl mode: ${crawlMode.toUpperCase()}`);
  console.log(`Output directory: ${outDir}`);
  console.log(`Running exams: ${examsToRun.map((e) => e.examName).join(", ")}`);
  console.log(`Dry run: ${dryRun ? "YES (no downloads)" : "NO"}`);
  console.log(
    `Download mode: ${downloadAll ? "ALL PDFs" : "FILTERED by years/examKey only (local)"}`
  );

  for (const exam of examsToRun) {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`🎯 Exam: ${exam.examName} (${exam.label ?? "no-label"})`);
    if (exam.years && exam.years.length > 0) {
      console.log(`📅 Target years: ${exam.years.join(", ")}`);
    }
    if (exam.examKey) {
      const keyDisplay = Array.isArray(exam.examKey)
        ? exam.examKey.join(", ")
        : exam.examKey;
      console.log(`🔑 Exam key filter: "${keyDisplay}"`);
    }
    console.log(`${"=".repeat(60)}`);

    let allDiscoveredPdfs: string[] = [];
    let allFilteredPdfs: string[] = [];

    for (let i = 0; i < exam.seedUrls.length; i++) {
      const seed = exam.seedUrls[i];
      console.log(`\n📍 Processing seed ${i + 1}/${exam.seedUrls.length}: ${seed}`);

      try {
        const { allPdfs, filteredPdfs } = await (async () => {
          switch (crawlMode) {
            case "maximum":
              return { allPdfs: await expandOneLevelMaximum(seed), filteredPdfs: [] };
            case "normal":
              return { allPdfs: await expandOneLevelUnfiltered(seed), filteredPdfs: [] };
            case "filtered":
              return {
                allPdfs: await expandOneLevel(
                  seed,
                  exam.examName,
                  exam.years ?? ["2023", "2024", "2025"],
                  exam.examKey
                ),
                filteredPdfs: [],
              };
            default:
              return { allPdfs: await expandOneLevelUnfiltered(seed), filteredPdfs: [] };
          }
        })();

        allDiscoveredPdfs.push(...allPdfs);
        allFilteredPdfs.push(...filteredPdfs);

        if (allPdfs.length === 0) {
          console.log(`⚠️  No PDFs found from this seed. Trying next seed...`);
        }
      } catch (error) {
        console.error(`❌ Error processing seed ${seed}:`, (error as Error).message);
        console.log(`Continuing with next seed...`);
      }
    }

    const uniqueAllPdfs = Array.from(new Set(allDiscoveredPdfs));
    const uniqueFilteredPdfs = Array.from(new Set(allFilteredPdfs));

    console.log(`\n📋 Discovery Summary for ${exam.examName}:`);
    console.log(`    Total unique PDFs found: ${uniqueAllPdfs.length}`);

    const filterCriteria = [] as string[];
    if (exam.years && exam.years.length > 0) filterCriteria.push(`years: ${exam.years.join(", ")}`);
    if (exam.examKey) {
      const k = Array.isArray(exam.examKey) ? exam.examKey.join(", ") : exam.examKey;
      filterCriteria.push(`examKey: "${k}"`);
    }

    if (filterCriteria.length > 0) {
      console.log(
        `    Filtered PDFs (${filterCriteria.join(", ")}): ${uniqueFilteredPdfs.length}`
      );
    }
    console.log(`    From ${exam.seedUrls.length} seed URL(s)`);

    // Apply a basic examKey filename filter if exam.examKey exists (AND semantics)
    const basicExamKeyFiltered = exam.examKey
      ? uniqueAllPdfs.filter((url) => {
          const keys = Array.isArray(exam.examKey)
            ? (exam.examKey as any[]).map(k => String(k).trim()).filter(Boolean)
            : String(exam.examKey).split(",").map(k => k.trim()).filter(Boolean);

          if (keys.length === 0) return true;

          const fileName = getFilenameFromUrl(url).toLowerCase();
          const urlLower = url.toLowerCase();

          // require every key present either in filename or url (word-boundary first, fallback to includes)
          const tokenMatches = (token: string) => {
            try {
              const p = new RegExp(`\\b${escapeRegex(token)}\\b`, "i");
              if (p.test(fileName) || p.test(urlLower)) return true;
            } catch { /* ignore */ }
            return fileName.includes(token.toLowerCase()) || urlLower.includes(token.toLowerCase());
          };

          return keys.every(k => tokenMatches(k));
        })
      : uniqueAllPdfs;

    // build and save unified manifest for the selected PDFs (examKey-filtered if examKey set)
    const host = exam.seedUrls[0]
      ? new URL(exam.seedUrls[0]).hostname.replace(/\./g, "-")
      : exam.examName.replace(/\s+/g, "-");
    const dir = `${outDir}/${exam.examName}`;
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    const mainManifest = {
      seedUrls: exam.seedUrls,
      seedHost: host,
      examName: exam.examName,
      examKey: exam.examKey,
      filterYears: exam.years,
      crawlMode,
      crawlTimestamp: new Date().toISOString(),
      totalDiscovered: uniqueAllPdfs.length,
      totalSelectedByExamKey: basicExamKeyFiltered.length,
      pdfs: basicExamKeyFiltered.map((url, index) => ({
        id: index + 1,
        url,
        filename: getFilenameFromUrl(url),
        yearDetected: extractYearFromUrl(url),
      })),
    };

    const mainManifestPath = `${dir}/${host}-manifest.json`;
    writeFileSync(mainManifestPath, JSON.stringify(mainManifest, null, 2), "utf-8");
    console.log(`     Saved main manifest: ${mainManifestPath}`);

    // Download phase: now downloads selected PDFs if --download passed
    if (!dryRun && doDownload) {
      // if --download-all is used, override and download everything discovered
      const toDownload = downloadAll ? uniqueAllPdfs : basicExamKeyFiltered;

      if (toDownload.length > 0) {
        await downloadPdfs(toDownload, outDir, exam.examName, downloadAll ? "all" : "filtered");
      } else {
        console.log("No PDFs to download after examKey filter.");
      }
    } else if (dryRun) {
      console.log(`\n🔍 Dry run complete - no downloads performed`);
      console.log(`   Use --download flag to download discovered PDFs`);
    } else if (!doDownload) {
      console.log(`\n💾 Discovery complete - use --download flag to download files`);
    }

    console.log(`\n✅ Completed processing exam: ${exam.examName}`);
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log("🎉 All exams processed successfully!");
  console.log(`${"=".repeat(60)}`);

  console.log("\n📚 Usage Examples:");
  console.log("  # Discover PDFs (no download):");
  console.log("  npm run dev");
  console.log("  npm run dev -- --exam SSC-CHSL");
  console.log("");
  console.log("  # Discover and download ALL discovered PDFs:");
  console.log("  npm run dev -- --download");
  console.log("");
  console.log("  # Run LLM filtering (reads saved manifest and creates filtered JSON):");
  console.log("  npm run dev -- --llm-filter");
  console.log("");
  console.log("  # Do both:");
  console.log("  npm run dev -- --download --llm-filter");
  console.log("");
  console.log("  # Dry run (discover only, no downloads):");
  console.log("  npm run dev -- --dry-run");
  console.log("");
  console.log("💡 Tips:");
  console.log('  - Add "years": ["2023", "2024", "2025"] and "examKey": ["ssc","chsl"] in your config.json');
  console.log('  - examKey should be a keyword from the exam name (e.g., ["ssc","chsl"], ["ibps","po"])');
  console.log("  - Use --dry-run to preview discovery");
  console.log("  - Use --llm-filter to generate an LLM-based filtered manifest");
}

main().catch((err) => {
  console.error("💥 Fatal error:", (err as Error).message);
  console.error("Stack trace:", (err as Error).stack);
  process.exit(1);
});
