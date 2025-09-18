export type QuestionType = 
  | "mcq"
  | "descriptive" 
  | "true_false"
  | "fill_blank"
  | "integer"
  | "unknown"
  | "MCQ"
  | "Descriptive"
  | "TrueFalse"
  | "FillIn"
  | "Integer"
  | "Matching";

export interface QuestionCandidate {
  id: string;
  text: string;
  pageNumber: number;
  startIndex: number;
  endIndex: number;
  type: QuestionType;
  options?: string[];
  hasAnswer?: boolean;
}

export interface Question {
  id: string;
  examKey?: string;
  year?: string;
  fileName: string;
  pageNo: number;
  text: string;
  options?: string[];
  answer?: string | null;
  questionType: QuestionType;
  subject?: string;
  topics?: string[];
  difficulty?: 'easy' | 'medium' | 'hard' | 'unknown';
  extraTags?: string[];
  provenance?: {
    sourceUrl?: string;
    fileName?: string;
    pageNo?: number;
    charOffsetStart?: number;
    charOffsetEnd?: number;
  };
}

export interface TaggedQuestion extends Question {
  confidence: number;
  rawClaudeResponse?: string;
  processingTimestamp: string;
}

export interface QuestionExtractionStats {
  totalCandidates: number;
  byType: Record<string, number>;
  byPage: Record<number, number>;
  avgQuestionsPerPDF: number;
  questionsWithOptions: number;
}