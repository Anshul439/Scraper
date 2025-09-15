// src/scraper/httpCrawler.ts
import axios from 'axios';
import * as cheerio from 'cheerio';

const PDF_EXT_REGEX = /\.pdf($|\?)/i;

/**
 * Dynamic filter function that works with any exam name and years
 */
export function filterPdfsForExam(
  pdfUrls: string[], 
  examName: string, 
  targetYears: string[]
): string[] {
  console.log(`\nFiltering ${pdfUrls.length} PDFs for exam: ${examName}, years: ${targetYears.join(', ')}`);
  
  // Build dynamic exam name patterns
  const examPatterns = buildDynamicExamPatterns(examName);
  console.log(`Built ${examPatterns.length} exam patterns from "${examName}"`);
  
  // Build year regex from target years
  const yearPattern = new RegExp(`\\b(${targetYears.join('|')})\\b`, 'i');
  
  const filtered = pdfUrls.filter(url => {
    const urlLower = url.toLowerCase();
    
    // Must be a PDF
    if (!PDF_EXT_REGEX.test(url)) return false;
    
    // Must contain exam name (any pattern)
    const hasExamName = examPatterns.some(pattern => pattern.test(urlLower));
    
    // Must contain target year
    const hasTargetYear = yearPattern.test(url);
    
    // Must have question paper indicators
    const hasQuestionPaperKeywords = /\b(question|paper|previous|past|model|sample|set|tier|phase|shift|slot|exam|english)\b/i.test(urlLower);
    
    // Debug logging for first few URLs
    if (pdfUrls.indexOf(url) < 5) {
      console.log(`URL: ${url}`);
      console.log(`  Exam match: ${hasExamName}`);
      console.log(`  Year match: ${hasTargetYear}`);
      console.log(`  Paper keywords: ${hasQuestionPaperKeywords}`);
      console.log(`  Final result: ${hasExamName && hasTargetYear && hasQuestionPaperKeywords}`);
    }
    
    return hasExamName && hasTargetYear && hasQuestionPaperKeywords;
  });
  
  console.log(`Filtered down to ${filtered.length} relevant PDFs`);
  return filtered;
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
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
      const hasGoodIndicators = /\b(pdf|download|exam|question|paper|result|notification|archive|previous|year|2020|2021|2022|2023|2024|2025|english|hindi|tier|phase|shift|recruitment|selection|vacancy|post|job|ssc|commission|government|govt|public|service|general|awareness|reasoning|quantitative|mathematics|computer|current|affairs|gk)\b/i.test(`${abs} ${combinedText}`);
      
      const hasBadIndicators = /\b(advertisement|ads|banner|popup|modal|overlay|social|media|share|like|follow|subscribe|newsletter|email|phone|mobile|contact|address|location|map|direction|office|branch|regional|zonal|about|history|vision|mission|chairman|director|secretary|minister|organogram|structure|hierarchy|budget|tender|auction|purchase|procurement|vendor|supplier|contractor|maintenance|repair|construction|infrastructure|building|facility|campus|library|canteen|hostel|guest|house|vehicle|transport|parking|security|safety|fire|emergency|medical|health|insurance|pension|provident|fund|loan|advance|welfare|union|association|club|society|cultural|sports|recreation|entertainment|festival|celebration|ceremony|inauguration|foundation|anniversary|award|recognition|appreciation|felicitation|condolence|obituary|retirement|transfer|posting|promotion|deputation|training|workshop|seminar|conference|meeting|discussion|deliberation|consultation|suggestion|feedback|opinion|poll|survey|questionnaire|complaint|grievance|appeal|representation|petition|application|request|requisition|proposal|recommendation|approval|sanction|permission|clearance|certificate|license|registration|enrollment|admission|affiliation|recognition|accreditation|validation|verification|authentication|authorization|delegation|nomination|appointment|selection|recruitment|hiring|employment|job|career|opportunity|opening|vacancy|post|position|designation|cadre|service|department|ministry|division|section|unit|cell|wing|branch|office|headquarters|regional|zonal|state|district|block|tehsil|panchayat|municipal|corporation|council|board|committee|commission|authority|agency|organization|institution|establishment|enterprise|company|firm|business|industry|sector|field|domain|area|zone|region|territory|jurisdiction|boundary|limit|scope|coverage|extent|range|span|duration|period|phase|stage|step|level|grade|class|category|group|type|kind|sort|variety|version|edition|issue|volume|number|series|sequence|order|rank|position|status|condition|state|situation|circumstance|context|background|history|origin|source|cause|reason|purpose|objective|goal|target|aim|intention|plan|strategy|policy|rule|regulation|guideline|instruction|direction|procedure|process|method|technique|approach|way|means|mode|manner|style|format|structure|layout|design|pattern|template|model|sample|example|instance|case|scenario|situation|problem|issue|challenge|difficulty|obstacle|barrier|constraint|limitation|restriction|prohibition|ban|embargo|sanction|penalty|punishment|fine|fee|charge|cost|price|rate|amount|sum|total|grand|overall|aggregate|collective|combined|joint|common|shared|mutual|reciprocal|bilateral|multilateral|international|national|regional|local|domestic|foreign|external|internal|private|public|personal|individual|group|team|committee|panel|jury|board|council|assembly|parliament|legislature|congress|senate|house|chamber|hall|room|space|place|location|site|venue|facility|building|structure|complex|campus|compound|premises|property|estate|land|area|zone|region|territory|district|state|country|nation|continent|world|global|universal|general|specific|particular|special|unique|distinct|different|separate|individual|personal|private|confidential|classified|restricted|limited|exclusive|premium|deluxe|luxury|standard|normal|regular|ordinary|common|usual|typical|conventional|traditional|classical|modern|contemporary|current|recent|latest|new|fresh|novel|innovative|creative|original|authentic|genuine|real|actual|true|correct|right|proper|appropriate|suitable|relevant|applicable|pertinent|related|connected|linked|associated|affiliated|attached|bound|tied|joined|united|combined|merged|integrated|consolidated|unified|coordinated|synchronized|aligned|matched|paired|coupled|linked|connected|related|associated|correlated|corresponding|equivalent|equal|same|similar|alike|comparable|analogous|parallel|concurrent|simultaneous|synchronous|contemporaneous|coeval|coexistent|coextensive|concomitant|accompanying|attendant|ancillary|subsidiary|supplementary|complementary|additional|extra|bonus|premium|special|exclusive|unique|rare|scarce|limited|restricted|controlled|regulated|supervised|monitored|observed|watched|tracked|followed|pursued|chased|hunted|searched|sought|looked|found|discovered|detected|identified|recognized|acknowledged|accepted|approved|endorsed|supported|backed|sponsored|funded|financed|invested|donated|contributed|subscribed|pledged|committed|dedicated|devoted|loyal|faithful|true|honest|sincere|genuine|authentic|real|actual|factual|accurate|correct|right|proper|appropriate|suitable|fit|qualified|eligible|entitled|authorized|permitted|allowed|approved|sanctioned|endorsed|supported|backed|sponsored|recommended|suggested|proposed|offered|provided|supplied|delivered|distributed|circulated|published|announced|declared|proclaimed|stated|mentioned|noted|observed|remarked|commented|said|told|informed|notified|advised|warned|cautioned|alerted|reminded|urged|requested|asked|invited|welcomed|greeted|received|accepted|acknowledged|appreciated|thanked|congratulated|praised|commended|applauded|celebrated|honored|recognized|awarded|rewarded|compensated|paid|remunerated|reimbursed|refunded|returned|restored|recovered|retrieved|reclaimed|regained|resumed|continued|proceeded|advanced|progressed|developed|grew|expanded|extended|enlarged|increased|multiplied|doubled|tripled|quadrupled|magnified|amplified|enhanced|improved|upgraded|updated|revised|modified|changed|altered|adjusted|adapted|customized|personalized|individualized|tailored|fitted|matched|suited|aligned|coordinated|synchronized|harmonized|balanced|stabilized|regulated|controlled|managed|administered|supervised|overseen|monitored|observed|watched|tracked|followed|guided|directed|led|headed|commanded|ordered|instructed|taught|trained|educated|informed|enlightened|illuminated|clarified|explained|described|detailed|outlined|summarized|condensed|compressed|reduced|minimized|simplified|streamlined|optimized|maximized|enhanced|improved|refined|polished|perfected|completed|finished|concluded|ended|terminated|stopped|ceased|discontinued|abandoned|dropped|cancelled|postponed|delayed|deferred|suspended|paused|halted|interrupted|disrupted|disturbed|interfered|obstructed|blocked|prevented|avoided|evaded|escaped|fled|ran|rushed|hurried|quickened|accelerated|speeded|hastened|expedited|facilitated|eased|simplified|clarified|explained|demonstrated|showed|displayed|exhibited|presented|introduced|launched|initiated|started|began|commenced|opened|established|founded|created|formed|built|constructed|developed|designed|planned|organized|arranged|prepared|ready|set|equipped|armed|loaded|charged|powered|energized|activated|enabled|turned|switched|operated|worked|functioned|performed|executed|implemented|applied|used|utilized|employed|deployed|installed|mounted|fixed|attached|connected|linked|joined|united|combined|merged|integrated|consolidated|unified|coordinated|synchronized|aligned|matched|paired|coupled)\b/i.test(combinedText);
      
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
  
  // Penalty for deep paths
  const pathDepth = (url.match(/\//g) || []).length;
  score -= Math.max(0, pathDepth - 5);
  
  return score;
}

/**
 * Main function: crawl and filter PDFs based on exam name and years
 */
export async function expandOneLevel(
  seedUrl: string, 
  examName: string, 
  targetYears: string[]
): Promise<string[]> {
  console.log(`\n=== Enhanced crawling for ${examName} (${targetYears.join(', ')}) ===`);
  
  const rawPdfs = await discoverAllPdfsRecursive(seedUrl, { 
    maxDepth: 6, 
    maxPages: 1500, 
    delayMs: 300,
    strategy: 'maximum',
    verbose: true,
    maxPdfsToFind: 500
  });
  
  const filtered = filterPdfsForExam(rawPdfs, examName, targetYears);
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