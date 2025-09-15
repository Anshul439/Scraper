#!/usr/bin/env node
import { argv } from 'process';
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'fs';
import { expandOneLevelUnfiltered, expandOneLevelMaximum, expandOneLevel } from './scraper/httpCrawler';
import { downloadPdf } from './downloader/index';

type ExamConfig = {
  examName: string;
  label?: string;
  seedUrls: string[];
  years?: string[];  // Made optional since we don't need filtering
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
 * Enhanced PDF discovery with multiple strategies
 */
async function discoverPdfs(
  seedUrl: string, 
  examName: string,
  outDir: string,
  mode: 'normal' | 'maximum' | 'filtered' = 'maximum'
): Promise<string[]> {
  console.log(`\n  -> Discovering PDFs from: ${seedUrl}`);
  console.log(`     Mode: ${mode}`);
  
  let pdfs: string[] = [];
  
  switch (mode) {
    case 'maximum':
      pdfs = await expandOneLevelMaximum(seedUrl);
      break;
    case 'normal':
      pdfs = await expandOneLevelUnfiltered(seedUrl);
      break;
    case 'filtered':
      // Use filtered search if years are specified
      pdfs = await expandOneLevel(seedUrl, examName, ['2020', '2021', '2022', '2023', '2024', '2025']);
      break;
    default:
      pdfs = await expandOneLevelUnfiltered(seedUrl);
  }
  
  console.log(`     Total PDFs discovered: ${pdfs.length}`);

  if (pdfs.length === 0) {
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
  
  // Save manifest with metadata
  const manifest = {
    seedUrl,
    examName,
    crawlMode: mode,
    crawlTimestamp: new Date().toISOString(),
    totalPdfs: pdfs.length,
    pdfs: pdfs.map((url, index) => ({
      id: index + 1,
      url,
      filename: getFilenameFromUrl(url),
      estimatedRelevance: calculateRelevanceScore(url, examName)
    })).sort((a, b) => b.estimatedRelevance - a.estimatedRelevance) // Sort by relevance
  };

  const manifestPath = `${dir}/${host}-manifest.json`;
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
  console.log(`     Saved manifest: ${manifestPath}`);

  // Return sorted PDFs (most relevant first)
  return manifest.pdfs.map(p => p.url);
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
 * Calculate relevance score for a PDF URL
 */
function calculateRelevanceScore(url: string, examName: string): number {
  let score = 0;
  const urlLower = url.toLowerCase();
  const examLower = examName.toLowerCase();
  
  // Exam name relevance
  if (urlLower.includes(examLower)) score += 50;
  examLower.split(/[-_\s]+/).forEach(part => {
    if (part.length > 2 && urlLower.includes(part)) score += 20;
  });
  
  // Question paper indicators
  if (/\b(question|paper|previous|past|model|sample)\b/.test(urlLower)) score += 30;
  if (/\b(tier|phase|shift|set)\b/.test(urlLower)) score += 20;
  if (/\b(english|hindi|mathematics|reasoning|gk|general)\b/.test(urlLower)) score += 15;
  
  // Recent years get higher scores
  const currentYear = new Date().getFullYear();
  for (let year = currentYear; year >= currentYear - 10; year--) {
    if (urlLower.includes(year.toString())) {
      score += Math.max(5, 50 - (currentYear - year) * 5);
      break;
    }
  }
  
  // Penalty for very deep paths or complex URLs
  const pathDepth = (url.match(/\//g) || []).length;
  if (pathDepth > 8) score -= 10;
  
  // Bonus for PDF in filename
  if (/\.pdf$/i.test(url)) score += 10;
  
  return Math.max(0, score);
}

/**
 * Smart download with progress tracking
 */
async function downloadPdfsWithLimit(
  pdfs: string[], 
  maxDownloads: number, 
  outDir: string,
  examName: string
): Promise<void> {
  if (pdfs.length === 0) {
    console.log(`No PDFs to download`);
    return;
  }

  const downloadLimit = Math.min(maxDownloads, pdfs.length);
  console.log(`\nStarting smart download of top ${downloadLimit} PDFs (out of ${pdfs.length} available)...`);
  
  let successful = 0;
  let failed = 0;
  const results: Array<{ url: string; status: 'success' | 'failed'; fileName?: string; error?: string }> = [];

  for (let i = 0; i < downloadLimit; i++) {
    const pdfUrl = pdfs[i];
    const progress = `[${i + 1}/${downloadLimit}]`;
    
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
    if (i < downloadLimit - 1) {
      await new Promise(resolve => setTimeout(resolve, 800));
    }
    
    // Progress update every 5 downloads
    if ((i + 1) % 5 === 0) {
      console.log(`    Progress: ${i + 1}/${downloadLimit} completed (${successful} successful, ${failed} failed)`);
    }
  }

  // Save download results
  const downloadReport = {
    examName,
    downloadTimestamp: new Date().toISOString(),
    totalAttempted: downloadLimit,
    successful,
    failed,
    successRate: `${((successful / downloadLimit) * 100).toFixed(1)}%`,
    results
  };

  const reportPath = `${outDir}/${examName}/download-report.json`;
  writeFileSync(reportPath, JSON.stringify(downloadReport, null, 2), 'utf-8');
  
  console.log(`\n📊 Download Summary:`);
  console.log(`    Total attempted: ${downloadLimit}`);
  console.log(`    Successful: ${successful}`);
  console.log(`    Failed: ${failed}`);
  console.log(`    Success rate: ${downloadReport.successRate}`);
  console.log(`    Report saved: ${reportPath}`);
  
  if (failed > 0) {
    console.log(`\n💡 Tips for failed downloads:`);
    console.log(`    - Some PDFs might be behind authentication`);
    console.log(`    - Server might be rate-limiting requests`);
    console.log(`    - Files might have been moved or deleted`);
    console.log(`    - Try reducing --max-downloads for better success rate`);
  }
}

async function main() {
  const cfg = loadConfig();
  const cliExam = parseCliExam();
  const doDownload = argv.includes('--download');
  const maxDownloads = Number(parseArgFlag('--max-downloads') ?? cfg.global?.defaultMaxDownloadsPerExam ?? 20);
  const outDir = cfg.global?.outDir ?? 'data';
  const crawlMode = parseArgFlag('--mode') as 'normal' | 'maximum' | 'filtered' || 'maximum';
  const dryRun = argv.includes('--dry-run');
  
  // Filter exams to run
  const examsToRun = cfg.exams.filter((e) => !cliExam || e.examName === cliExam);
  if (examsToRun.length === 0) {
    console.error('No exams found in config (or check --exam parameter).');
    console.log('Available exams:', cfg.exams.map(e => e.examName).join(', '));
    process.exit(1);
  }

  console.log(`\n=== Enhanced PDF Scraper Started ===`);
  console.log(`Crawl mode: ${crawlMode.toUpperCase()}`);
  console.log(`Max downloads per exam: ${maxDownloads}`);
  console.log(`Output directory: ${outDir}`);
  console.log(`Running exams: ${examsToRun.map(e => e.examName).join(', ')}`);
  console.log(`Dry run: ${dryRun ? 'YES (no downloads)' : 'NO'}`);

  for (const exam of examsToRun) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`🎯 Exam: ${exam.examName} (${exam.label ?? 'no-label'})`);
    console.log(`${'='.repeat(60)}`);

    let allDiscoveredPdfs: string[] = [];

    // Process each seed URL
    for (let i = 0; i < exam.seedUrls.length; i++) {
      const seed = exam.seedUrls[i];
      console.log(`\n📍 Processing seed ${i + 1}/${exam.seedUrls.length}: ${seed}`);
      
      try {
        const pdfs = await discoverPdfs(seed, exam.examName, outDir, crawlMode);
        allDiscoveredPdfs.push(...pdfs);
        
        if (pdfs.length === 0) {
          console.log(`⚠️  No PDFs found from this seed. Trying next seed...`);
        }
      } catch (error) {
        console.error(`❌ Error processing seed ${seed}:`, (error as Error).message);
        console.log(`Continuing with next seed...`);
      }
    }

    // Remove duplicates and sort by relevance
    const uniquePdfs = Array.from(new Set(allDiscoveredPdfs));
    const sortedPdfs = uniquePdfs
      .map(url => ({ url, score: calculateRelevanceScore(url, exam.examName) }))
      .sort((a, b) => b.score - a.score)
      .map(item => item.url);

    console.log(`\n📋 Discovery Summary for ${exam.examName}:`);
    console.log(`    Total unique PDFs found: ${uniquePdfs.length}`);
    console.log(`    From ${exam.seedUrls.length} seed URL(s)`);
    
    if (sortedPdfs.length > 0) {
      console.log(`\n🏆 Top ${Math.min(10, sortedPdfs.length)} most relevant PDFs:`);
      sortedPdfs.slice(0, 10).forEach((url, idx) => {
        const score = calculateRelevanceScore(url, exam.examName);
        const fileName = getFilenameFromUrl(url);
        console.log(`    ${idx + 1}. ${fileName} (score: ${score})`);
        if (idx < 3) console.log(`       ${url}`);
      });
    }

    // Download phase
    if (!dryRun && doDownload && sortedPdfs.length > 0) {
      await downloadPdfsWithLimit(sortedPdfs, maxDownloads, outDir, exam.examName);
    } else if (dryRun) {
      console.log(`\n🔍 Dry run complete - no downloads performed`);
      console.log(`   Use --download flag to actually download files`);
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
  console.log('  npm run dev -- --exam SSC-CGL');
  console.log('');
  console.log('  # Discover and download (default 20 PDFs):');
  console.log('  npm run dev -- --download');
  console.log('  npm run dev -- --exam SSC-CGL --download');
  console.log('');
  console.log('  # Custom download limits:');
  console.log('  npm run dev -- --download --max-downloads 10');
  console.log('  npm run dev -- --download --max-downloads 50');
  console.log('');
  console.log('  # Different crawl modes:');
  console.log('  npm run dev -- --mode maximum --download    # Most aggressive (default)');
  console.log('  npm run dev -- --mode normal --download     # Standard crawling');
  console.log('  npm run dev -- --mode filtered --download   # Filter by years');
  console.log('');
  console.log('  # Dry run (discover only, no downloads):');
  console.log('  npm run dev -- --dry-run');
  console.log('');
  console.log('💡 Tips:');
  console.log('  - Start with --dry-run to see what will be downloaded');
  console.log('  - Use --max-downloads 10 for testing');
  console.log('  - Check the manifest.json files for all discovered PDFs');
  console.log('  - Use maximum mode for best coverage');
}

main().catch((err) => {
  console.error('💥 Fatal error:', (err as Error).message);
  console.error('Stack trace:', (err as Error).stack);
  process.exit(1);
});