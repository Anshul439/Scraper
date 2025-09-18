export interface SheetsConfig {
  serviceAccountKey: string | object;
  spreadsheetId: string;
  sheetName?: string;
  shareWithEmails?: string[];
}

export interface SheetsExportResult {
  success: boolean;
  spreadsheetId: string;
  spreadsheetUrl: string;
  sheetName: string;
  rowsExported: number;
  errors: string[];
}

export interface ExportOptions {
  includeConfidenceScore?: boolean;
  includeProcessingTimestamp?: boolean;
  includeProvenance?: boolean;
  maxQuestionsPerSheet?: number;
  groupBySubject?: boolean;
  sortBy?: 'subject' | 'difficulty' | 'confidence' | 'pageNo';
}

export interface PipelineToSheetsConfig {
  pipeline: {
    outputDir: string;
    taggedQuestionsFile?: string;
  };
  sheets: SheetsConfig;
  export: ExportOptions;
}

export interface MultiExamExportResult {
  success: boolean;
  spreadsheetUrl?: string;
  results: Array<{ examName: string; result: SheetsExportResult }>;
  errors: string[];
}