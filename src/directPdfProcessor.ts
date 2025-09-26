// src/directPdfProcessor.ts
import { Anthropic } from "@anthropic-ai/sdk";
import { readFileSync, readdirSync, statSync } from "fs";
import { join, extname } from "path";
import { PDFDocument } from "pdf-lib";
import { TaggingConfig, ExamContext } from "../types/claude.types";
import { TaggedQuestion, QuestionType } from "../types/questions.types";
import { runWithConcurrency } from "./utils/concurrency";

/**
 * Enhanced exam context with allowed years for filtering
 */
export interface EnhancedExamContext extends ExamContext {
  allowedYears?: string[];
  strictYearFiltering?: boolean; // If true, reject PDFs that don't match allowed years
  // examKey may be string or string[]
  examKey?: string | string[];
}

/**
 * Result types
 */
export interface DirectPdfResult {
  success: boolean;
  fileName: string;
  filePath: string;
  questions: TaggedQuestion[];
  metadata: {
    examKey?: string;
    year?: string;
    totalQuestions: number;
    processingTime: number;
    skippedReason?: string; // Added to track why a PDF was skipped
  };
  errors: string[];
}

export interface BatchProcessResult {
  success: boolean;
  results: DirectPdfResult[];
  totalQuestions: number;
  totalFiles: number;
  skippedFiles: number; // Added to track skipped files
  errors: string[];
}

/* --------------------------
   Year filtering utilities
   -------------------------- */

/**
 * Extract year from filename using various patterns
 */
function extractYearFromFilename(fileName: string): string | null {
  // Try different year patterns
  const yearPatterns = [
    /\b(20[0-9]{2})\b/, // Standard 4-digit year
    /\b([0-9]{2})\b/, // 2-digit year (will be converted to 20XX)
    /year[_-]?([0-9]{2,4})/i, // "year_2023" or similar
    /([0-9]{4})[_-]?paper/i, // "2023_paper" or similar
  ];

  for (const pattern of yearPatterns) {
    const match = fileName.match(pattern);
    if (match) {
      let year = match[1];
      // Convert 2-digit to 4-digit year (assuming 20XX)
      if (year.length === 2) {
        const numYear = parseInt(year);
        // Assume years 00-30 are 2000-2030, 31-99 are 1931-1999
        year = numYear <= 30 ? `20${year}` : `19${year}`;
      }
      return year;
    }
  }
  return null;
}

/**
 * Normalize allowed years array to full 4-digit strings
 */
function normalizeYears(years?: string[]): string[] {
  if (!years || years.length === 0) return [];
  return years
    .map((y) => String(y).trim())
    .filter(Boolean)
    .map((y) => {
      if (/^\d{2}$/.test(y)) {
        const n = Number(y);
        return n <= 30 ? `20${y}` : `19${y}`;
      }
      return y;
    });
}

/**
 * Check if a PDF should be processed based on year filtering rules
 */
function shouldProcessPdf(
  fileName: string,
  examContext: EnhancedExamContext
): { shouldProcess: boolean; reason?: string; detectedYear?: string } {
  // If no year filtering is configured, process all files
  if (!examContext.allowedYears || examContext.allowedYears.length === 0) {
    return { shouldProcess: true };
  }

  const detectedYear = extractYearFromFilename(fileName);

  // If strict filtering is disabled and no year detected, process the file
  if (!detectedYear && !examContext.strictYearFiltering) {
    return {
      shouldProcess: true,
      reason: "No year detected, strict filtering disabled",
    };
  }

  // If strict filtering is enabled and no year detected, skip
  if (!detectedYear && examContext.strictYearFiltering) {
    return {
      shouldProcess: false,
      reason: "No year detected in filename, strict filtering enabled",
    };
  }

  // Check if detected year is in allowed years
  if (detectedYear && examContext.allowedYears.includes(detectedYear)) {
    return {
      shouldProcess: true,
      detectedYear,
      reason: `Year ${detectedYear} is in allowed years: ${examContext.allowedYears.join(
        ", "
      )}`,
    };
  }

  // Year detected but not in allowed list
  if (detectedYear) {
    return {
      shouldProcess: false,
      detectedYear,
      reason: `Year ${detectedYear} not in allowed years: ${examContext.allowedYears.join(
        ", "
      )}`,
    };
  }

  return { shouldProcess: false, reason: "Unknown filtering condition" };
}

/* --------------------------
   Existing helper functions (unchanged)
   -------------------------- */

/**
 * Split a PDF buffer into page-range chunks (returns base64 chunks).
 * pagesPerChunk default = 8. Uses pdf-lib to copy pages.
 */
async function splitPdfIntoChunks(pdfBuffer: Buffer, pagesPerChunk = 10) {
  const out: Array<{ base64: string; fromPage: number; toPage: number }> = [];
  const srcDoc = await PDFDocument.load(pdfBuffer);
  const totalPages = srcDoc.getPageCount();

  for (let start = 0; start < totalPages; start += pagesPerChunk) {
    const end = Math.min(start + pagesPerChunk - 1, totalPages - 1);
    const newDoc = await PDFDocument.create();
    const pageIndices = Array.from(
      { length: end - start + 1 },
      (_, i) => start + i
    );
    const copied = await newDoc.copyPages(srcDoc, pageIndices);
    copied.forEach((p) => newDoc.addPage(p));
    const newBytes = await newDoc.save();
    const base64 = Buffer.from(newBytes).toString("base64");

    out.push({
      base64,
      fromPage: start + 1,
      toPage: end + 1,
    });
  }

  return out;
}

/**
 * Robustly extract JSON from Claude's response text.
 */
function extractJsonFromClaudeText(responseText: string): any | null {
  if (!responseText) return null;

  const fenced = responseText.match(/```json\s*([\s\S]*?)\s*```/i);
  if (fenced && fenced[1]) {
    try {
      return JSON.parse(fenced[1]);
    } catch {
      /* continue */
    }
  }

  const objMatch = responseText.match(/(\[[\s\S]*\]|\{[\s\S]*\})/);
  if (objMatch) {
    try {
      return JSON.parse(objMatch[1]);
    } catch {
      /* continue */
    }
  }

  return null;
}

/* --------------------------
   Core: process a single PDF with year & examKey filtering via LLM
   -------------------------- */

export async function processPdfWithClaude(
  filePath: string,
  config: TaggingConfig,
  examContextInput: EnhancedExamContext,
  options: {
    pagesPerChunk?: number;
    maxRetriesPerChunk?: number;
    chunkDelayMs?: number;
    chunkConcurrency?: number;
  } = {}
): Promise<DirectPdfResult> {
  const startTime = Date.now();
  const fileName = filePath.split(/[/\\]/).pop() || "";

  // Make a shallow copy and normalize years
  const examContext: EnhancedExamContext = {
    ...examContextInput,
    allowedYears: normalizeYears(examContextInput.allowedYears),
  };

  const result: DirectPdfResult = {
    success: false,
    fileName,
    filePath,
    questions: [],
    metadata: {
      totalQuestions: 0,
      processingTime: 0,
    },
    errors: [],
  };

  // Early year filtering check using filename heuristics
  const filterCheck = shouldProcessPdf(fileName, examContext);

  if (!filterCheck.shouldProcess) {
    result.success = false; // Mark as unsuccessful skip
    result.metadata.skippedReason = filterCheck.reason;
    result.metadata.processingTime = Date.now() - startTime;
    result.errors.push(`Skipped: ${filterCheck.reason}`);

    console.log(`⏭️  Skipping ${fileName}: ${filterCheck.reason}`);
    return result;
  }

  if (filterCheck.detectedYear) {
    console.log(
      `✅ Processing ${fileName} (detected year: ${filterCheck.detectedYear})`
    );
  } else {
    console.log(`✅ Processing ${fileName} (no year restrictions detected in filename)`);
  }

  const pagesPerChunk = options.pagesPerChunk ?? 10;
  const maxRetries = options.maxRetriesPerChunk ?? 1;
  const chunkDelayMs = options.chunkDelayMs ?? 1500;

  try {
    console.log(
      `Processing PDF (chunked): ${fileName} (pagesPerChunk=${pagesPerChunk})`
    );

    // Read PDF buffer
    const pdfBuffer = readFileSync(filePath);

    // Extract metadata heuristically
    const yearMatch =
      filterCheck.detectedYear || fileName.match(/\b(20\d{2})\b/)?.[1];
    const examKeyMatch = fileName
      .toLowerCase()
      .match(
        /\b(chsl|cgl|po|clerk|ssc|ibps|rrb|upsc|neet|jee|cat|gate|railways|banking|defence)\b/
      );

    result.metadata.examKey = examKeyMatch?.[1] || examContext.examKey;
    result.metadata.year = yearMatch || examContext.year;

    // Split into chunks
    const chunks = await splitPdfIntoChunks(pdfBuffer, pagesPerChunk);
    if (chunks.length === 0) throw new Error("No chunks produced from PDF");

    console.log(`  PDF split into ${chunks.length} chunk(s).`);

    const client = new Anthropic({ apiKey: config.apiKey });
    const accumulatedQuestions: TaggedQuestion[] = [];
    let globalQCounter = 0;
    const chunkConcurrency = options.chunkConcurrency ?? 4; // conservative default

    // Create enhanced system prompt that mentions year filtering and examKey
    const enhancedSystemPrompt = createYearAwareSystemPrompt(examContext, filterCheck.detectedYear);

    // Process chunks with concurrency
    async function processChunk(
      chunk: { base64: string; fromPage: number; toPage: number },
      chunkIndex: number
    ) {
      let attempt = 0;
      let lastErr = "";
      while (attempt <= maxRetries) {
        attempt++;
        try {
          console.log(
            `  -> Sending chunk ${chunkIndex + 1}/${chunks.length} (attempt ${attempt}) pages ${chunk.fromPage}-${chunk.toPage}`
          );

          const userPrompt = `${createDirectPdfUserPrompt(
            fileName
          )}\n\nNOTE: This request contains pages ${chunk.fromPage}-${
            chunk.toPage
          } of the original document. Return only the JSON schema as specified. Page numbers should refer to the original document (global pages).`;

          const response = await client.messages.create({
            model: config.model || "claude-3-5-sonnet-20241022",
            max_tokens: config.maxTokens || 10000,
            temperature: config.temperature ?? 0.1,
            system: enhancedSystemPrompt,
            messages: [
              {
                role: "user",
                content: [
                  { type: "text", text: userPrompt },
                  {
                    type: "document",
                    source: {
                      type: "base64",
                      media_type: "application/pdf",
                      data: chunk.base64,
                    },
                  },
                ],
              },
            ],
          });

          const responseText =
            Array.isArray(response.content) &&
            response.content.length > 0 &&
            response.content[0].type === "text"
              ? response.content[0].text
              : typeof response.content === "string"
              ? response.content
              : "";

          const parsed = extractJsonFromClaudeText(responseText);
          if (!parsed) throw new Error("No JSON found in chunk response");

          // If LLM explicitly requested skipping this PDF
          if (parsed && typeof parsed === "object" && (parsed as any).skip === true) {
            const skipReason = (parsed as any).reason || "LLM signaled skip (no reason)";
            return { success: true, skip: true, skipReason, questions: [] };
          }

          // Parse questions from response
          let questionsArray: any[] = [];
          if (Array.isArray(parsed)) questionsArray = parsed;
          else if (Array.isArray(parsed.questions)) questionsArray = parsed.questions;
          else if (Array.isArray(parsed.items)) questionsArray = parsed.items;
          else {
            for (const k of Object.keys(parsed)) {
              if (Array.isArray((parsed as any)[k])) {
                questionsArray = (parsed as any)[k];
                break;
              }
            }
          }

          if (!Array.isArray(questionsArray))
            throw new Error("Parsed response does not contain a questions array");

          const converted: TaggedQuestion[] = questionsArray.map((q: any) => {
            globalQCounter++;
            const pageNoCandidate =
              q.pageNumber ?? q.page ?? q.page_no ?? chunk.fromPage;
            let normalizedPage = pageNoCandidate;
            if (typeof pageNoCandidate === "number") {
              if (
                pageNoCandidate >= 1 &&
                pageNoCandidate <= chunk.toPage - chunk.fromPage + 1
              ) {
                normalizedPage = chunk.fromPage + (pageNoCandidate - 1);
              } else {
                normalizedPage = pageNoCandidate;
              }
            }
            const tagged: TaggedQuestion = {
              id: q.id || `${fileName.replace(".pdf", "")}_q${globalQCounter}`,
              examKey:
                q.examKey || result.metadata.examKey || examContext.examKey,
              year: q.year || result.metadata.year || examContext.year,
              fileName,
              pageNo: normalizedPage,
              text: q.questionText || q.text || "",
              options: Array.isArray(q.options) ? q.options : q.choices || [],
              answer: q.correctAnswer || q.answer || null,
              questionType: mapQuestionType(q.questionType || q.type || "MCQ"),
              subject: q.subject || "Unknown",
              topics: Array.isArray(q.topics)
                ? q.topics
                : typeof q.topics === "string"
                ? q.topics.split(",").map((s: string) => s.trim())
                : [],
              difficulty: q.difficulty || "medium",
              extraTags: Array.isArray(q.extraTags)
                ? q.extraTags
                : q.tags || [],
              confidence:
                typeof q.confidence === "number"
                  ? q.confidence
                  : q.confidence
                  ? Number(q.confidence)
                  : 0.8,
              processingTimestamp: new Date().toISOString(),
              provenance: {
                sourceUrl: filePath,
                fileName,
                pageNo: normalizedPage,
                charOffsetStart: q.charOffsetStart ?? 0,
                charOffsetEnd: q.charOffsetEnd ?? 0,
              },
            };
            return tagged;
          });

          return { success: true, questions: converted };
        } catch (err) {
          lastErr = (err as Error).message;
          console.warn(`    ❌ Chunk attempt ${attempt} failed: ${lastErr}`);
          if (attempt <= maxRetries) {
            const backoff = 1000 * attempt;
            await new Promise((r) => setTimeout(r, backoff));
          } else {
            return { success: false, error: lastErr };
          }
        }
      }
    }

    // Run chunks in parallel (resilient concurrency runner returns per-item results or { error })
    const chunkResults = await runWithConcurrency(
      chunks,
      processChunk,
      chunkConcurrency
    );

    // Collect results and respect LLM-level skip
    let sawSkip = false;
    let skipReasonFromLLM: string | undefined = undefined;

    for (let i = 0; i < chunkResults.length; i++) {
      const r = chunkResults[i] as any;
      if (!r) {
        const errMsg = `Chunk ${i + 1} produced no result`;
        result.errors.push(`Chunk ${i + 1} failed: ${errMsg}`);
        console.error(`    ✖ ${errMsg}`);
        continue;
      }

      // LLM requested skip for document
      if (r.skip) {
        sawSkip = true;
        skipReasonFromLLM = r.skipReason || "LLM signaled skip";
        console.log(`    ⏭️  LLM requested skip on chunk ${i + 1}: ${skipReasonFromLLM}`);
        break;
      }

      if (r.success && Array.isArray(r.questions)) {
        accumulatedQuestions.push(...r.questions);
        console.log(`    ✅ Chunk ${i + 1} returned ${r.questions.length} question(s)`);
      } else {
        const errMsg = r.error || "Unknown chunk failure";
        result.errors.push(
          `Chunk ${i + 1} (pages ${chunks[i].fromPage}-${chunks[i].toPage}) failed: ${errMsg}`
        );
        console.error(`    ✖ Chunk ${i + 1} failed: ${errMsg}`);
      }
    }

    if (sawSkip) {
      // Mark PDF as skipped by the LLM, set metadata and return early
      result.success = false;
      result.metadata.skippedReason = `Skipped by LLM: ${skipReasonFromLLM}`;
      result.metadata.processingTime = Date.now() - startTime;
      result.errors.push(result.metadata.skippedReason);
      console.log(`⏭️  Skipping ${fileName} as per LLM: ${skipReasonFromLLM}`);
      return result;
    }

    // Deduplicate by page + prefix of text
    const seen = new Set<string>();
    const deduped: TaggedQuestion[] = [];
    for (const q of accumulatedQuestions) {
      const key = `${q.pageNo}::${(q.text || "").trim().slice(0, 120)}`;
      if (!seen.has(key)) {
        seen.add(key);
        deduped.push(q);
      }
    }

    result.questions = deduped;
    result.metadata.totalQuestions = deduped.length;
    result.metadata.processingTime = Date.now() - startTime;
    result.success = deduped.length > 0;

    // If strict year filtering is enabled and LLM found no questions, treat as skip
    if (examContext.strictYearFiltering && result.questions.length === 0) {
      result.success = false;
      result.metadata.skippedReason = "LLM returned no questions and strictYearFiltering is enabled";
      result.metadata.processingTime = Date.now() - startTime;
      result.errors.push(result.metadata.skippedReason);
      console.log(`⏭️  Skipping ${fileName}: ${result.metadata.skippedReason}`);
      return result;
    }

    console.log(
      `  ✅ Total extracted from ${fileName}: ${result.questions.length}`
    );
  } catch (error) {
    result.success = false;
    const msg = `Failed to process ${fileName}: ${(error as Error).message}`;
    result.errors.push(msg);
    result.metadata.processingTime = Date.now() - startTime;
    console.error(`  ❌ ${msg}`);
  }

  return result;
}

/* --------------------------
   Batch processing with year filtering
   -------------------------- */

export async function processPdfsDirectly(
  inputDir: string,
  config: TaggingConfig,
  examContext: EnhancedExamContext,
  options: {
    maxFiles?: number;
    delayBetweenFiles?: number;
    pagesPerChunk?: number;
    maxRetriesPerChunk?: number;
    chunkConcurrency?: number;
    fileConcurrency?: number;
    chunkDelayMs?: number;
  } = {}
): Promise<BatchProcessResult> {
  const result: BatchProcessResult = {
    success: true,
    results: [],
    totalQuestions: 0,
    totalFiles: 0,
    skippedFiles: 0,
    errors: [],
  };

  try {
    const pdfFiles = findPdfFiles(inputDir);
    if (pdfFiles.length === 0)
      throw new Error(`No PDF files found in ${inputDir}`);

    const filesToProcess = options.maxFiles
      ? pdfFiles.slice(0, options.maxFiles)
      : pdfFiles;

    console.log(
      `Found ${pdfFiles.length} PDF(s). Processing up to ${filesToProcess.length} file(s).`
    );

    // Normalize examContext allowed years once
    if (examContext.allowedYears && examContext.allowedYears.length > 0) {
      examContext.allowedYears = normalizeYears(examContext.allowedYears);
      console.log(`📅 Year filtering enabled: ${examContext.allowedYears.join(", ")}`);
      console.log(`🔒 Strict filtering: ${examContext.strictYearFiltering ? "YES" : "NO"}`);
      // Pre-check how many files will likely be processed
      const preCheckResults = filesToProcess.map(filePath => {
        const fileName = filePath.split(/[/\\]/).pop() || "";
        return shouldProcessPdf(fileName, examContext);
      });

      const willProcess = preCheckResults.filter(r => r.shouldProcess).length;
      const willSkip = preCheckResults.filter(r => !r.shouldProcess).length;

      console.log(`📊 Pre-check: ${willProcess} files to process, ${willSkip} files to skip`);
    }

    const fileConcurrency = options.fileConcurrency ?? 4;

    const fileResults = await runWithConcurrency(
      filesToProcess,
      async (filePath, idx) => {
        const fileName = filePath.split(/[/\\]/).pop() || "";
        console.log(
          `\n[${idx + 1}/${filesToProcess.length}] Checking ${fileName}`
        );
        try {
          return await processPdfWithClaude(
            filePath,
            config,
            examContext,
            {
              pagesPerChunk: options.pagesPerChunk,
              maxRetriesPerChunk: options.maxRetriesPerChunk,
              chunkDelayMs: options.chunkDelayMs ?? 1500,
              chunkConcurrency: options.chunkConcurrency,
            }
          );
        } catch (err) {
          return {
            success: false,
            fileName,
            filePath,
            questions: [],
            metadata: { totalQuestions: 0, processingTime: 0 },
            errors: [(err as Error).message],
          } as DirectPdfResult;
        }
      },
      fileConcurrency
    );

    // fileResults items may be either DirectPdfResult or { error: string }
    const normalizedResults: DirectPdfResult[] = fileResults.map((r: any, i: number) => {
      if (!r) {
        return {
          success: false,
          fileName: filesToProcess[i].split(/[/\\]/).pop() || "",
          filePath: filesToProcess[i],
          questions: [],
          metadata: { totalQuestions: 0, processingTime: 0, skippedReason: "No result from worker" },
          errors: ["No result from worker"]
        };
      }
      if ((r as any).error && !(r as any).questions) {
        // worker returned error placeholder
        return {
          success: false,
          fileName: filesToProcess[i].split(/[/\\]/).pop() || "",
          filePath: filesToProcess[i],
          questions: [],
          metadata: { totalQuestions: 0, processingTime: 0, skippedReason: (r as any).error },
          errors: [(r as any).error]
        };
      }
      return r as DirectPdfResult;
    });

    result.results.push(...normalizedResults);

    // Calculate statistics
    const processedResults = normalizedResults.filter(r => !r.metadata.skippedReason);
    const skippedResults = normalizedResults.filter(r => r.metadata.skippedReason);

    result.totalQuestions = processedResults.reduce(
      (s, r) => s + (r.success ? r.questions.length : 0),
      0
    );
    result.totalFiles = processedResults.length;
    result.skippedFiles = skippedResults.length;

    const successfulFiles = processedResults.filter((r) => r.success).length;
    result.success = successfulFiles > 0;

    // aggregate errors
    normalizedResults.forEach(r => {
      if (r.errors && r.errors.length > 0) result.errors.push(...r.errors);
    });

    console.log(`\n=== Processing Complete ===`);
    console.log(`Total files found: ${filesToProcess.length}`);
    console.log(`Files processed: ${result.totalFiles}`);
    console.log(`Files skipped (year filter): ${result.skippedFiles}`);
    console.log(`Successful: ${successfulFiles}`);
    console.log(`Failed: ${result.totalFiles - successfulFiles}`);
    console.log(`Total questions extracted: ${result.totalQuestions}`);

    // Show skip reasons
    if (result.skippedFiles > 0) {
      console.log(`\n📋 Files skipped by year filter:`);
      skippedResults.forEach(r => {
        console.log(`  - ${r.fileName}: ${r.metadata.skippedReason}`);
      });
    }

  } catch (error) {
    result.success = false;
    result.errors.push(`Batch processing failed: ${(error as Error).message}`);
    console.error(`❌ Batch processing failed: ${(error as Error).message}`);
  }

  return result;
}

/* --------------------------
   Enhanced system prompt with year + examKey awareness
   -------------------------- */

function createYearAwareSystemPrompt(
  examContext: EnhancedExamContext,
  detectedYear?: string
): string {
  // Normalize allowed years display
  const allowedYears = examContext.allowedYears && examContext.allowedYears.length > 0
    ? examContext.allowedYears.join(", ")
    : "Not specified";

  // Normalize examKey (could be array or string)
  let examKeyDisplay = "Not specified";
  if (examContext.examKey) {
    if (Array.isArray(examContext.examKey)) examKeyDisplay = examContext.examKey.join(", ");
    else examKeyDisplay = String(examContext.examKey);
  }

  let yearInfo = `- Target Years: ${allowedYears}`;
  if (detectedYear) yearInfo += `\n- Detected Year (filename heuristics): ${detectedYear}`;

  return `You are an expert at analyzing examination PDFs and deciding whether a document belongs to a particular exam and year, and extracting questions from it.

EXAM CONTEXT:
- Exam (key): ${examKeyDisplay}
- Exam full name: ${examContext.examFullName || examContext.examKey || "Not specified"}
- Year in config: ${examContext.year || "Not specified"}
${yearInfo}
- Known Subjects: ${examContext.knownSubjects?.join(", ") || "Not specified"}

IMPORTANT FILTERING RULES (READ CAREFULLY):
1. FIRST: Determine if the PDF content (including headings, footer, watermark, table-of-contents, first page, headers, or any metadata inside the provided pages) clearly corresponds to the target exam and one of the target years (or an academic-year pattern like 2022-2023 if targetYears contains 2022).
2. If the document **does not** match the target examKey(s) OR **does not** match any allowed year, **DO NOT** attempt to extract questions. Instead return this exact JSON (only JSON, no commentary):

{
  "skip": true,
  "reason": "<brief human-friendly reason, e.g. 'Document title indicates IBPS-PO 2018', or 'No year detected and strict filtering enabled'>"
}

3. If the document **does** match the exam and year, proceed to extract questions normally and return ONLY the JSON described below (an array of questions or an object with "questions" array).

RESPONSE FORMAT WHEN EXTRACTING:
Either return an array of question objects:
[
  { "questionNumber": 1, "pageNumber": 12, "questionText": "...", "questionType": "MCQ", "options": ["A","B","C","D"], "correctAnswer": "B", "subject": "...", "topics": ["..."], "difficulty":"medium", "confidence":0.8 }
]

OR return an object:
{ "questions": [ ...same as above... ] }

RESPONSE FORMAT WHEN SKIPPING:
Return this EXACT JSON object:
{
  "skip": true,
  "reason": "<brief reason>"
}

ADDITIONAL RULES:
- Return valid JSON only. Do NOT add any extra text outside the JSON.
- If uncertain but evidence leans toward mismatch, prefer to **skip** (i.e., be conservative).
- If the PDF clearly includes the exam and year anywhere in examined pages, extract questions normally.
- Page numbers in extracted questions must refer to the original global document pages.

Be precise, consistent, and return only JSON.`;
}

/* --------------------------
   Remaining utility functions (unchanged from original)
   -------------------------- */

export function findPdfFiles(dirPath: string): string[] {
  const pdfFiles: string[] = [];

  function searchRecursive(currentDir: string) {
    try {
      const items = readdirSync(currentDir);
      for (const item of items) {
        const fullPath = join(currentDir, item);
        const stats = statSync(fullPath);
        if (stats.isDirectory()) {
          searchRecursive(fullPath);
        } else if (extname(item).toLowerCase() === ".pdf") {
          pdfFiles.push(fullPath);
        }
      }
    } catch (error) {
      console.warn(
        `Warning: Could not read directory ${currentDir}: ${
          (error as Error).message
        }`
      );
    }
  }

  searchRecursive(dirPath);
  return pdfFiles;
}

function mapQuestionType(type: string): QuestionType {
  const typeMap: Record<string, QuestionType> = {
    MCQ: "MCQ",
    mcq: "MCQ",
    MultipleChoice: "MCQ",
    Descriptive: "Descriptive",
    descriptive: "Descriptive",
    Essay: "Descriptive",
    TrueFalse: "TrueFalse",
    true_false: "TrueFalse",
    Boolean: "TrueFalse",
    FillBlank: "FillIn",
    fill_blank: "FillIn",
    FillIn: "FillIn",
    Integer: "Integer",
    integer: "Integer",
    Numerical: "Integer",
    Matching: "Matching",
    matching: "Matching",
  };

  return (typeMap[type] as QuestionType) || ("MCQ" as QuestionType);
}

export function flattenBatchResults(
  batchResult: BatchProcessResult
): TaggedQuestion[] {
  const allQuestions: TaggedQuestion[] = [];
  for (const result of batchResult.results) {
    if (result.success && !result.metadata.skippedReason) {
      allQuestions.push(...result.questions);
    }
  }
  return allQuestions;
}

export function createDirectPdfSystemPrompt(examContext: ExamContext): string {
  // Use the enhanced version by default
  return createYearAwareSystemPrompt(examContext as EnhancedExamContext);
}

export function createDirectPdfUserPrompt(fileName: string): string {
  return `Please analyze the attached PDF "${fileName}" and extract ALL examination questions with tags. Return well-formed JSON matching the system prompt schema.`;
}
