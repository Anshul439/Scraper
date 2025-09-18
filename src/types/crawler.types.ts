export interface CrawlerOptions {
  maxDepth?: number;
  maxPages?: number;
  delayMs?: number;
  timeoutMs?: number;
  strategy?: 'conservative' | 'aggressive' | 'maximum';
  verbose?: boolean;
  maxPdfsToFind?: number;
}

export interface PDFDiscoveryResult {
  allPdfs: string[];
  filteredPdfs: string[];
}

export interface PDFManifest {
  seedUrl: string;
  examName: string;
  examKey?: string;
  crawlMode: string;
  crawlTimestamp: string;
  totalPdfs: number;
  filterYears?: string[];
  filterExamKey?: string;
  totalFilteredPdfs?: number;
  totalAllPdfs?: number;
  pdfs: Array<{
    id: number;
    url: string;
    filename: string;
    yearFound?: string | null;
    examKeyMatch?: boolean | null;
  }>;
}

export interface DownloadReport {
  examName: string;
  downloadTimestamp: string;
  downloadType: 'all' | 'filtered';
  totalAttempted: number;
  successful: number;
  failed: number;
  successRate: string;
  results: Array<{
    url: string;
    status: 'success' | 'failed';
    fileName?: string;
    error?: string;
  }>;
}