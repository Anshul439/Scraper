export interface ParsedPDF {
  fileName: string;
  filePath: string;
  totalPages: number;
  rawText: string;
  pages: ParsedPage[];
  metadata: {
    examKey?: string;
    year?: string;
    extractedAt: string;
    fileSize: number;
  };
}

export interface ParsedPage {
  pageNumber: number;
  text: string;
  wordCount: number;
}

export interface PDFParsingStats {
  totalPDFs: number;
  totalPages: number;
  totalCharacters: number;
  avgPagesPerPDF: number;
  examKeys: string[];
  years: string[];
}

export interface PDFDownloadResult {
  path?: string;
  fileName?: string;
  url: string;
  error?: string;
}