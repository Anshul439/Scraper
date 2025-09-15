#!/usr/bin/env node
import { argv } from 'process';
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'fs';
import { expandOneLevelUnfiltered, expandOneLevelMaximum, expandOneLevel } from './scraper/httpCrawler';
import { downloadPdf } from './downloader/index';

type ExamConfig = {
  examName: string;
  label?: string;
  examKey?: string;  // NEW: keyword for filtering PDFs
  seedUrls: string[];
  years?: string[];  // Array of years for filtering
  usePuppeteer?: boolean;
};

type AppConfig = {
  exams: ExamConfig[];
  global?: {
    outDir?: string;
    defaultMaxDownloadsPerExam?: number;
  };
};

function loadConfig(path = './config.json'): AppConfig {
  if (!existsSync(path)) throw new Error(`Config not found at ${path}`);
  const raw = readFileSync(path, 'utf-8');
  return JSON.parse(raw) as AppConfig;
}

function parseCliExam(): string | undefined {
  const idx = argv.indexOf('--exam');
  if (idx === -1) return undefined;
  return argv[idx + 1];
}

function parseArgFlag(flag: string) {
  const idx = argv.indexOf(flag);
  if (idx === -1) return undefined;
  const val = argv[idx + 1];
  if (!val || val.startsWith('--')) return true;
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
    console.log(`  Years: ${targetYears.join(', ')}`);
  }
  if (examKey) {
    console.log(`  Exam key: "${examKey}"`);
  }
  
  const filtered = pdfs.filter(url => {
    // Must be a PDF
    if (!/\.pdf($|\?)/i.test(url)) return false;
    
    let matchesYear = true;
    let matchesExamKey = true;
    
    // Year filter (if specified)
    if (targetYears && targetYears.length > 0) {
      const yearPattern = new RegExp(`\\b(${targetYears.join('|')})\\b`, 'i');
      matchesYear = yearPattern.test(url);
    }
    
    // ExamKey filter (if specified)
    if (examKey && examKey.trim()) {
      // Create flexible pattern for examKey
      const cleanExamKey = examKey.trim().toLowerCase();
      const examKeyPattern = new RegExp(`\\b${escapeRegex(cleanExamKey)}\\b`, 'i');
      matchesExamKey = examKeyPattern.test(url);
    }
    
    return matchesYear && matchesExamKey;
  });
  
  console.log(`Filtered down to ${filtered.length} PDFs`);
  if (targetYears && targetYears.length > 0) {
    console.log(`  ${filtered.filter(url => new RegExp(`\\b(${targetYears.join('|')})\\b`, 'i').test(url)).length} matched year criteria`);
  }
  if (examKey) {
    console.log(`  ${filtered.filter(url => new RegExp(`\\b${escapeRegex(examKey.trim())}\\b`, 'i').test(url)).length} matched examKey criteria`);
  }
  
  return filtered;
}

/**
 * Escape special regex characters
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
  mode: 'normal' | 'maximum' | 'filtered' = 'maximum'
): Promise<{ allPdfs: string[], filteredPdfs: string[] }> {
  console.log(`\n  -> Discovering PDFs from: ${seedUrl}`);
  console.log(`     Mode: ${mode}`);
  if (examKey) console.log(`     Exam key filter: "${examKey}"`);
  
  let allPdfs: string[] = [];
  
  switch (mode) {
    case 'maximum':
      allPdfs = await expandOneLevelMaximum(seedUrl);
      break;
    case 'normal':
      allPdfs = await expandOneLevelUnfiltered(seedUrl);
      break;
    case 'filtered':
      // Use filtered search if years are specified
      allPdfs = await expandOneLevel(seedUrl, examName, years || ['2020', '2021', '2022', '2023', '2024', '2025'], examKey);
      break;
    default:
      allPdfs = await expandOneLevelUnfiltered(seedUrl);
  }
  
  console.log(`     Total PDFs discovered: ${allPdfs.length}`);

  // Apply combined year and examKey filtering
  let filteredPdfs: string[] = [];
  if ((years && years.length > 0) || examKey) {
    filteredPdfs = filterPdfsByYearsAndExamKey(allPdfs, years, examKey);
  }

  if (allPdfs.length === 0) {
    console.log(`     ⚠️  No PDFs found. This could mean:`);
    console.log(`        - The site structure is complex/unusual`);
    console.log(`        - PDFs are behind forms/authentication`);
    console.log(`        - Site uses JavaScript to load content`);
    console.log(`        - Rate limiting is blocking requests`);
  }

  // Create output directory
  const host = new URL(seedUrl).hostname.replace(/\./g, '-');
  const dir = `${outDir}/${examName}`;
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  
  // Save main manifest with all PDFs
  const mainManifest = {
    seedUrl,
    examName,
    examKey,
    crawlMode: mode,
    crawlTimestamp: new Date().toISOString(),
    totalPdfs: allPdfs.length,
    pdfs: allPdfs.map((url, index) => ({
      id: index + 1,
      url,
      filename: getFilenameFromUrl(url),
      yearFound: extractYearFromUrl(url),
      examKeyMatch: examKey ? new RegExp(`\\b${escapeRegex(examKey)}\\b`, 'i').test(url) : null
    }))
  };

  const mainManifestPath = `${dir}/${host}-manifest.json`;
  writeFileSync(mainManifestPath, JSON.stringify(mainManifest, null, 2), 'utf-8');
  console.log(`     Saved main manifest: ${mainManifestPath}`);

  // Save filtered manifest if filtering criteria are specified
  if (((years && years.length > 0) || examKey) && filteredPdfs.length > 0) {
    const filterSuffix = [
      examKey ? `examkey-${examKey}` : '',
      years && years.length > 0 ? `years-${years.join('-')}` : ''
    ].filter(Boolean).join('-');

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
      pdfs: filteredPdfs.map((url, index) => ({
        id: index + 1,
        url,
        filename: getFilenameFromUrl(url),
        yearFound: extractYearFromUrl(url),
        examKeyMatch: examKey ? new RegExp(`\\b${escapeRegex(examKey)}\\b`, 'i').test(url) : null
      }))
    };

    const filteredManifestPath = `${dir}/${host}-manifest-filtered-${filterSuffix}.json`;
    writeFileSync(filteredManifestPath, JSON.stringify(filteredManifest, null, 2), 'utf-8');
    console.log(`     Saved filtered manifest: ${filteredManifestPath}`);
  }

  return { allPdfs, filteredPdfs };
}

/**
 * Extract year from URL
 */
function extractYearFromUrl(url: string): string | null {
  const yearMatch = url.match(/\b(20\d{2})\b/);
  return yearMatch ? yearMatch[1] : null;
}

/**
 * Extract filename from URL
 */
function getFilenameFromUrl(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    const filename = pathname.split('/').pop() || '';
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
  filterType: 'all' | 'filtered' = 'filtered'
): Promise<void> {
  if (pdfs.length === 0) {
    console.log(`No PDFs to download`);
    return;
  }

  console.log(`\nStarting download of ${pdfs.length} ${filterType} PDFs...`);
  
  let successful = 0;
  let failed = 0;
  const results: Array<{ url: string; status: 'success' | 'failed'; fileName?: string; error?: string }> = [];

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
        results.push({ url: pdfUrl, status: 'failed', error: (result as any).error });
      } else {
        successful++;
        const fileName = (result as any).fileName || getFilenameFromUrl(pdfUrl);
        console.log(`  ✅ Saved: ${fileName}`);
        results.push({ url: pdfUrl, status: 'success', fileName });
      }
    } catch (err) {
      console.warn(`  ❌ Error downloading: ${(err as Error).message}`);
      failed++;
      results.push({ url: pdfUrl, status: 'failed', error: (err as Error).message });
    }
    
    // Respectful delay between downloads
    if (i < pdfs.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 800));
    }
    
    // Progress update every 5 downloads
    if ((i + 1) % 5 === 0) {
      console.log(`    Progress: ${i + 1}/${pdfs.length} completed (${successful} successful, ${failed} failed)`);
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
    results
  };

  const reportPath = `${outDir}/${examName}/download-report-${filterType}.json`;
  writeFileSync(reportPath, JSON.stringify(downloadReport, null, 2), 'utf-8');
  
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
  const doDownload = argv.includes('--download');
  const outDir = cfg.global?.outDir ?? 'data';
  const crawlMode = parseArgFlag('--mode') as 'normal' | 'maximum' | 'filtered' || 'maximum';
  const dryRun = argv.includes('--dry-run');
  const downloadAll = argv.includes('--download-all'); // New flag to download all PDFs instead of filtered
  
  // Filter exams to run
  const examsToRun = cfg.exams.filter((e) => !cliExam || e.examName === cliExam);
  if (examsToRun.length === 0) {
    console.error('No exams found in config (or check --exam parameter).');
    console.log('Available exams:', cfg.exams.map(e => e.examName).join(', '));
    process.exit(1);
  }

  console.log(`\n=== Enhanced PDF Scraper with ExamKey Support ===`);
  console.log(`Crawl mode: ${crawlMode.toUpperCase()}`);
  console.log(`Output directory: ${outDir}`);
  console.log(`Running exams: ${examsToRun.map(e => e.examName).join(', ')}`);
  console.log(`Dry run: ${dryRun ? 'YES (no downloads)' : 'NO'}`);
  console.log(`Download mode: ${downloadAll ? 'ALL PDFs' : 'FILTERED by years/examKey only'}`);

  for (const exam of examsToRun) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`🎯 Exam: ${exam.examName} (${exam.label ?? 'no-label'})`);
    if (exam.years && exam.years.length > 0) {
      console.log(`📅 Target years: ${exam.years.join(', ')}`);
    }
    if (exam.examKey) {
      console.log(`🔑 Exam key filter: "${exam.examKey}"`);
    }
    console.log(`${'='.repeat(60)}`);

    let allDiscoveredPdfs: string[] = [];
    let allFilteredPdfs: string[] = [];

    // Process each seed URL
    for (let i = 0; i < exam.seedUrls.length; i++) {
      const seed = exam.seedUrls[i];
      console.log(`\n📍 Processing seed ${i + 1}/${exam.seedUrls.length}: ${seed}`);
      
      try {
        const { allPdfs, filteredPdfs } = await discoverPdfs(
          seed, 
          exam.examName, 
          outDir, 
          exam.years, 
          exam.examKey,  // Pass examKey to discovery
          crawlMode
        );
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

    // Remove duplicates
    const uniqueAllPdfs = Array.from(new Set(allDiscoveredPdfs));
    const uniqueFilteredPdfs = Array.from(new Set(allFilteredPdfs));

    console.log(`\n📋 Discovery Summary for ${exam.examName}:`);
    console.log(`    Total unique PDFs found: ${uniqueAllPdfs.length}`);
    
    const filterCriteria = [];
    if (exam.years && exam.years.length > 0) {
      filterCriteria.push(`years: ${exam.years.join(', ')}`);
    }
    if (exam.examKey) {
      filterCriteria.push(`examKey: "${exam.examKey}"`);
    }
    
    if (filterCriteria.length > 0) {
      console.log(`    Filtered PDFs (${filterCriteria.join(', ')}): ${uniqueFilteredPdfs.length}`);
    }
    console.log(`    From ${exam.seedUrls.length} seed URL(s)`);
    
    if (uniqueFilteredPdfs.length > 0) {
      console.log(`\n📄 Filtered PDFs found:`);
      uniqueFilteredPdfs.slice(0, 10).forEach((url, idx) => {
        const year = extractYearFromUrl(url);
        const fileName = getFilenameFromUrl(url);
        const examKeyMatch = exam.examKey ? new RegExp(`\\b${escapeRegex(exam.examKey)}\\b`, 'i').test(url) : false;
        console.log(`    ${idx + 1}. ${fileName} ${year ? `(${year})` : ''} ${examKeyMatch ? `[${exam.examKey}✓]` : ''}`);
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
          await downloadPdfs(uniqueAllPdfs, outDir, exam.examName, 'all');
        }
      } else {
        // Download only filtered PDFs (default behavior)
        const hasFilters = (exam.years && exam.years.length > 0) || exam.examKey;
        if (hasFilters && uniqueFilteredPdfs.length > 0) {
          await downloadPdfs(uniqueFilteredPdfs, outDir, exam.examName, 'filtered');
        } else if (!hasFilters) {
          console.log(`\n⚠️  No filters specified in config for ${exam.examName}. Skipping download.`);
          console.log(`   Add "years": ["2023", "2024"] and/or "examKey": "chsl" to config or use --download-all flag.`);
        } else {
          console.log(`\n⚠️  No PDFs found matching the specified filters for ${exam.examName}.`);
        }
      }
    } else if (dryRun) {
      console.log(`\n🔍 Dry run complete - no downloads performed`);
      console.log(`   Use --download flag to download filtered PDFs`);
      console.log(`   Use --download --download-all flag to download all PDFs`);
    } else if (!doDownload) {
      console.log(`\n💾 Discovery complete - use --download flag to download files`);
    }

    console.log(`\n✅ Completed processing exam: ${exam.examName}`);
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log('🎉 All exams processed successfully!');
  console.log(`${'='.repeat(60)}`);
  
  console.log('\n📚 Usage Examples:');
  console.log('  # Discover PDFs (no download):');
  console.log('  npm run dev');
  console.log('  npm run dev -- --exam SSC-CHSL');
  console.log('');
  console.log('  # Discover and download filtered PDFs (by years and examKey in config):');
  console.log('  npm run dev -- --download');
  console.log('  npm run dev -- --exam SSC-CHSL --download');
  console.log('');
  console.log('  # Download ALL discovered PDFs (ignore filters):');
  console.log('  npm run dev -- --download --download-all');
  console.log('');
  console.log('  # Different crawl modes:');
  console.log('  npm run dev -- --mode maximum --download    # Most aggressive (default)');
  console.log('  npm run dev -- --mode normal --download     # Standard crawling');
  console.log('  npm run dev -- --mode filtered --download   # Filter during crawl');
  console.log('');
  console.log('  # Dry run (discover only, no downloads):');
  console.log('  npm run dev -- --dry-run');
  console.log('');
  console.log('💡 Tips:');
  console.log('  - Add "years": ["2023", "2024", "2025"] and "examKey": "chsl" in your config.json');
  console.log('  - examKey should be a keyword from the exam name (e.g., "chsl", "cgl", "po")');
  console.log('  - Start with --dry-run to see what will be downloaded');
  console.log('  - Use --download-all to ignore year and examKey filtering');
  console.log('  - Check the manifest files for all discovered PDFs');
  console.log('  - Filtered manifest will be created when filters are specified');
}

main().catch((err) => {
  console.error('💥 Fatal error:', (err as Error).message);
  console.error('Stack trace:', (err as Error).stack);
  process.exit(1);
});