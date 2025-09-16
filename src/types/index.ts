export interface PDFMeta {
  examKey: string;
  year?: string;
  sourceUrl: string;
  fileName?: string;
  checksum?: string;
}

export interface Question {
  id: string;
  examKey: string;
  year?: string;
  fileName?: string;
  pageNo?: number;
  text: string;
  options?: string[];
  answer?: string | null;
  questionType?: QuestionType;
  subject?: string;
  topics?: string[];
  difficulty?: "easy" | "medium" | "hard" | "unknown";
  extraTags?: string[];
  provenance?: {
    sourceUrl: string;
    fileName?: string;
    pageNo?: number;
    charOffsetStart?: number;
    charOffsetEnd?: number;
  };
}

// src/types.ts - Add missing types
export type QuestionType =
  | "MCQ"
  | "Descriptive"
  | "TrueFalse"
  | "FillIn"
  | "Integer"
  | "Matching";

export interface PDFMeta {
  examKey: string;
  year?: string;
  sourceUrl: string;
  fileName?: string;
  checksum?: string;
}

export interface Question {
  id: string;
  examKey: string;
  year?: string;
  fileName?: string;
  pageNo?: number;
  text: string;
  options?: string[];
  answer?: string | null;
  questionType?: QuestionType;
  subject?: string;
  topics?: string[];
  difficulty?: "easy" | "medium" | "hard" | "unknown";
  extraTags?: string[];
  provenance?: {
    sourceUrl: string;
    fileName?: string;
    pageNo?: number;
    charOffsetStart?: number;
    charOffsetEnd?: number;
  };
}
