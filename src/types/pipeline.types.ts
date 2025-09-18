import { TaggingConfig } from "./claude.types";
import { PDFParsingStats } from "./pdf.types";
import { QuestionExtractionStats } from "./questions.types";
import { TaggingStats } from "./claude.types";

export interface PipelineConfig {
  inputDir: string;
  outputDir: string;
  claude: TaggingConfig;
  exam?: {
    name: string;
    year?: string;
    customContext?: {
      subjects?: string[];
      topics?: string[];
    };
  };
  options?: {
    saveIntermediateResults?: boolean;
    skipQuestionExtraction?: boolean;
    maxQuestionsPerPDF?: number;
  };
}

export interface PipelineResult {
  success: boolean;
  summary: {
    pdfsProcessed: number;
    questionsExtracted: number;
    questionsTagged: number;
    timeElapsed: string;
  };
  outputs: {
    rawPDFData?: string;
    extractedQuestions?: string;
    taggedQuestions: string;
    statistics: string;
  };
  errors: string[];
}

export interface PipelineStats {
  generatedAt: string;
  pipeline: {
    pdfParsing: PDFParsingStats;
    questionExtraction: QuestionExtractionStats;
    claudeTagging: TaggingStats & {
      processing: {
        totalProcessed: number;
        successful: number;
        failed: number;
        successRate: string;
        errors: string[];
      };
    };
  };
}
