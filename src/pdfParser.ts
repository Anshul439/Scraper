import pdf from "pdf-parse";
import { readFileSync, readdirSync, statSync } from "fs";
import { join, extname } from "path";
import { ParsedPage, ParsedPDF } from "./types/pdf.types";
import { QuestionCandidate } from "./types/questions.types";

/**
 * Parse a single PDF file and extract text content
 */
export async function parsePDF(filePath: string): Promise<ParsedPDF> {
  try {
    const buffer = readFileSync(filePath);
    const data = await pdf(buffer);

    // Extract basic metadata from filename
    const fileName = filePath.split("/").pop() || "";
    const fileStats = statSync(filePath);

    const yearMatch = fileName.match(/\b(20\d{2})\b/);
    const examKeyMatch = fileName
      .toLowerCase()
      .match(
        /\b(chsl|cgl|po|clerk|ssc|ibps|rrb|upsc|neet|jee|cat|gate|railways|banking|defence)\b/
      );

    const pages = splitIntoPages(data.text, data.numpages);

    return {
      fileName,
      filePath,
      totalPages: data.numpages,
      rawText: data.text,
      pages,
      metadata: {
        examKey: examKeyMatch?.[1],
        year: yearMatch?.[1],
        extractedAt: new Date().toISOString(),
        fileSize: fileStats.size,
      },
    };
  } catch (error) {
    throw new Error(
      `Failed to parse PDF ${filePath}: ${(error as Error).message}`
    );
  }
}

/**
 * Parse all PDFs in a directory
 */
export async function parsePDFsInDirectoryRecursive(
  dirPath: string
): Promise<ParsedPDF[]> {
  const results: ParsedPDF[] = [];

  function findPDFFiles(currentDir: string): string[] {
    const items = readdirSync(currentDir);
    const pdfFiles: string[] = [];

    for (const item of items) {
      const fullPath = join(currentDir, item);
      const stats = statSync(fullPath);

      if (stats.isDirectory()) {
        // Recursively search subdirectories
        pdfFiles.push(...findPDFFiles(fullPath));
      } else if (extname(item).toLowerCase() === ".pdf") {
        pdfFiles.push(fullPath);
      }
    }

    return pdfFiles;
  }

  const pdfFiles = findPDFFiles(dirPath);
  console.log(`Found ${pdfFiles.length} PDF files recursively in ${dirPath}`);

  for (let i = 0; i < pdfFiles.length; i++) {
    const filePath = pdfFiles[i];
    const fileName = filePath.split(/[/\\]/).pop() || "";

    console.log(`[${i + 1}/${pdfFiles.length}] Parsing: ${fileName}`);

    try {
      const parsed = await parsePDF(filePath);
      results.push(parsed);
      console.log(
        `  ✅ Parsed successfully (${parsed.totalPages} pages, ${parsed.rawText.length} chars)`
      );
    } catch (error) {
      console.error(`  ❌ Failed to parse: ${(error as Error).message}`);
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  return results;
}

/**
 * Split text into approximate pages
 */
function splitIntoPages(text: string, numPages: number): ParsedPage[] {
  if (!text || numPages <= 0) return [];

  let pageTexts: string[] = [];

  // Look for common page indicators
  const pageIndicators = [
    /\f/g,
    /Page\s*\d+/gi,
    /\d+\s*\/\s*\d+/g,
    /-\s*\d+\s*-/g,
  ];

  let splitText = text;
  for (const indicator of pageIndicators) {
    const matches = text.match(indicator);
    if (matches && matches.length >= numPages - 1) {
      pageTexts = text.split(indicator);
      break;
    }
  }

  // If no clear page indicators, split by length
  if (pageTexts.length === 0) {
    const avgLength = Math.ceil(text.length / numPages);
    pageTexts = [];
    for (let i = 0; i < numPages; i++) {
      const start = i * avgLength;
      const end = Math.min((i + 1) * avgLength, text.length);
      pageTexts.push(text.substring(start, end));
    }
  }

  return pageTexts.map((pageText, index) => ({
    pageNumber: index + 1,
    text: pageText.trim(),
    wordCount: pageText.trim().split(/\s+/).length,
  }));
}

/**
 * Extract potential questions from parsed PDF text
 */
export function extractQuestionCandidates(
  parsedPDF: ParsedPDF
): QuestionCandidate[] {
  const questions: QuestionCandidate[] = [];
  let globalQuestionId = 1;

  for (const page of parsedPDF.pages) {
    const pageQuestions = extractQuestionsFromPage(page, globalQuestionId);
    questions.push(...pageQuestions);
    globalQuestionId += pageQuestions.length;
  }

  return questions;
}

/**
 * Extract questions from a single page
 */
function extractQuestionsFromPage(
  page: ParsedPage,
  startId: number
): QuestionCandidate[] {
  const questions: QuestionCandidate[] = [];
  const text = page.text;
  let questionId = startId;

  const mcqQuestionPattern = /(?:^|\n)\s*Q\.(\d+)\s+(.*?)(?=\n\s*Q\.\d+|$)/gs;

  let match;
  while ((match = mcqQuestionPattern.exec(text)) !== null) {
    const [fullMatch, questionNum, questionContent] = match;
    const startIndex = match.index;
    const endIndex = startIndex + fullMatch.length;

    const parsedQuestion = parseCompleteQuestion(
      questionContent.trim(),
      questionNum
    );

    if (parsedQuestion && parsedQuestion.text.length > 10) {
      questions.push({
        id: `q_${questionId}`,
        text: parsedQuestion.text,
        pageNumber: page.pageNumber,
        startIndex,
        endIndex,
        type: parsedQuestion.type,
        options: parsedQuestion.options,
        hasAnswer: parsedQuestion.hasAnswer,
      });

      questionId++;
    }
  }

  if (questions.length === 0) {
    const numberedQuestionPattern =
      /(?:^|\n)\s*(\d+)[\.\)]\s+(.*?)(?=\n\s*\d+[\.\)]|$)/gs;

    while ((match = numberedQuestionPattern.exec(text)) !== null) {
      const [fullMatch, questionNum, questionContent] = match;
      const startIndex = match.index;
      const endIndex = startIndex + fullMatch.length;

      const parsedQuestion = parseCompleteQuestion(
        questionContent.trim(),
        questionNum
      );

      if (parsedQuestion && parsedQuestion.text.length > 10) {
        questions.push({
          id: `q_${questionId}`,
          text: parsedQuestion.text,
          pageNumber: page.pageNumber,
          startIndex,
          endIndex,
          type: parsedQuestion.type,
          options: parsedQuestion.options,
          hasAnswer: parsedQuestion.hasAnswer,
        });

        questionId++;
      }
    }
  }

  return questions;
}

function parseCompleteQuestion(
  content: string,
  questionNum: string
): {
  text: string;
  type: QuestionCandidate["type"];
  options?: string[];
  hasAnswer: boolean;
} | null {
  // Split by common delimiters to separate question text from options/answer
  const lines = content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  let questionText = "";
  const options: string[] = [];
  let hasAnswer = false;

  let currentSection = "question";

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (/^Ans\s+1\./.test(line) || /^1\./.test(line)) {
      currentSection = "options";
      const optionMatch = line.match(/^(?:Ans\s+)?(\d+)\.\s*(.+)$/);
      if (optionMatch) {
        options.push(`${optionMatch[1]}. ${optionMatch[2]}`);
      }
      continue;
    }

    if (/^Question ID|^Status|^Chosen Option/.test(line)) {
      currentSection = "metadata";
      hasAnswer = true;
      continue;
    }

    switch (currentSection) {
      case "question":
        questionText += (questionText ? " " : "") + line;
        break;

      case "options":
        const optionMatch = line.match(/^(\d+)\.\s*(.+)$/);
        if (optionMatch) {
          options.push(`${optionMatch[1]}. ${optionMatch[2]}`);
        } else {
          if (options.length === 0) {
            questionText += " " + line;
          }
        }
        break;

      case "metadata":
        break;
    }
  }

  if (!questionText || questionText.length < 10) {
    return null;
  }

  // Determine question type
  const type = determineQuestionType(questionText, options);

  return {
    text: questionText.trim(),
    type,
    options: options.length > 0 ? options : undefined,
    hasAnswer,
  };
}

function determineQuestionType(
  questionText: string,
  options: string[]
): QuestionCandidate["type"] {
  const lowerText = questionText.toLowerCase();

  if (options.length > 1) {
    return "mcq";
  }

  // Check for specific question types
  if (/fill.*blank|complete.*sentence/.test(lowerText)) {
    return "fill_blank";
  }

  if (/true.*false|false.*true/.test(lowerText)) {
    return "true_false";
  }

  if (/rearrange|arrange.*order/.test(lowerText)) {
    return "mcq";
  }

  if (/find.*error|choose.*error|error.*sentence/.test(lowerText)) {
    return "mcq";
  }

  if (/choose.*word|select.*word|substitute/.test(lowerText)) {
    return "mcq";
  }

  if (/calculate|compute|find.*value/.test(lowerText)) {
    return "integer";
  }

  if (/explain|describe|discuss/.test(lowerText)) {
    return "descriptive";
  }

  return "mcq";
}

/**
 * Analyze question text to determine type and extract options
 */
function analyzeQuestionText(text: string): {
  type: QuestionCandidate["type"];
  options?: string[];
  hasAnswer: boolean;
} {
  const lowerText = text.toLowerCase();

  // Check for MCQ patterns
  const mcqPatterns = [
    /\b[a-d]\)\s*[^)]+/gi, // a) option b) option
    /\b[a-d]\.?\s*[^.]+/gi, // a. option b. option
    /\b\([a-d]\)\s*[^)]+/gi, // (a) option (b) option
    /option\s*[a-d]/gi,
    /choice\s*[a-d]/gi,
  ];

  const hasOptions = mcqPatterns.some((pattern) => pattern.test(text));

  if (hasOptions) {
    // Extract options
    const options = extractMCQOptions(text);
    return {
      type: "mcq",
      options: options.length > 0 ? options : undefined,
      hasAnswer: /answer|correct|solution/.test(lowerText),
    };
  }

  // Check for True/False
  if (/true.*false|false.*true|t\/f|true or false/i.test(text)) {
    return {
      type: "true_false",
      options: ["True", "False"],
      hasAnswer: /answer|correct|solution/.test(lowerText),
    };
  }

  // Check for fill in the blank
  if (/fill.*blank|complete.*sentence|_____+|\.\.\.\.\.|blank/i.test(text)) {
    return {
      type: "fill_blank",
      hasAnswer: /answer|correct|solution/.test(lowerText),
    };
  }

  // Check for integer/numerical answer
  if (/find.*value|calculate|compute|numerical|integer|digit/i.test(text)) {
    return {
      type: "integer",
      hasAnswer: /answer|correct|solution/.test(lowerText),
    };
  }

  // Check if it looks like a descriptive question
  if (
    /explain|describe|discuss|elaborate|analyze|compare|contrast|why|how/i.test(
      text
    )
  ) {
    return {
      type: "descriptive",
      hasAnswer: /answer|solution|explanation/.test(lowerText),
    };
  }

  return {
    type: "unknown",
    hasAnswer: /answer|correct|solution/.test(lowerText),
  };
}

/**
 * Extract MCQ options from question text
 */
function extractMCQOptions(text: string): string[] {
  const options: string[] = [];

  const pattern1 = /\b([a-d])\)\s*([^)]+?)(?=\s*[a-d]\)|$)/gi;
  let match1;
  while ((match1 = pattern1.exec(text)) !== null) {
    options.push(`${match1[1]}) ${match1[2].trim()}`);
  }

  if (options.length > 0) return options;

  const pattern2 = /\(([a-d])\)\s*([^(]+?)(?=\s*\([a-d]\)|$)/gi;
  let match2;
  while ((match2 = pattern2.exec(text)) !== null) {
    options.push(`(${match2[1]}) ${match2[2].trim()}`);
  }

  if (options.length > 0) return options;

  const pattern3 = /\b([a-d])\.?\s*([^.]+?)(?=\s*[a-d]\.|$)/gi;
  let match3;
  while ((match3 = pattern3.exec(text)) !== null) {
    options.push(`${match3[1]}. ${match3[2].trim()}`);
  }

  return options;
}

/**
 * Get summary statistics for parsed PDFs
 */
export function getPDFParsingStats(parsedPDFs: ParsedPDF[]): {
  totalPDFs: number;
  totalPages: number;
  totalCharacters: number;
  avgPagesPerPDF: number;
  examKeys: string[];
  years: string[];
} {
  const totalPDFs = parsedPDFs.length;
  const totalPages = parsedPDFs.reduce((sum, pdf) => sum + pdf.totalPages, 0);
  const totalCharacters = parsedPDFs.reduce(
    (sum, pdf) => sum + pdf.rawText.length,
    0
  );
  const avgPagesPerPDF = totalPages / totalPDFs;

  const examKeys = [
    ...new Set(parsedPDFs.map((pdf) => pdf.metadata.examKey).filter(Boolean)),
  ];
  const years = [
    ...new Set(parsedPDFs.map((pdf) => pdf.metadata.year).filter(Boolean)),
  ];

  return {
    totalPDFs,
    totalPages,
    totalCharacters,
    avgPagesPerPDF: Math.round(avgPagesPerPDF * 100) / 100,
    examKeys,
    years,
  };
}
