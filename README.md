# Question Extraction Pipeline

A comprehensive Node.js/TypeScript pipeline for automatically extracting, processing, and analyzing questions from government exam PDF papers using AI-powered tagging and Google Sheets integration.

## Features

- **PDF Crawling & Discovery**: Intelligent web crawling to discover and download exam PDF papers
- **Question Extraction**: Advanced PDF parsing to extract questions with options and metadata  
- **AI-Powered Tagging**: Uses Claude AI to categorize questions by subject, topic, difficulty, and more
- **Google Sheets Export**: Export to Google Sheets with organized formatting
- **Multi-Exam Support**: Process multiple exams simultaneously with consolidated reporting
- **Comprehensive Analytics**: Detailed statistics and insights on extracted questions


## Quick Start

### 1. Clone and Install

```bash
git clone https://github.com/Anshul439/Scraper
pnpm install
```

### 2. Environment Setup

Create a `.env` file in the project root:

```env
CLAUDE_API_KEY=sk-ant-your-claude-api-key-here
GOOGLE_SERVICE_ACCOUNT_KEY=./path/to/service-account-key.json
GOOGLE_SPREADSHEET_ID=your-google-spreadsheet-id
```

### 3. Configure Exams

Edit `config.json` to define your target exams:

```json
{
  "exams": [
    {
      "examName": "SSC-CHSL",
      "label": "Site for ssc-chsl",
      "examKey": "chsl",
      "seedUrls": [
        "https://www.careerpower.in/ssc-chsl-previous-year-question-paper.html"
      ],
      "years": ["2023", "2024", "2025"]
    },
    {
      "examName": "IBPS-PO",
      "label": "Site for ibps-po", 
      "examKey": "ibps",
      "seedUrls": [
        "https://www.careerpower.in/ibps-po-previous-year-question-paper.html"
      ],
      "years": ["2023", "2024", "2025"]
    }
  ],
  "global": {
    "outDir": "data",
    "defaultMaxDownloadsPerExam": 20
  }
}
```

### 4. Run the Pipeline

```bash
# Discover and download PDFs
pnpm run dev --download

# 2. Parse and tag all exams
pnpm run parsing --all

# 3. Export results to Google Sheets
pnpm run sheets-export --all
```

## Google Sheets Setup

### 1. Create Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select existing one

### 2. Enable APIs

1. Go to APIs & Services > Library
2. Search and enable "Google Sheets API"  
3. Search and enable "Google Drive API"

### 3. Create Service Account

1. Go to APIs & Services > Credentials
2. Click "Create Credentials" > "Service Account"
3. Fill in details and create
4. Go to the created service account
5. Click "Keys" tab > "Add Key" > "Create New Key"
6. Select JSON format and download

### 4. Setup Environment

Place the downloaded JSON key file in your project and update `.env`:

```env
GOOGLE_SERVICE_ACCOUNT_KEY=./path/to/service-account-key.json
```


### Tagged Questions Format

Each question is enriched with AI-generated metadata:

```json
{
  "id": "q_1",
  "examKey": "chsl",
  "year": "2024", 
  "fileName": "SSC_CHSL_2024_Tier1.pdf",
  "pageNo": 1,
  "text": "Which of the following is the capital of France?",
  "questionType": "MCQ",
  "options": ["London", "Berlin", "Paris", "Madrid"],
  "subject": "Geography",
  "topics": ["World Capitals", "European Geography"],
  "difficulty": "easy",
  "extraTags": ["static_gk", "basic_geography"],
  "confidence": 0.95,
  "processingTimestamp": "2024-01-15T10:30:00.000Z",
  "provenance": {
    "sourceUrl": "https://example.com/paper.pdf",
    "pageNo": 1,
    "charOffsetStart": 150,
    "charOffsetEnd": 200
  }
}
```

## Project Structure

```
src/
├── cli/
│   ├── scraperCli.ts          # PDF discovery and download CLI
│   └── parsingCli.ts         # Question processing CLI
│   └── sheetsExportCli.ts         # Question processing CLI
├── scraper/
│   └── httpCrawler.ts         # Web crawling for PDF discovery
├── downloader/
│   └── index.ts               # PDF download utilities
├── parser/
│   └── pdfParser.ts           # PDF text extraction and parsing
├── claudePipeline/
│   ├── claudeTagger.ts        # Claude AI integration
│   └── pipelineOrchestrator.ts # Main pipeline orchestration
├── exporter/
│   ├── googleSheetsExporter.ts # Google Sheets export
│   └── sheetsIntegration.ts   # Sheets pipeline integration
└── types/
    └── index.ts               # TypeScript type definitions
```

## Configuration

### config.json Structure

```json
{
  "exams": [
    {
      "examName": "SSC-CHSL",          // Display name
      "label": "Site for ssc-chsl",    // Description
      "examKey": "chsl",               // Filter keyword
      "seedUrls": [                    // Starting URLs for crawling
        "https://example.com/papers"
      ],
      "years": ["2023", "2024", "2025"], // Target years
      "usePuppeteer": false            // Use browser automation
    }
  ],
  "global": {
    "outDir": "data",                  // Download directory
    "defaultMaxDownloadsPerExam": 20   // Limit per exam
  }
}
```

### Environment Variables

```env
# Claude AI
CLAUDE_API_KEY=sk-ant-your-key

# Google Sheets
GOOGLE_SERVICE_ACCOUNT_KEY=./service-account.json  
GOOGLE_SPREADSHEET_ID=1ABC123def456GHI789jkl
```

## Features Deep Dive

### Intelligent PDF Discovery

- **Smart filtering**: Filter by exam keywords and years
- **Breadth-first traversal**: Efficient coverage of large sites
- **Respectful crawling**: Built-in delays and rate limiting
- **Duplicate detection**: Avoid redundant downloads
- **Progress tracking**: Real-time crawling status

### Advanced Question Extraction  

- **Pattern recognition**: Identifies Q.1, Q.2 format and numbered questions
- **Option parsing**: Extracts MCQ options with various formats (a), (a., a))
- **Type detection**: MCQ, descriptive, true/false, fill-in-blank classification
- **Page correlation**: Maps questions to source page numbers
- **Quality filtering**: Removes invalid or incomplete questions

### AI-Powered Question Tagging

Claude AI provides sophisticated analysis:

- **Subject classification**: English, Math, Reasoning, General Knowledge, etc.
- **Topic extraction**: Specific topics within each subject area
- **Difficulty assessment**: Easy, medium, hard based on complexity
- **Question type validation**: Confirms and corrects question types  
- **Confidence scoring**: AI confidence in its analysis
- **Exam-specific context**: Tailored prompts for different exam types
