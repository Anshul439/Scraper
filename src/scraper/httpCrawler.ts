import axios from 'axios';
import * as cheerio from 'cheerio';

const PDF_EXT_REGEX = /\.pdf($|\?)/i;

/**
 * Enhanced filter function that works with exam name, years, and examKey
 */
export function filterPdfsForExam(
  pdfUrls: string[], 
  examName: string, 
  targetYears: string[],
  examKey?: string  // NEW: optional examKey filter
): string[] {
  console.log(`\nFiltering ${pdfUrls.length} PDFs for exam: ${examName}, years: ${targetYears.join(', ')}`);
  if (examKey) {
    console.log(`ExamKey filter: "${examKey}"`);
  }
  
  // Build dynamic exam name patterns
  const examPatterns = buildDynamicExamPatterns(examName);
  console.log(`Built ${examPatterns.length} exam patterns from "${examName}"`);
  
  // Build examKey patterns if provided
  const examKeyPatterns = examKey ? buildExamKeyPatterns(examKey) : [];
  if (examKeyPatterns.length > 0) {
    console.log(`Built ${examKeyPatterns.length} examKey patterns from "${examKey}"`);
  }
  
  // Build year regex from target years
  const yearPattern = new RegExp(`\\b(${targetYears.join('|')})\\b`, 'i');
  
  const filtered = pdfUrls.filter(url => {
    const urlLower = url.toLowerCase();
    
    // Must be a PDF
    if (!PDF_EXT_REGEX.test(url)) return false;
    
    // Must contain exam name (any pattern) OR examKey (if specified)
    let hasExamMatch = false;
    if (examKeyPatterns.length > 0) {
      // If examKey is specified, prioritize it over examName patterns
      hasExamMatch = examKeyPatterns.some(pattern => pattern.test(urlLower));
      // Fallback to exam name patterns if examKey doesn't match
      if (!hasExamMatch) {
        hasExamMatch = examPatterns.some(pattern => pattern.test(urlLower));
      }
    } else {
      // Use exam name patterns only
      hasExamMatch = examPatterns.some(pattern => pattern.test(urlLower));
    }
    
    // Must contain target year
    const hasTargetYear = yearPattern.test(url);
    
    // Must have question paper indicators
    const hasQuestionPaperKeywords = /\b(question|paper|previous|past|model|sample|set|tier|phase|shift|slot|exam|english|hindi|mathematics|reasoning|general|knowledge|gk|quantitative|aptitude|computer|awareness)\b/i.test(urlLower);
    
    // Debug logging for first few URLs
    if (pdfUrls.indexOf(url) < 5) {
      console.log(`URL: ${url}`);
      console.log(`  Exam match: ${hasExamMatch}`);
      if (examKeyPatterns.length > 0) {
        const examKeyMatch = examKeyPatterns.some(pattern => pattern.test(urlLower));
        console.log(`  ExamKey match: ${examKeyMatch}`);
      }
      console.log(`  Year match: ${hasTargetYear}`);
      console.log(`  Paper keywords: ${hasQuestionPaperKeywords}`);
      console.log(`  Final result: ${hasExamMatch && hasTargetYear && hasQuestionPaperKeywords}`);
    }
    
    return hasExamMatch && hasTargetYear && hasQuestionPaperKeywords;
  });
  
  console.log(`Filtered down to ${filtered.length} relevant PDFs`);
  return filtered;
}

/**
 * Build examKey-specific regex patterns
 */
function buildExamKeyPatterns(examKey: string): RegExp[] {
  const patterns: RegExp[] = [];
  const cleanKey = examKey.toLowerCase().trim();
  
  if (!cleanKey) return patterns;
  
  // Pattern 1: Exact match with word boundaries
  patterns.push(new RegExp(`\\b${escapeRegex(cleanKey)}\\b`, 'i'));
  
  // Pattern 2: Handle different separators and formats
  if (cleanKey.length >= 2) {
    // Allow for common separations like "ssc-chsl", "ssc_chsl", "sscchsl"
    const flexibleKey = cleanKey.split('').join('[-_\\s]*');
    patterns.push(new RegExp(`\\b${flexibleKey}\\b`, 'i'));
    
    // Pattern 3: With common prefixes (ssc-chsl, ibps-po, etc.)
    const commonPrefixes = ['ssc', 'ibps', 'upsc', 'rrb', 'bank', 'railway'];
    commonPrefixes.forEach(prefix => {
      if (!cleanKey.startsWith(prefix)) {
        patterns.push(new RegExp(`\\b${prefix}[-_\\s]*${escapeRegex(cleanKey)}\\b`, 'i'));
      }
    });
    
    // Pattern 4: As part of longer exam names
    patterns.push(new RegExp(`${escapeRegex(cleanKey)}`, 'i'));
  }
  
  // Debug: log patterns
  console.log(`ExamKey patterns for "${examKey}":`, patterns.map(p => p.source));
  
  return patterns;
}

/**
 * Build dynamic regex patterns from any exam name
 */
function buildDynamicExamPatterns(examName: string): RegExp[] {
  const patterns: RegExp[] = [];
  const cleanName = examName.toLowerCase().trim();
  
  // Pattern 1: Exact match with word boundaries
  patterns.push(new RegExp(`\\b${escapeRegex(cleanName)}\\b`, 'i'));
  
  // Pattern 2: Handle different separators (dash, underscore, space)
  if (cleanName.includes('-') || cleanName.includes('_') || cleanName.includes(' ')) {
    const normalized = cleanName.replace(/[-_\s]+/g, '[-_\\s]*');
    patterns.push(new RegExp(`\\b${normalized}\\b`, 'i'));
    
    // Pattern 3: Handle as separate words
    const parts = cleanName.split(/[-_\s]+/).filter(Boolean);
    if (parts.length >= 2) {
      // Match all parts in sequence with flexible separators
      const flexiblePattern = parts.map(escapeRegex).join('[-_\\s]*');
      patterns.push(new RegExp(`\\b${flexiblePattern}\\b`, 'i'));
      
      // Pattern 4: Match individual significant parts (length > 2)
      const significantParts = parts.filter(part => part.length > 2);
      significantParts.forEach(part => {
        patterns.push(new RegExp(`\\b${escapeRegex(part)}\\b`, 'i'));
      });
    }
  }
  
  // Pattern 5: Remove common separators entirely for compact matching
  const compact = cleanName.replace(/[-_\s]/g, '');
  if (compact !== cleanName && compact.length > 3) {
    patterns.push(new RegExp(`\\b${escapeRegex(compact)}\\b`, 'i'));
  }
  
  // Debug: log patterns
  console.log(`Exam patterns for "${examName}":`, patterns.map(p => p.source));
  
  return patterns;
}

/**
 * Escape special regex characters
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\  // Pattern 2: Handle different separators (dash, underscore, space');
}

/**
 * Simple polite delay helper
 */
function sleep(ms: number) {
  return new Promise((res) => setTimeout(res, ms));
}

/**
 * Fetch HTML for a page (returns null on error)
 */
async function fetchHtml(url: string, timeout = 30000): Promise<string | null> {
  try {
    const resp = await axios.get(url, { 
      timeout,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });
    return String(resp.data);
  } catch (err) {
    console.warn(`Failed to fetch ${url}:`, (err as Error).message);
    return null;
  }
}

/**
 * Enhanced link parsing with multiple strategies
 */
function parsePageForLinks(html: string, baseUrl: string, strategy: 'conservative' | 'aggressive' | 'maximum' = 'maximum') {
  const $ = cheerio.load(html);
  const pdfs: string[] = [];
  const linksToFollow: string[] = [];

  // Different link following strategies
  const strategies = {
    conservative: /(question|paper|previous|past|archive|downloads?|exam|pdf|download|year|result|notification|admit|card|syllabus|recruitment|selection|commission|tier|phase|shift|slot)/i,
    
    aggressive: /(question|paper|previous|past|archive|downloads?|exam|pdf|download|year|result|notification|admit|card|syllabus|recruitment|selection|commission|tier|phase|shift|slot|english|hindi|mathematics|reasoning|general|knowledge|gk|current|affairs|quantitative|aptitude|computer|awareness|ssc|upsc|ibps|rrb|bank|railway|defence|police|teaching|clerk|officer|junior|senior|assistant|grade|level|post|vacancy|job|career|employment|govt|government|public|service|civil|administrative|technical|non.technical|group|category|pay|scale|salary|allowance|benefit|eligibility|qualification|age|limit|fee|application|form|online|offline|registration|login|admit|hall|ticket|call|letter|interview|medical|document|verification|final|merit|list|cut.off|marks|score|rank|percentile|normalization|answer|key|solution|explanation|analysis|review|feedback|complaint|objection|challenge|revised|updated|latest|new|current|recent|today|yesterday|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|january|february|march|april|may|june|july|august|september|october|november|december|2020|2021|2022|2023|2024|2025)/i,
    
    maximum: /./  // Match almost everything except obvious exclusions
  };

  // URLs to definitely skip
  const SKIP_PATTERNS = /(mailto:|tel:|javascript:|#$|\.jpg|\.jpeg|\.png|\.gif|\.svg|\.css|\.js|facebook|twitter|instagram|linkedin|youtube|whatsapp|telegram|login\.php|register\.php|signup\.php|\.xml|\.rss|\.atom)/i;

  // Text patterns to skip
  const SKIP_TEXT_PATTERNS = /(privacy.policy|terms.of.use|terms.and.conditions|disclaimer|copyright|contact.us|about.us|help|faq|site.map|accessibility|user.manual|technical.support|customer.care|grievance|rtl|right.to.information)/i;

  $('a[href]').each((_, el) => {
    const href = ($(el).attr('href') || '').trim();
    if (!href) return;
    
    let abs: string;
    try {
      abs = new URL(href, baseUrl).toString();
    } catch {
      return;
    }

    // Skip obvious non-useful links
    if (SKIP_PATTERNS.test(abs)) return;

    // PDF link - always include
    if (PDF_EXT_REGEX.test(abs)) {
      pdfs.push(abs);
      return;
    }

    // Skip non-HTTP(S) links
    if (!/^https?:\/\//i.test(abs)) return;

    const anchorText = ($(el).text() || '').trim().toLowerCase();
    const title = ($(el).attr('title') || '').trim().toLowerCase();
    const combinedText = `${anchorText} ${title}`.trim();

    // Skip based on text content
    if (SKIP_TEXT_PATTERNS.test(combinedText)) return;

    // Apply strategy-based filtering
    let shouldFollow = false;
    
    if (strategy === 'maximum') {
      // Follow almost everything except obvious exclusions
      const hasGoodIndicators = /\b(pdf|download|exam|question|paper|result|notification|archive|previous|year|2020|2021|2022|2023|2024|2025|english|hindi|tier|phase|shift|recruitment|selection|vacancy|post|job|ssc|commission|government|govt|public|service|general|awareness|reasoning|quantitative|mathematics|computer|current|affairs|gk|chsl|cgl|po|clerk|officer|assistant|banking|railway|defence|teaching|upsc|ibps|rrb)\b/i.test(`${abs} ${combinedText}`);
      
      const hasBadIndicators = /\b(advertisement|ads|banner|popup|modal|overlay|social|media|share|like|follow|subscribe|newsletter|email|phone|mobile|contact|address|location|map|direction|office|about|history|vision|mission|privacy|terms|disclaimer|copyright|feedback|complaint|grievance)\b/i.test(combinedText);
      
      shouldFollow = hasGoodIndicators && !hasBadIndicators;
    } else {
      // Use the strategy-specific pattern
      const pattern = strategies[strategy];
      shouldFollow = pattern.test(abs) || pattern.test(combinedText);
    }

    if (shouldFollow) {
      linksToFollow.push(abs);
    }
  });

  return { pdfs, linksToFollow };
}

/**
 * Enhanced recursive crawler with breadth-first approach
 */
export async function discoverAllPdfsRecursive(
  seedUrl: string,
  opts?: { 
    maxDepth?: number; 
    maxPages?: number; 
    delayMs?: number; 
    timeoutMs?: number;
    strategy?: 'conservative' | 'aggressive' | 'maximum';
    verbose?: boolean;
    maxPdfsToFind?: number;
  }
): Promise<string[]> {
  const { 
    maxDepth = 8,  // Increased depth
    maxPages = 2000,  // Increased page limit
    delayMs = 200,  // Faster crawling
    timeoutMs = 30000,
    strategy = 'maximum',  // Most aggressive by default
    verbose = true,
    maxPdfsToFind = 1000  // Stop after finding enough PDFs
  } = opts || {};

  const seedHost = new URL(seedUrl).hostname;
  const seenPages = new Set<string>();
  const discoveredPdfs = new Set<string>();
  let pagesVisited = 0;

  // Use breadth-first approach with depth tracking
  const queue: Array<{ url: string; depth: number }> = [{ url: seedUrl, depth: 0 }];

  if (verbose) {
    console.log(`Starting enhanced crawl of ${seedUrl}`);
    console.log(`Strategy: ${strategy}, Max depth: ${maxDepth}, Max pages: ${maxPages}, Max PDFs: ${maxPdfsToFind}`);
  }

  while (queue.length > 0 && pagesVisited < maxPages && discoveredPdfs.size < maxPdfsToFind) {
    const { url, depth } = queue.shift()!;

    if (seenPages.has(url) || depth > maxDepth) continue;

    // Only follow same hostname
    try {
      const host = new URL(url).hostname;
      if (host !== seedHost) continue;
    } catch {
      continue;
    }

    if (verbose && pagesVisited % 50 === 0) {
      console.log(`Crawled ${pagesVisited} pages, found ${discoveredPdfs.size} PDFs, queue: ${queue.length}, depth: ${depth}`);
    }

    const html = await fetchHtml(url, timeoutMs);
    pagesVisited++;
    seenPages.add(url);

    if (!html) {
      await sleep(delayMs);
      continue;
    }

    const { pdfs, linksToFollow } = parsePageForLinks(html, url, strategy);

    // Add discovered PDFs
    pdfs.forEach(pdf => {
      discoveredPdfs.add(pdf);
      if (verbose && discoveredPdfs.size <= 20) {
        console.log(`Found PDF [${discoveredPdfs.size}]: ${pdf}`);
      }
    });

    // Early exit if we found enough PDFs
    if (discoveredPdfs.size >= maxPdfsToFind) {
      console.log(`Reached PDF limit (${maxPdfsToFind}), stopping crawl`);
      break;
    }

    // Enqueue next-level links (add to end for breadth-first)
    if (depth < maxDepth) {
      const newLinks = linksToFollow
        .filter(link => !seenPages.has(link))
        .map(link => ({ url: link, depth: depth + 1 }));
      
      // Prioritize links that look more promising
      const prioritized = newLinks.sort((a, b) => {
        const aScore = getPriorityScore(a.url);
        const bScore = getPriorityScore(b.url);
        return bScore - aScore;
      });

      queue.push(...prioritized);
    }

    await sleep(delayMs);
  }

  if (verbose) {
    console.log(`Enhanced crawl complete: ${pagesVisited} pages visited, ${discoveredPdfs.size} PDFs found`);
  }

  return Array.from(discoveredPdfs);
}

/**
 * Score URLs for crawling priority
 */
function getPriorityScore(url: string): number {
  let score = 0;
  const urlLower = url.toLowerCase();
  
  // High priority indicators
  if (/\b(pdf|download|question|paper|previous|exam|archive)\b/.test(urlLower)) score += 10;
  if (/\b(20(1[5-9]|2[0-5]))\b/.test(urlLower)) score += 8; // Recent years
  if (/\b(tier|phase|shift|english|hindi|mathematics|reasoning|gk)\b/.test(urlLower)) score += 6;
  if (/\b(recruitment|selection|notification|result)\b/.test(urlLower)) score += 4;
  if (/\b(chsl|cgl|po|clerk|officer|assistant|ssc|ibps|rrb)\b/.test(urlLower)) score += 5; // Common exam keywords
  
  // Penalty for deep paths
  const pathDepth = (url.match(/\//g) || []).length;
  score -= Math.max(0, pathDepth - 5);
  
  return score;
}

/**
 * Enhanced main function: crawl and filter PDFs based on exam name, years, and examKey
 */
export async function expandOneLevel(
  seedUrl: string, 
  examName: string, 
  targetYears: string[],
  examKey?: string  // NEW: optional examKey parameter
): Promise<string[]> {
  console.log(`\n=== Enhanced crawling for ${examName} ===`);
  console.log(`Target years: ${targetYears.join(', ')}`);
  if (examKey) {
    console.log(`ExamKey filter: "${examKey}"`);
  }
  
  const rawPdfs = await discoverAllPdfsRecursive(seedUrl, { 
    maxDepth: 6, 
    maxPages: 1500, 
    delayMs: 300,
    strategy: 'maximum',
    verbose: true,
    maxPdfsToFind: 500
  });
  
  const filtered = filterPdfsForExam(rawPdfs, examName, targetYears, examKey);
  return filtered;
}

/**
 * Get ALL PDFs without filtering (enhanced version)
 */
export async function expandOneLevelUnfiltered(seedUrl: string): Promise<string[]> {
  console.log(`\n=== Enhanced unfiltered crawl of ${seedUrl} ===`);
  
  return await discoverAllPdfsRecursive(seedUrl, { 
    maxDepth: 8, 
    maxPages: 2000, 
    delayMs: 200,
    strategy: 'maximum',
    verbose: true,
    maxPdfsToFind: 1000
  });
}

/**
 * Ultra-aggressive crawling for maximum coverage
 */
export async function expandOneLevelMaximum(seedUrl: string): Promise<string[]> {
  console.log(`\n=== MAXIMUM crawl mode for ${seedUrl} ===`);
  
  return await discoverAllPdfsRecursive(seedUrl, { 
    maxDepth: 10, 
    maxPages: 5000, 
    delayMs: 100,
    strategy: 'maximum',
    verbose: true,
    maxPdfsToFind: 2000
  });
}