import { existsSync } from 'fs';
import { join } from 'path';
import { TaggedQuestion } from '../claudePipeline/claudeTagger';
import { PipelineResult } from '../claudePipeline/pipelineOrchestrator';
import {
  exportToGoogleSheets,
  exportFromPipelineOutput,
  createSheetsConfig,
  SheetsConfig,
  ExportOptions,
  SheetsExportResult
} from './googleSheetsExporter';

export interface PipelineToSheetsConfig {
  pipeline: {
    outputDir: string;
    taggedQuestionsFile?: string;
  };
  sheets: SheetsConfig;
  export: ExportOptions;
}

/**
 * Export pipeline results to Google Sheets
 */
export async function exportPipelineToSheets(
  pipelineResult: PipelineResult,
  config: PipelineToSheetsConfig
): Promise<SheetsExportResult> {
  console.log('\n📊 Starting Google Sheets export...');
  
  if (!pipelineResult.success) {
    return {
      success: false,
      sheetName: config.sheets.sheetName || 'Questions',
      rowsExported: 0,
      errors: ['Pipeline failed, cannot export results']
    };
  }

  // Determine the tagged questions file path
  const taggedQuestionsPath = config.pipeline.taggedQuestionsFile || 
    pipelineResult.outputs.taggedQuestions;
  
  if (!taggedQuestionsPath || !existsSync(taggedQuestionsPath)) {
    return {
      success: false,
      sheetName: config.sheets.sheetName || 'Questions',
      rowsExported: 0,
      errors: ['Tagged questions file not found']
    };
  }

  return await exportFromPipelineOutput(
    taggedQuestionsPath,
    config.sheets,
    config.export
  );
}

/**
 * Create a complete pipeline to sheets configuration
 */
export function createPipelineToSheetsConfig(
  outputDir: string,
  serviceAccountKeyPath: string,
  options: {
    spreadsheetId?: string;
    shareWithEmails?: string[];
    groupBySubject?: boolean;
    includeMetadata?: boolean;
    maxQuestionsPerSheet?: number;
  } = {}
): PipelineToSheetsConfig {
  
  const sheetsConfig = createSheetsConfig(
    serviceAccountKeyPath,
    options.spreadsheetId || '',
    {
      shareWithEmails: options.shareWithEmails
    }
  );

  const exportOptions: ExportOptions = {
    groupBySubject: options.groupBySubject || false,
    includeConfidenceScore: true,
    includeProcessingTimestamp: options.includeMetadata || false,
    includeProvenance: options.includeMetadata || false,
    maxQuestionsPerSheet: options.maxQuestionsPerSheet,
    sortBy: 'subject'
  };

  return {
    pipeline: {
      outputDir,
      taggedQuestionsFile: join(outputDir, 'tagged-questions.json')
    },
    sheets: sheetsConfig,
    export: exportOptions
  };
}

/**
 * Export multiple exam results to a single spreadsheet with separate sheets
 */
export async function exportMultipleExamsToSheets(
  examResults: Array<{
    examName: string;
    pipelineResult: PipelineResult;
    outputDir: string;
  }>,
  config: Omit<PipelineToSheetsConfig, 'pipeline'>
): Promise<{
  success: boolean;
  spreadsheetUrl?: string;
  results: Array<{ examName: string; result: SheetsExportResult }>;
  errors: string[];
}> {
  
  const results: Array<{ examName: string; result: SheetsExportResult }> = [];
  const errors: string[] = [];
  const spreadsheetId: string = config.sheets.spreadsheetId; // Use the provided spreadsheet ID
  let spreadsheetUrl: string | undefined;

  console.log(`\n📊 Exporting ${examResults.length} exams to Google Sheets...`);
  console.log(`📊 Using spreadsheet ID: ${spreadsheetId}`);

  if (!spreadsheetId) {
    const errorMsg = 'No spreadsheet ID provided for multi-exam export';
    console.error(`❌ ${errorMsg}`);
    errors.push(errorMsg);
    return {
      success: false,
      spreadsheetUrl: undefined,
      results: [],
      errors: [errorMsg]
    };
  }

  for (let i = 0; i < examResults.length; i++) {
    const { examName, pipelineResult, outputDir } = examResults[i];
    
    console.log(`\n[${i + 1}/${examResults.length}] Exporting ${examName}...`);
    
    // Use the actual outputDir where the tagged-questions.json file is located
    const taggedQuestionsPath = pipelineResult.outputs.taggedQuestions || 
                               join(outputDir, 'tagged-questions.json');
    
    console.log(`📂 Looking for tagged questions at: ${taggedQuestionsPath}`);
    
    if (!existsSync(taggedQuestionsPath)) {
      const errorMsg = `Tagged questions file not found at: ${taggedQuestionsPath}`;
      console.error(`❌ ${errorMsg}`);
      errors.push(`${examName}: ${errorMsg}`);
      
      results.push({
        examName,
        result: {
          success: false,
          sheetName: `${examName}_Questions`,
          rowsExported: 0,
          errors: [errorMsg],
          spreadsheetId: spreadsheetId,
          spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`
        }
      });
      continue;
    }
    
    const examConfig: PipelineToSheetsConfig = {
      pipeline: {
        outputDir,
        taggedQuestionsFile: taggedQuestionsPath
      },
      sheets: {
        ...config.sheets,
        spreadsheetId: spreadsheetId,
        sheetName: `${examName}_Questions`
      },
      export: {
        ...config.export,
        groupBySubject: false
      }
    };

    try {
      const result = await exportPipelineToSheets(pipelineResult, examConfig);
      
      results.push({ examName, result });
      
      if (result.success) {
        if (!spreadsheetUrl && result.spreadsheetUrl) {
          spreadsheetUrl = result.spreadsheetUrl;
        }
        
        console.log(`✅ Successfully exported ${examName}: ${result.rowsExported} questions`);
      } else {
        console.error(`❌ Failed to export ${examName}:`, result.errors);
        errors.push(...result.errors.map(err => `${examName}: ${err}`));
      }
      
    } catch (error) {
      const errorMsg = `Failed to export ${examName}: ${(error as Error).message}`;
      console.error(`❌ ${errorMsg}`);
      errors.push(errorMsg);
      
      results.push({
        examName,
        result: {
          success: false,
          sheetName: examConfig.sheets.sheetName || 'Questions',
          rowsExported: 0,
          errors: [errorMsg],
          spreadsheetId: spreadsheetId,
          spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`
        }
      });
    }

    // Wait between exports to avoid rate limits
    if (i < examResults.length - 1) {
      console.log('⏳ Waiting 2 seconds...');
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }

  const successfulExports = results.filter(r => r.result.success).length;
  const totalQuestions = results.reduce((sum, r) => sum + r.result.rowsExported, 0);

  console.log(`\n📊 Multi-exam export complete:`);
  console.log(`✅ Successful exports: ${successfulExports}/${results.length}`);
  console.log(`📈 Total questions exported: ${totalQuestions}`);
  
  if (spreadsheetUrl) {
    console.log(`🔗 Spreadsheet URL: ${spreadsheetUrl}`);
  }

  return {
    success: errors.length === 0,
    spreadsheetUrl,
    results,
    errors
  };
}

/**
 * Validate Google Sheets configuration
 */
export function validateSheetsConfig(config: SheetsConfig): string[] {
  const errors: string[] = [];

  if (!config.serviceAccountKey) {
    errors.push('Service account key is required');
  }

  if (typeof config.serviceAccountKey === 'string' && !existsSync(config.serviceAccountKey)) {
    errors.push(`Service account key file not found: ${config.serviceAccountKey}`);
  }

  if (config.shareWithEmails) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const invalidEmails = config.shareWithEmails.filter(email => !emailRegex.test(email));
    if (invalidEmails.length > 0) {
      errors.push(`Invalid email addresses: ${invalidEmails.join(', ')}`);
    }
  }

  return errors;
}

/**
 * Get Google Sheets setup instructions
 */
export function getGoogleSheetsSetupInstructions(): string {
  return `
Google Sheets Setup Instructions:
================================

1. Create a Google Cloud Project:
   - Go to https://console.cloud.google.com/
   - Create a new project or select existing one

2. Enable Google Sheets and Drive APIs:
   - Go to APIs & Services > Library
   - Search and enable "Google Sheets API"
   - Search and enable "Google Drive API"

3. Create Service Account:
   - Go to APIs & Services > Credentials
   - Click "Create Credentials" > "Service Account"
   - Fill in service account details and create
   - Go to the created service account
   - Click "Keys" tab > "Add Key" > "Create New Key"
   - Select JSON format and download the key file

4. Setup Environment:
   - Place the downloaded JSON key file in your project
   - Update your .env file with the path:
     GOOGLE_SERVICE_ACCOUNT_KEY=./path/to/service-account-key.json

5. Share Spreadsheets (Optional):
   - Use the shareWithEmails option to automatically share
   - Or manually share with the service account email found in the key file

Example Usage:
   npm run pipeline -- -i ./data/exam -o ./output -k your-api-key --export-sheets
`;
}