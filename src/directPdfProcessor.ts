// directPdfProcessor.ts
import { Anthropic } from '@anthropic-ai/sdk';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, extname } from 'path';
import { PDFDocument } from 'pdf-lib';
import { TaggingConfig, ExamContext } from '../types/claude.types';
import { TaggedQuestion, QuestionType } from '../types/questions.types';

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
  };
  errors: string[];
}

export interface BatchProcessResult {
  success: boolean;
  results: DirectPdfResult[];
  totalQuestions: number;
  totalFiles: number;
  errors: string[];
}

/* --------------------------
   Helpers: PDF chunking & JSON extraction
   -------------------------- */

/**
 * Split a PDF buffer into page-range chunks (returns base64 chunks).
 * pagesPerChunk default = 8. Uses pdf-lib to copy pages.
 */
async function splitPdfIntoChunks(pdfBuffer: Buffer, pagesPerChunk = 8) {
  const out: Array<{ base64: string; fromPage: number; toPage: number }> = [];
  const srcDoc = await PDFDocument.load(pdfBuffer);
  const totalPages = srcDoc.getPageCount();

  for (let start = 0; start < totalPages; start += pagesPerChunk) {
    const end = Math.min(start + pagesPerChunk - 1, totalPages - 1); // zero-indexed
    const newDoc = await PDFDocument.create();
    const pageIndices = Array.from({ length: end - start + 1 }, (_, i) => start + i);
    const copied = await newDoc.copyPages(srcDoc, pageIndices);
    copied.forEach((p) => newDoc.addPage(p));
    const newBytes = await newDoc.save();
    const base64 = Buffer.from(newBytes).toString('base64');

    out.push({
      base64,
      fromPage: start + 1, // 1-index pages for human readability
      toPage: end + 1
    });
  }

  return out;
}

/**
 * Robustly extract JSON from Claude's response text.
 * Tries ```json fenced blocks first, then finds the first {...} or [...] JSON.
 */
function extractJsonFromClaudeText(responseText: string): any | null {
  if (!responseText) return null;

  // fenced json
  const fenced = responseText.match(/```json\s*([\s\S]*?)\s*```/i);
  if (fenced && fenced[1]) {
    try { return JSON.parse(fenced[1]); } catch { /* continue */ }
  }

  // any JSON array/object
  const objMatch = responseText.match(/(\[[\s\S]*\]|\{[\s\S]*\})/);
  if (objMatch) {
    try { return JSON.parse(objMatch[1]); } catch { /* continue */ }
  }

  return null;
}

/* --------------------------
   Core: process a single PDF with chunking
   -------------------------- */

export async function processPdfWithClaude(
  filePath: string,
  config: TaggingConfig,
  examContext: ExamContext,
  options: {
    pagesPerChunk?: number;
    maxRetriesPerChunk?: number;
    chunkDelayMs?: number;
  } = {}
): Promise<DirectPdfResult> {
  const startTime = Date.now();
  const fileName = filePath.split(/[/\\]/).pop() || '';

  const result: DirectPdfResult = {
    success: false,
    fileName,
    filePath,
    questions: [],
    metadata: {
      totalQuestions: 0,
      processingTime: 0
    },
    errors: []
  };

  const pagesPerChunk = options.pagesPerChunk ?? 8;
  const maxRetries = options.maxRetriesPerChunk ?? 1;
  const chunkDelayMs = options.chunkDelayMs ?? 1500;

  try {
    console.log(`Processing PDF (chunked): ${fileName} (pagesPerChunk=${pagesPerChunk})`);

    // Read PDF buffer
    const pdfBuffer = readFileSync(filePath);

    // Extract exam metadata from filename heuristically
    const yearMatch = fileName.match(/\b(20\d{2})\b/);
    const examKeyMatch = fileName
      .toLowerCase()
      .match(/\b(chsl|cgl|po|clerk|ssc|ibps|rrb|upsc|neet|jee|cat|gate|railways|banking|defence)\b/);

    result.metadata.examKey = examKeyMatch?.[1];
    result.metadata.year = yearMatch?.[1];

    // Split into chunks
    const chunks = await splitPdfIntoChunks(pdfBuffer, pagesPerChunk);
    if (chunks.length === 0) throw new Error('No chunks produced from PDF');

    console.log(`  PDF split into ${chunks.length} chunk(s).`);

    const client = new Anthropic({ apiKey: config.apiKey });

    const accumulatedQuestions: TaggedQuestion[] = [];
    let globalQCounter = 0;

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];

      const systemPrompt = createDirectPdfSystemPrompt({
        ...examContext,
        description: (examContext.description || '') + ` [Processing pages ${chunk.fromPage}-${chunk.toPage}]`
      });

      const userPrompt = `${createDirectPdfUserPrompt(fileName)}\n\nNOTE: This request contains pages ${chunk.fromPage}-${chunk.toPage} of the original document. Return only the JSON schema as specified. Page numbers should refer to the original document (global pages).`;

      let attempt = 0;
      let chunkSucceeded = false;
      let lastErr = '';

      while (attempt <= maxRetries && !chunkSucceeded) {
        attempt++;
        try {
          console.log(`  -> Sending chunk ${i + 1}/${chunks.length} (attempt ${attempt}) pages ${chunk.fromPage}-${chunk.toPage}`);

          const response = await client.messages.create({
            model: config.model || 'claude-3-5-sonnet-20241022',
            max_tokens: config.maxTokens || 8192,
            temperature: config.temperature ?? 0.1,
            system: systemPrompt,
            messages: [{
              role: 'user',
              content: [
                { type: 'text', text: userPrompt },
                {
                  type: 'document',
                  source: {
                    type: 'base64',
                    media_type: 'application/pdf',
                    data: chunk.base64
                  }
                }
              ]
            }]
          });

          const responseText = Array.isArray(response.content) && response.content.length > 0 && response.content[0].type === 'text'
            ? response.content[0].text
            : (typeof response.content === 'string' ? response.content : '');

          const parsed = extractJsonFromClaudeText(responseText);
          if (!parsed) throw new Error('No JSON found in chunk response');

          // Derive questions array from parsed object
          let questionsArray: any[] = [];
          if (Array.isArray(parsed)) {
            questionsArray = parsed;
          } else if (Array.isArray(parsed.questions)) {
            questionsArray = parsed.questions;
          } else if (Array.isArray(parsed.items)) {
            questionsArray = parsed.items;
          } else {
            for (const k of Object.keys(parsed)) {
              if (Array.isArray((parsed as any)[k])) {
                questionsArray = (parsed as any)[k];
                break;
              }
            }
          }

          if (!Array.isArray(questionsArray)) {
            throw new Error('Parsed response does not contain a questions array');
          }

          // Convert to TaggedQuestion objects, normalize page numbers
          const converted: TaggedQuestion[] = questionsArray.map((q: any) => {
            globalQCounter++;
            const pageNoCandidate = q.pageNumber ?? q.page ?? q.page_no ?? chunk.fromPage;
            let normalizedPage = pageNoCandidate;
            if (typeof pageNoCandidate === 'number') {
              // if within chunk-relative range, convert
              if (pageNoCandidate >= 1 && pageNoCandidate <= (chunk.toPage - chunk.fromPage + 1)) {
                normalizedPage = chunk.fromPage + (pageNoCandidate - 1);
              } else {
                normalizedPage = pageNoCandidate;
              }
            }

            const tagged: TaggedQuestion = {
              id: q.id || `${fileName.replace('.pdf', '')}_q${globalQCounter}`,
              examKey: q.examKey || result.metadata.examKey || examContext.examKey,
              year: q.year || result.metadata.year || examContext.year,
              fileName,
              pageNo: normalizedPage,
              text: q.questionText || q.text || '',
              options: Array.isArray(q.options) ? q.options : (q.choices || []),
              answer: q.correctAnswer || q.answer || null,
              questionType: mapQuestionType(q.questionType || q.type || 'MCQ'),
              subject: q.subject || 'Unknown',
              topics: Array.isArray(q.topics) ? q.topics : (typeof q.topics === 'string' ? q.topics.split(',').map((s: string) => s.trim()) : []),
              difficulty: q.difficulty || 'medium',
              extraTags: Array.isArray(q.extraTags) ? q.extraTags : (q.tags || []),
              confidence: typeof q.confidence === 'number' ? q.confidence : (q.confidence ? Number(q.confidence) : 0.8),
              processingTimestamp: new Date().toISOString(),
              provenance: {
                sourceUrl: filePath,
                fileName,
                pageNo: normalizedPage,
                charOffsetStart: q.charOffsetStart ?? 0,
                charOffsetEnd: q.charOffsetEnd ?? 0
              }
            };
            return tagged;
          });

          accumulatedQuestions.push(...converted);
          chunkSucceeded = true;
          console.log(`    ✅ Chunk returned ${converted.length} question(s)`);

        } catch (err) {
          lastErr = (err as Error).message;
          console.warn(`    ❌ Chunk attempt ${attempt} failed: ${lastErr}`);
          if (attempt <= maxRetries) {
            const backoff = 1000 * attempt;
            console.log(`      waiting ${backoff}ms before retry`);
            await new Promise((r) => setTimeout(r, backoff));
          }
        }
      } // end retry loop

      if (!chunkSucceeded) {
        result.errors.push(`Chunk ${i + 1} (pages ${chunk.fromPage}-${chunk.toPage}) failed: ${lastErr}`);
        console.error(`    ✖ giving up on chunk ${i + 1}`);
      }

      if (i < chunks.length - 1) {
        await new Promise((r) => setTimeout(r, chunkDelayMs));
      }
    } // end chunks loop

    // Deduplicate by page + prefix of text (simple)
    const seen = new Set<string>();
    const deduped: TaggedQuestion[] = [];
    for (const q of accumulatedQuestions) {
      const key = `${q.pageNo}::${(q.text || '').trim().slice(0, 120)}`;
      if (!seen.has(key)) {
        seen.add(key);
        deduped.push(q);
      }
    }

    result.questions = deduped;
    result.metadata.totalQuestions = deduped.length;
    result.metadata.processingTime = Date.now() - startTime;
    result.success = deduped.length > 0;

    console.log(`  ✅ Total extracted from ${fileName}: ${result.questions.length}`);

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
   Batch: process all PDFs in a directory
   -------------------------- */

export async function processPdfsDirectly(
  inputDir: string,
  config: TaggingConfig,
  examContext: ExamContext,
  options: {
    maxFiles?: number;
    delayBetweenFiles?: number;
    pagesPerChunk?: number;
    maxRetriesPerChunk?: number;
  } = {}
): Promise<BatchProcessResult> {
  const result: BatchProcessResult = {
    success: true,
    results: [],
    totalQuestions: 0,
    totalFiles: 0,
    errors: []
  };

  try {
    const pdfFiles = findPdfFiles(inputDir);
    if (pdfFiles.length === 0) throw new Error(`No PDF files found in ${inputDir}`);

    const filesToProcess = options.maxFiles ? pdfFiles.slice(0, options.maxFiles) : pdfFiles;
    result.totalFiles = filesToProcess.length;

    console.log(`Found ${pdfFiles.length} PDF(s). Processing ${filesToProcess.length} file(s).`);

    for (let i = 0; i < filesToProcess.length; i++) {
      const filePath = filesToProcess[i];
      const fileName = filePath.split(/[/\\]/).pop() || '';
      console.log(`\n[${i + 1}/${filesToProcess.length}] Processing ${fileName}`);

      try {
        const pdfResult = await processPdfWithClaude(filePath, config, examContext, {
          pagesPerChunk: options.pagesPerChunk,
          maxRetriesPerChunk: options.maxRetriesPerChunk,
          chunkDelayMs: 1500
        });

        result.results.push(pdfResult);
        if (pdfResult.success) {
          result.totalQuestions += pdfResult.questions.length;
        } else {
          result.errors.push(...pdfResult.errors);
        }
      } catch (err) {
        const errMsg = `Error processing ${fileName}: ${(err as Error).message}`;
        result.errors.push(errMsg);
        console.error(`  ❌ ${errMsg}`);
      }

      if (i < filesToProcess.length - 1) {
        const delay = options.delayBetweenFiles ?? 3000;
        console.log(`  ⏳ Waiting ${delay / 1000}s before next file...`);
        await new Promise((r) => setTimeout(r, delay));
      }
    }

    const successfulFiles = result.results.filter(r => r.success).length;
    result.success = successfulFiles > 0;

    console.log(`\n=== Processing Complete ===`);
    console.log(`Total files: ${result.totalFiles}`);
    console.log(`Successful: ${successfulFiles}`);
    console.log(`Failed: ${result.totalFiles - successfulFiles}`);
    console.log(`Total questions extracted: ${result.totalQuestions}`);

  } catch (error) {
    result.success = false;
    result.errors.push(`Batch processing failed: ${(error as Error).message}`);
    console.error(`❌ Batch processing failed: ${(error as Error).message}`);
  }

  return result;
}

/* --------------------------
   Utilities: find PDFs, map types, flatten results
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
        } else if (extname(item).toLowerCase() === '.pdf') {
          pdfFiles.push(fullPath);
        }
      }
    } catch (error) {
      console.warn(`Warning: Could not read directory ${currentDir}: ${(error as Error).message}`);
    }
  }

  searchRecursive(dirPath);
  return pdfFiles;
}

function mapQuestionType(type: string): QuestionType {
  const typeMap: Record<string, QuestionType> = {
    'MCQ': 'MCQ',
    'mcq': 'MCQ',
    'MultipleChoice': 'MCQ',
    'Descriptive': 'Descriptive',
    'descriptive': 'Descriptive',
    'Essay': 'Descriptive',
    'TrueFalse': 'TrueFalse',
    'true_false': 'TrueFalse',
    'Boolean': 'TrueFalse',
    'FillBlank': 'FillIn',
    'fill_blank': 'FillIn',
    'FillIn': 'FillIn',
    'Integer': 'Integer',
    'integer': 'Integer',
    'Numerical': 'Integer',
    'Matching': 'Matching',
    'matching': 'Matching'
  };

  return (typeMap[type] as QuestionType) || ('MCQ' as QuestionType);
}

export function flattenBatchResults(batchResult: BatchProcessResult): TaggedQuestion[] {
  const allQuestions: TaggedQuestion[] = [];
  for (const result of batchResult.results) {
    if (result.success) {
      allQuestions.push(...result.questions);
    }
  }
  return allQuestions;
}

/* --------------------------
   Prompts (same shapes as before) - system + user prompt creators
   -------------------------- */

export function createDirectPdfSystemPrompt(examContext: ExamContext): string {
  return `You are an expert in analyzing ${examContext.examFullName || examContext.examKey} examination PDFs. Your job is to extract all questions and provide structured JSON.

EXAM CONTEXT:
- Exam: ${examContext.examFullName} (${examContext.examKey})
- Year: ${examContext.year || 'Not specified'}
- Known Subjects: ${examContext.knownSubjects?.join(', ') || 'Not specified'}

INSTRUCTIONS:
1. Read the provided PDF pages carefully and extract every question.
2. For each question return: questionText, options (if any), correctAnswer (if present), pageNumber, questionType, subject, topics, difficulty, confidence (0-1).
3. Return VALID JSON (either an array or an object with a "questions" array). Do NOT include commentary outside JSON.

RESPONSE FORMAT EXAMPLE:
{
  "questions": [
    {
      "questionNumber": 1,
      "pageNumber": 12,
      "questionText": "....",
      "questionType": "MCQ",
      "options": ["A", "B", "C", "D"],
      "correctAnswer": "B",
      "subject": "Quantitative Aptitude",
      "topics": ["Percentages"],
      "difficulty": "medium",
      "confidence": 0.85
    }
  ]
}

Be precise, consistent, and return only JSON.`;
}

export function createDirectPdfUserPrompt(fileName: string): string {
  return `Please analyze the attached PDF "${fileName}" and extract ALL examination questions with tags. Return well-formed JSON matching the system prompt schema.`;
}
