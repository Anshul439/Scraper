export interface ExamConfig {
  examName: string;
  label?: string;
  examKey?: string;
  seedUrls: string[];
  years?: string[];
  usePuppeteer?: boolean;
}

export interface AppConfig {
  exams: ExamConfig[];
  global?: {
    outDir?: string;
    defaultMaxDownloadsPerExam?: number;
  };
  googleSheets?: {
    spreadsheetId?: string;
    serviceAccountKeyPath?: string;
  };
}