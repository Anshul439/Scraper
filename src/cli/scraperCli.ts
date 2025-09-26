#!/usr/bin/env node
import { argv } from "process";
import { existsSync, readFileSync, mkdirSync, writeFileSync } from "fs";
import {
  expandOneLevelUnfiltered,
  expandOneLevelMaximum,
  expandOneLevel,
} from "../crawler";
import { downloadPdf } from "../downloader";
import { AppConfig } from "../types/config.types";

function loadConfig(path = "./config.json"): AppConfig {
  if (!existsSync(path)) throw new Error(`Config not found at ${path}`);
  const raw = readFileSync(path, "utf-8");
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
 * Enhanced filter that combines year and examKey filtering
 */
function filterPdfsByYearsAndExamKey(
  pdfs: string[],
  targetYears?: string[],
  examKey?: string
): string[] {
  console.log(`\nFiltering ${pdfs.length} PDFs...`);
  if (targetYears && targetYears.length > 0) {
    console.log(`  Years: ${targetYears.join(", ")}`);
  }
  if (examKey) {
    console.log(`  Exam key: "${examKey}"`);
  }

  const filtered = pdfs.filter((url) => {
    // Must be a PDF
    if (!/\.pdf($|\?)/i.test(url)) return false;

    let matchesYear = true;
    let matchesExamKey = true;

    // Year filter (if specified)
    if (targetYears && targetYears.length > 0) {
      matchesYear = checkYearMatch(url, targetYears);
    }

    // ExamKey filter (if specified)
    if (examKey && examKey.trim()) {
      matchesExamKey = checkExamKeyMatch(url, examKey);
    }

    return matchesYear && matchesExamKey;
  });

  console.log(`Filtered down to ${filtered.length} PDFs`);

  // Detailed breakdown of filtering results
  if (targetYears && targetYears.length > 0) {
    const yearMatches = pdfs.filter((url) => checkYearMatch(url, targetYears));
    console.log(
      `  ${yearMatches.length} matched year criteria (${targetYears.join(
        ", "
      )})`
    );
  }
  if (examKey) {
    const examKeyMatches = pdfs.filter((url) =>
      checkExamKeyMatch(url, examKey)
    );
    console.log(
      `  ${examKeyMatches.length} matched examKey criteria ("${examKey}")`
    );
  }

  // Show some examples of filtered PDFs
  if (filtered.length > 0) {
    console.log(`\nSample filtered PDFs:`);
    filtered.slice(0, 5).forEach((url, idx) => {
      const year = extractYearFromUrl(url);
      const fileName = getFilenameFromUrl(url);
      console.log(
        `  ${idx + 1}. ${fileName} ${year ? `(${year})` : "(no year)"}`
      );
    });
    if (filtered.length > 5) {
      console.log(`  ... and ${filtered.length - 5} more`);
    }
  }

  return filtered;
}

function checkYearMatch(url: string, targetYears: string[]): boolean {
  // Strategy 1: Direct year pattern in URL
  const directYearPattern = new RegExp(`\\b(${targetYears.join("|")})\\b`, "i");
  if (directYearPattern.test(url)) {
    return true;
  }

  // Strategy 2: Year in filename
  const fileName = getFilenameFromUrl(url);
  if (directYearPattern.test(fileName)) {
    return true;
  }

  // Strategy 3: Year with common separators (2023-24, 2023_24, etc.)
  for (const year of targetYears) {
    const yearNum = parseInt(year);
    if (isNaN(yearNum)) continue;

    // Check for academic year patterns like 2023-24, 2023-2024
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
      if (url.toLowerCase().includes(pattern.toLowerCase())) {
        return true;
      }
    }

    // Check for reverse patterns (24-2023, etc.)
    const prevYear = yearNum - 1;
    const shortPrevYear = prevYear.toString().slice(-2);

    const reversePatterns = [`${shortPrevYear}-${year}`, `${prevYear}-${year}`];

    for (const pattern of reversePatterns) {
      if (url.toLowerCase().includes(pattern.toLowerCase())) {
        return true;
      }
    }
  }

  return false;
}

function checkExamKeyMatch(url: string, examKey: string): boolean {
  const cleanExamKey = examKey.trim().toLowerCase();
  const urlLower = url.toLowerCase();

  // Strategy 1: Direct match with word boundaries
  const directPattern = new RegExp(`\\b${escapeRegex(cleanExamKey)}\\b`, "i");
  if (directPattern.test(url)) {
    return true;
  }

  // Strategy 2: Match in filename specifically
  const fileName = getFilenameFromUrl(url);
  if (directPattern.test(fileName)) {
    return true;
  }

  // Strategy 3: Flexible matching with separators
  const flexiblePattern = cleanExamKey.split("").join("[-_\\s]*");
  if (new RegExp(`\\b${flexiblePattern}\\b`, "i").test(url)) {
    return true;
  }

  // Strategy 4: Common prefixed versions
  const commonPrefixes = ["ssc", "ibps", "upsc", "rrb", "bank", "railway"];
  for (const prefix of commonPrefixes) {
    if (!cleanExamKey.startsWith(prefix)) {
      const prefixedPattern = new RegExp(
        `\\b${prefix}[-_\\s]*${escapeRegex(cleanExamKey)}\\b`,
        "i"
      );
      if (prefixedPattern.test(url)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Escape special regex characters
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Enhanced PDF discovery with year and examKey based filtering
 */
async function discoverPdfs(
  seedUrl: string,
  examName: string,
  outDir: string,
  years?: string[],
  examKey?: string,
  mode: "normal" | "maximum" | "filtered" = "maximum"
): Promise<{ allPdfs: string[]; filteredPdfs: string[] }> {
  console.log(`\n  -> Discovering PDFs from: ${seedUrl}`);
  console.log(`     Mode: ${mode}`);
  if (years && years.length > 0)
    console.log(`     Year filters: ${years.join(", ")}`);
  if (examKey) console.log(`     Exam key filter: "${examKey}"`);

  let allPdfs: string[] = [];

  switch (mode) {
    case "maximum":
      allPdfs = await expandOneLevelMaximum(seedUrl);
      break;
    case "normal":
      allPdfs = await expandOneLevelUnfiltered(seedUrl);
      break;
    case "filtered":
      // Use filtered search with years and examKey
      allPdfs = await expandOneLevel(
        seedUrl,
        examName,
        years || ["2023", "2024", "2025"],
        examKey
      );
      break;
    default:
      allPdfs = await expandOneLevelUnfiltered(seedUrl);
  }

  console.log(`     Total PDFs discovered: ${allPdfs.length}`);

  // Apply enhanced year and examKey filtering
  let filteredPdfs: string[] = [];
  if ((years && years.length > 0) || examKey) {
    filteredPdfs = filterPdfsByYearsAndExamKey(allPdfs, years, examKey);
  } else {
    // If no filters specified, use all PDFs
    filteredPdfs = allPdfs;
  }

  // Enhanced logging for debugging
  if (allPdfs.length === 0) {
    console.log(`     ⚠️  No PDFs found. This could mean:`);
    console.log(`        - The site structure is complex/unusual`);
    console.log(`        - PDFs are behind forms/authentication`);
    console.log(`        - Site uses JavaScript to load content`);
    console.log(`        - Rate limiting is blocking requests`);
  } else if (
    filteredPdfs.length === 0 &&
    ((years && years.length > 0) || examKey)
  ) {
    console.log(`     ⚠️  PDFs found but none match your filters:`);
    if (years && years.length > 0) {
      console.log(`        - Years: ${years.join(", ")}`);
      console.log(`        - Try expanding year range or check URL patterns`);
    }
    if (examKey) {
      console.log(`        - ExamKey: "${examKey}"`);
      console.log(`        - Try different exam key variations`);
    }

    // Show sample URLs for debugging
    console.log(`     Sample URLs found (for debugging):`);
    allPdfs.slice(0, 3).forEach((url, idx) => {
      const year = extractYearFromUrl(url);
      console.log(
        `        ${idx + 1}. ${getFilenameFromUrl(url)} ${
          year ? `(${year})` : "(no year detected)"
        }`
      );
    });
  }

  // Create output directory
  const host = new URL(seedUrl).hostname.replace(/\./g, "-");
  const dir = `${outDir}/${examName}`;
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  // Save enhanced manifests with better year information
  const mainManifest = {
    seedUrl,
    examName,
    examKey,
    filterYears: years,
    crawlMode: mode,
    crawlTimestamp: new Date().toISOString(),
    totalPdfs: allPdfs.length,
    totalFilteredPdfs: filteredPdfs.length,
    filteringApplied: (years && years.length > 0) || !!examKey,
    pdfs: allPdfs.map((url, index) => ({
      id: index + 1,
      url,
      filename: getFilenameFromUrl(url),
      yearDetected: extractYearFromUrl(url),
      yearMatches:
        years && years.length > 0 ? checkYearMatch(url, years) : null,
      examKeyMatch: examKey ? checkExamKeyMatch(url, examKey) : null,
      passesFilters: filteredPdfs.includes(url),
    })),
  };

  const mainManifestPath = `${dir}/${host}-manifest.json`;
  writeFileSync(
    mainManifestPath,
    JSON.stringify(mainManifest, null, 2),
    "utf-8"
  );
  console.log(`     Saved main manifest: ${mainManifestPath}`);

  // Save filtered manifest if filtering criteria are specified
  if (((years && years.length > 0) || examKey) && filteredPdfs.length > 0) {
    const filterSuffix = [
      examKey ? `examkey-${examKey}` : "",
      years && years.length > 0 ? `years-${years.join("-")}` : "",
    ]
      .filter(Boolean)
      .join("-");

    const filteredManifest = {
      seedUrl,
      examName,
      examKey,
      crawlMode: mode,
      crawlTimestamp: new Date().toISOString(),
      filterYears: years,
      filterExamKey: examKey,
      totalFilteredPdfs: filteredPdfs.length,
      totalAllPdfs: allPdfs.length,
      filteringStrategy: "enhanced-year-and-examkey",
      pdfs: filteredPdfs.map((url, index) => ({
        id: index + 1,
        url,
        filename: getFilenameFromUrl(url),
        yearDetected: extractYearFromUrl(url),
        examKeyMatch: examKey ? checkExamKeyMatch(url, examKey) : null,
      })),
    };

    const filteredManifestPath = `${dir}/${host}-manifest-filtered-${filterSuffix}.json`;
    writeFileSync(
      filteredManifestPath,
      JSON.stringify(filteredManifest, null, 2),
      "utf-8"
    );
    console.log(`     Saved filtered manifest: ${filteredManifestPath}`);
  }

  return { allPdfs, filteredPdfs };
}

/**
 * Extract year from URL
 */
function extractYearFromUrl(url: string): string | null {
  // Try different year extraction strategies

  // Strategy 1: Standard 4-digit year
  const standardYearMatch = url.match(/\b(20[0-2]\d)\b/);
  if (standardYearMatch) {
    return standardYearMatch[1];
  }

  // Strategy 2: Academic year patterns (2023-24, 2023-2024)
  const academicYearMatch = url.match(/\b(20[0-2]\d)[-_](20[0-2]\d|\d{2})\b/);
  if (academicYearMatch) {
    return academicYearMatch[1]; // Return the first year
  }

  // Strategy 3: Year in filename
  const fileName = getFilenameFromUrl(url);
  const fileYearMatch = fileName.match(/\b(20[0-2]\d)\b/);
  if (fileYearMatch) {
    return fileYearMatch[1];
  }

  return null;
}

/**
 * Extract filename from URL
 */
function getFilenameFromUrl(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    const filename = pathname.split("/").pop() || "";
    return filename || `file-${Date.now()}.pdf`;
  } catch {
    return `file-${Date.now()}.pdf`;
  }
}

/**
 * Download PDFs with progress tracking
 */
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

    // Respectful delay between downloads
    if (i < pdfs.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 800));
    }

    // Progress update every 5 downloads
    if ((i + 1) % 5 === 0) {
      console.log(
        `    Progress: ${i + 1}/${
          pdfs.length
        } completed (${successful} successful, ${failed} failed)`
      );
    }
  }

  // Save download results
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
  const downloadAll = argv.includes("--download-all"); // New flag to download all PDFs instead of filtered

  // Filter exams to run
  const examsToRun = cfg.exams.filter(
    (e) => !cliExam || e.examName === cliExam
  );
  if (examsToRun.length === 0) {
    console.error("No exams found in config (or check --exam parameter).");
    console.log(
      "Available exams:",
      cfg.exams.map((e) => e.examName).join(", ")
    );
    process.exit(1);
  }

  console.log(`\n=== Enhanced PDF Scraper with ExamKey Support ===`);
  console.log(`Crawl mode: ${crawlMode.toUpperCase()}`);
  console.log(`Output directory: ${outDir}`);
  console.log(`Running exams: ${examsToRun.map((e) => e.examName).join(", ")}`);
  console.log(`Dry run: ${dryRun ? "YES (no downloads)" : "NO"}`);
  console.log(
    `Download mode: ${
      downloadAll ? "ALL PDFs" : "FILTERED by years/examKey only"
    }`
  );

  for (const exam of examsToRun) {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`🎯 Exam: ${exam.examName} (${exam.label ?? "no-label"})`);
    if (exam.years && exam.years.length > 0) {
      console.log(`📅 Target years: ${exam.years.join(", ")}`);
    }
    if (exam.examKey) {
      console.log(`🔑 Exam key filter: "${exam.examKey}"`);
    }
    console.log(`${"=".repeat(60)}`);

    let allDiscoveredPdfs: string[] = [];
    let allFilteredPdfs: string[] = [];

    // Process each seed URL
    for (let i = 0; i < exam.seedUrls.length; i++) {
      const seed = exam.seedUrls[i];
      console.log(
        `\n📍 Processing seed ${i + 1}/${exam.seedUrls.length}: ${seed}`
      );

      try {
        const { allPdfs, filteredPdfs } = await discoverPdfs(
          seed,
          exam.examName,
          outDir,
          exam.years,
          exam.examKey, // Pass examKey to discovery
          crawlMode
        );
        allDiscoveredPdfs.push(...allPdfs);
        allFilteredPdfs.push(...filteredPdfs);

        if (allPdfs.length === 0) {
          console.log(`⚠️  No PDFs found from this seed. Trying next seed...`);
        }
      } catch (error) {
        console.error(
          `❌ Error processing seed ${seed}:`,
          (error as Error).message
        );
        console.log(`Continuing with next seed...`);
      }
    }

    // Remove duplicates
    const uniqueAllPdfs = Array.from(new Set(allDiscoveredPdfs));
    const uniqueFilteredPdfs = Array.from(new Set(allFilteredPdfs));

    console.log(`\n📋 Discovery Summary for ${exam.examName}:`);
    console.log(`    Total unique PDFs found: ${uniqueAllPdfs.length}`);

    const filterCriteria = [];
    if (exam.years && exam.years.length > 0) {
      filterCriteria.push(`years: ${exam.years.join(", ")}`);
    }
    if (exam.examKey) {
      filterCriteria.push(`examKey: "${exam.examKey}"`);
    }

    if (filterCriteria.length > 0) {
      console.log(
        `    Filtered PDFs (${filterCriteria.join(", ")}): ${
          uniqueFilteredPdfs.length
        }`
      );
    }
    console.log(`    From ${exam.seedUrls.length} seed URL(s)`);

    if (uniqueFilteredPdfs.length > 0) {
      console.log(`\n📄 Filtered PDFs found:`);
      uniqueFilteredPdfs.slice(0, 10).forEach((url, idx) => {
        const year = extractYearFromUrl(url);
        const fileName = getFilenameFromUrl(url);
        const examKeyMatch = exam.examKey
          ? new RegExp(`\\b${escapeRegex(exam.examKey)}\\b`, "i").test(url)
          : false;
        console.log(
          `    ${idx + 1}. ${fileName} ${year ? `(${year})` : ""} ${
            examKeyMatch ? `[${exam.examKey}✓]` : ""
          }`
        );
        if (idx < 3) console.log(`       ${url}`);
      });
      if (uniqueFilteredPdfs.length > 10) {
        console.log(`    ... and ${uniqueFilteredPdfs.length - 10} more`);
      }
    }

    // Download phase
    if (!dryRun && doDownload) {
      if (downloadAll) {
        // Download all discovered PDFs
        if (uniqueAllPdfs.length > 0) {
          await downloadPdfs(uniqueAllPdfs, outDir, exam.examName, "all");
        }
      } else {
        // Download only filtered PDFs (default behavior)
        const hasFilters =
          (exam.years && exam.years.length > 0) || exam.examKey;
        if (hasFilters && uniqueFilteredPdfs.length > 0) {
          await downloadPdfs(
            uniqueFilteredPdfs,
            outDir,
            exam.examName,
            "filtered"
          );
        } else if (!hasFilters) {
          console.log(
            `\n⚠️  No filters specified in config for ${exam.examName}. Skipping download.`
          );
          console.log(
            `   Add "years": ["2023", "2024"] and/or "examKey": "chsl" to config or use --download-all flag.`
          );
        } else {
          console.log(
            `\n⚠️  No PDFs found matching the specified filters for ${exam.examName}.`
          );
        }
      }
    } else if (dryRun) {
      console.log(`\n🔍 Dry run complete - no downloads performed`);
      console.log(`   Use --download flag to download filtered PDFs`);
      console.log(`   Use --download --download-all flag to download all PDFs`);
    } else if (!doDownload) {
      console.log(
        `\n💾 Discovery complete - use --download flag to download files`
      );
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
  console.log(
    "  # Discover and download filtered PDFs (by years and examKey in config):"
  );
  console.log("  npm run dev -- --download");
  console.log("  npm run dev -- --exam SSC-CHSL --download");
  console.log("");
  console.log("  # Download ALL discovered PDFs (ignore filters):");
  console.log("  npm run dev -- --download --download-all");
  console.log("");
  console.log("  # Different crawl modes:");
  console.log(
    "  npm run dev -- --mode maximum --download    # Most aggressive (default)"
  );
  console.log(
    "  npm run dev -- --mode normal --download     # Standard crawling"
  );
  console.log(
    "  npm run dev -- --mode filtered --download   # Filter during crawl"
  );
  console.log("");
  console.log("  # Dry run (discover only, no downloads):");
  console.log("  npm run dev -- --dry-run");
  console.log("");
  console.log("💡 Tips:");
  console.log(
    '  - Add "years": ["2023", "2024", "2025"] and "examKey": "chsl" in your config.json'
  );
  console.log(
    '  - examKey should be a keyword from the exam name (e.g., "chsl", "cgl", "po")'
  );
  console.log("  - Start with --dry-run to see what will be downloaded");
  console.log("  - Use --download-all to ignore year and examKey filtering");
  console.log("  - Check the manifest files for all discovered PDFs");
  console.log(
    "  - Filtered manifest will be created when filters are specified"
  );
}

main().catch((err) => {
  console.error("💥 Fatal error:", (err as Error).message);
  console.error("Stack trace:", (err as Error).stack);
  process.exit(1);
});
