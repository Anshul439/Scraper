import { TaggedQuestion } from "./questions.types";

export interface ExamContext {
  examKey: string;
  examFullName?: string;
  year?: string;
  description?: string;
  knownSubjects?: string[];
  commonTopics?: string[];
}

export interface TaggingConfig {
  apiKey: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  batchSize?: number;
}

export interface TaggingResult {
  success: boolean;
  taggedQuestions: TaggedQuestion[];
  errors: string[];
  stats: {
    totalProcessed: number;
    successful: number;
    failed: number;
    totalTokensUsed?: number;
  };
}

export interface TaggingStats {
  totalQuestions: number;
  bySubject: Record<string, number>;
  byDifficulty: Record<string, number>;
  byQuestionType: Record<string, number>;
  topTopics: Array<{ topic: string; count: number }>;
  avgConfidence: number;
  examKeys: string[];
  years: string[];
}