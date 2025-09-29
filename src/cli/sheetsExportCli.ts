#!/usr/bin/env node

import dotenv from "dotenv";
dotenv.config();
import { readFileSync, readdirSync, statSync } from "fs";
import { argv } from "process";
import { existsSync } from "fs";
import { join } from "path";
import {
  exportPipelineToSheets,
  exportMultipleExamsToSheets,
  createPipelineToSheetsConfig,
  getGoogleSheetsSetupInstructions,
} from "../exporter/sheetsIntegration";

export interface SheetsExportCliArgs {
  inputDir?: string;
  serviceAccountKey?: string;
  spreadsheetId?: string;
  shareWith?: string[];
  groupBySubject?: boolean;
  includeMetadata?: boolean;
  maxPerSheet?: number;
  help?: boolean;
  setupSheets?: boolean;
  all?: boolean;
  dryRun?: boolean;
}

function parseCliArgs(): SheetsExportCliArgs {
  const args: SheetsExportCliArgs = {};

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    switch (arg) {
      case "--input":
      case "-i":
        args.inputDir = argv[i + 1];
        i++;
        break;
      case "--service-account-key":
      case "-k":
        args.serviceAccountKey = argv[i + 1];
        i++;
        break;
      case "--spreadsheet-id":
      case "-s":
        args.spreadsheetId = argv[i + 1];
        i++;
        break;
      case "--share-with":
        args.shareWith = argv[i + 1].split(",").map((email) => email.trim());
        i++;
        break;
      case "--group-by-subject":
        args.groupBySubject = true;
        break;
      case "--include-metadata":
        args.includeMetadata = true;
        break;
      case "--max-per-sheet":
        args.maxPerSheet = parseInt(argv[i + 1]) || 1000;
        i++;
        break;
      case "--help":
      case "-h":
        args.help = true;
        break;
      case "--setup-sheets":
        args.setupSheets = true;
        break;
      case "--all":
        args.all = true;
        break;
      case "--dry-run":
        args.dryRun = true;
        break;
    }
  }

  return args;
}

function printHelp() {
  console.log(`
Google Sheets Export CLI

USAGE:
  npm run sheets-export -- [OPTIONS]

OPTIONS:
  -i, --input <dir>              Input directory with pipeline results (required unless --all)
  -k, --service-account-key <p>  Path to Google service account key JSON (required)
  -s, --spreadsheet-id <id>      Existing spreadsheet ID (optional, creates new if not provided)
      --share-with <emails>      Comma-separated emails to share with
      --group-by-subject         Create separate sheets for each subject
      --include-metadata         Include processing metadata in export
      --max-per-sheet <num>      Max questions per sheet (default: 1000)
      --all                      Export all exam results from processed directory
      --dry-run                  Preview what would be exported
      --setup-sheets             Show Google Sheets setup instructions
  -h, --help                     Show this help message

EXAMPLES:
  # Export single exam results
  npm run sheets-export -- -i ./output -k ./service-account.json

  # Export to existing spreadsheet with sharing
  npm run sheets-export -- -i ./output -k ./service-account.json \\
    -s "1ABC123..." --share-with "user@example.com,reviewer@example.com"

  # Export all processed exams to one spreadsheet
  npm run sheets-export -- --all -k ./service-account.json \\
    -s "1ABC123..." --group-by-subject

  # Export with metadata and custom limits
  npm run sheets-export -- -i ./output -k ./service-account.json \\
    --include-metadata --max-per-sheet 500

  # Get setup instructions
  npm run sheets-export -- --setup-sheets

  # Preview export (dry run)
  npm run sheets-export -- -i ./output -k ./service-account.json --dry-run

ENVIRONMENT VARIABLES:
  GOOGLE_SERVICE_ACCOUNT_KEY     Alternative way to provide service account key path
  GOOGLE_SPREADSHEET_ID          Alternative way to provide spreadsheet ID

NOTES:
  - Requires Google Cloud service account with Google Sheets API enabled
  - Spreadsheets are automatically shared with provided emails
  - Use --all to export all exam results in ./processed-questions/processed/
  - Results must be from the pipeline command (tagged-questions.json required)
  `);
}

function validateArgs(args: SheetsExportCliArgs): string[] {
  const errors: string[] = [];

  if (args.help || args.setupSheets) {
    return errors;
  }

  if (!args.all && !args.inputDir) {
    errors.push("Input directory is required (use -i or --input, or use --all)");
  } else if (args.inputDir && !existsSync(args.inputDir)) {
    errors.push(`Input directory does not exist: ${args.inputDir}`);
  }

  const serviceAccountKey =
    args.serviceAccountKey || process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!serviceAccountKey) {
    errors.push(
      "Service account key is required (use -k or set GOOGLE_SERVICE_ACCOUNT_KEY env var)"
    );
  } else if (!existsSync(serviceAccountKey)) {
    errors.push(
      `Service account key file does not exist: ${serviceAccountKey}`
    );
  }

  if (args.shareWith) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const invalidEmails = args.shareWith.filter(
      (email) => !emailRegex.test(email)
    );
    if (invalidEmails.length > 0) {
      errors.push(`Invalid email addresses: ${invalidEmails.join(", ")}`);
    }
  }

  if (args.maxPerSheet && args.maxPerSheet < 1) {
    errors.push("Max per sheet must be greater than 0");
  }

  return errors;
}

function loadConfig(): any {
  try {
    const configPath = "./config.json";
    if (existsSync(configPath)) {
      return JSON.parse(readFileSync(configPath, "utf8"));
    }
  } catch (error) {
    console.log("Note: Could not load config.json");
  }
  return null;
}

import path from "path";
import { readdirSync, statSync, readFileSync, existsSync } from "fs";

/**
 * Robust findPipelineResults:
 * - Accepts either a direct path to tagged-questions.json or a directory.
 * - Recursively searches the directory up to MAX_DEPTH for tagged-questions.json.
 * - Returns an object with summary/outputs matching the original implementation.
 */
function findPipelineResults(inputDirOrFile: string): any {
  // Resolve path
  const resolved = path.resolve(inputDirOrFile);

  // 1) If user passed the exact file path, accept it
  try {
    if (existsSync(resolved) && statSync(resolved).isFile()) {
      if (!resolved.toLowerCase().endsWith("tagged-questions.json")) {
        throw new Error(
          `Provided file is not tagged-questions.json: ${resolved}`
        );
      }
      const taggedQuestions = JSON.parse(readFileSync(resolved, "utf8"));
      const statsPath = path.join(path.dirname(resolved), "pipeline-statistics.json");
      const stats = existsSync(statsPath) ? JSON.parse(readFileSync(statsPath, "utf8")) : null;

      return {
        success: true,
        summary: {
          pdfsProcessed: stats?.pipeline?.pdfProcessing?.totalFiles || 0,
          questionsExtracted: Array.isArray(taggedQuestions) ? taggedQuestions.length : 0,
          questionsTagged: Array.isArray(taggedQuestions) ? taggedQuestions.length : 0,
          timeElapsed: "N/A",
        },
        outputs: {
          taggedQuestions: resolved,
          statistics: existsSync(statsPath) ? statsPath : "",
        },
        errors: [],
      };
    }
  } catch (err) {
    throw err;
  }

  // 2) Otherwise treat it as a directory and search recursively (depth-limited)
  const inputDir = resolved;
  if (!existsSync(inputDir) || !statSync(inputDir).isDirectory()) {
    throw new Error(`Input path not found or not a directory: ${inputDir}`);
  }

  const MAX_DEPTH = 6;
  let foundPath: string | null = null;

  function search(dir: string, depth = 0) {
    if (depth > MAX_DEPTH || foundPath) return;
    let items: string[] = [];
    try {
      items = readdirSync(dir);
    } catch {
      return;
    }
    for (const it of items) {
      const full = path.join(dir, it);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isFile() && it.toLowerCase() === "tagged-questions.json") {
        foundPath = full;
        return;
      }
      if (st.isDirectory()) {
        search(full, depth + 1);
        if (foundPath) return;
      }
    }
  }

  search(inputDir);

  // fallback: try inputDir/tagged-questions.json
  if (!foundPath) {
    const fallback = path.join(inputDir, "tagged-questions.json");
    if (existsSync(fallback)) foundPath = fallback;
  }

  if (!foundPath) {
    throw new Error(
      `No tagged-questions.json found in ${inputDir}. Run pipeline command first or pass the exact file path.`
    );
  }

  const taggedQuestions = JSON.parse(readFileSync(foundPath, "utf8"));
  const statsPath = path.join(path.dirname(foundPath), "pipeline-statistics.json");
  const stats = existsSync(statsPath) ? JSON.parse(readFileSync(statsPath, "utf8")) : null;

  return {
    success: true,
    summary: {
      pdfsProcessed: stats?.pipeline?.pdfProcessing?.totalFiles || 0,
      questionsExtracted: Array.isArray(taggedQuestions) ? taggedQuestions.length : 0,
      questionsTagged: Array.isArray(taggedQuestions) ? taggedQuestions.length : 0,
      timeElapsed: "N/A",
    },
    outputs: {
      taggedQuestions: foundPath,
      statistics: existsSync(statsPath) ? statsPath : "",
    },
    errors: [],
  };
}


async function exportSingleExam(args: SheetsExportCliArgs) {
  const serviceAccountKey =
    args.serviceAccountKey || process.env.GOOGLE_SERVICE_ACCOUNT_KEY!;
  const spreadsheetId =
    args.spreadsheetId || process.env.GOOGLE_SPREADSHEET_ID;

  if (args.dryRun) {
    console.log("DRY RUN MODE - No actual export will occur");
    console.log(`
Configuration:
  Input Directory: ${args.inputDir}
  Service Account Key: ${serviceAccountKey?.substring(0, 20)}...
  Spreadsheet ID: ${spreadsheetId || "New spreadsheet will be created"}
  Share With: ${args.shareWith?.join(", ") || "None"}
  Group By Subject: ${args.groupBySubject || false}
  Include Metadata: ${args.includeMetadata || false}
  Max Per Sheet: ${args.maxPerSheet || 1000}
    `);

    try {
      const result = findPipelineResults(args.inputDir!);
      console.log(`Found ${result.summary.questionsTagged} questions to export`);
      console.log("\nTo export for real, remove the --dry-run flag");
    } catch (error) {
      console.error(`Error: ${(error as Error).message}`);
    }
    return;
  }

  try {
    console.log("Starting Google Sheets Export...");
    console.log(`Input: ${args.inputDir}`);

    const result = findPipelineResults(args.inputDir!);

    const sheetsConfig = createPipelineToSheetsConfig(
      args.inputDir!,
      serviceAccountKey,
      {
        spreadsheetId: spreadsheetId,
        shareWithEmails: args.shareWith,
        groupBySubject: args.groupBySubject,
        includeMetadata: args.includeMetadata,
        maxQuestionsPerSheet: args.maxPerSheet,
      }
    );

    const sheetsResult = await exportPipelineToSheets(result, sheetsConfig);

    if (sheetsResult.success) {
      console.log("\n✅ Google Sheets export completed successfully!");
      console.log(`📊 Spreadsheet URL: ${sheetsResult.spreadsheetUrl}`);
      console.log(`📈 Rows exported: ${sheetsResult.rowsExported}`);

      if (args.shareWith && args.shareWith.length > 0) {
        console.log(`👥 Shared with: ${args.shareWith.join(", ")}`);
      }
    } else {
      console.error("\n❌ Google Sheets export failed!");
      sheetsResult.errors.forEach((error) => console.error(`  - ${error}`));
      process.exit(1);
    }
  } catch (error) {
    console.error(`\nError: ${(error as Error).message}`);
    console.error("Stack trace:", (error as Error).stack);
    process.exit(1);
  }
}

async function exportAllExams(args: SheetsExportCliArgs) {
  const serviceAccountKey =
    args.serviceAccountKey || process.env.GOOGLE_SERVICE_ACCOUNT_KEY!;
  const spreadsheetId =
    args.spreadsheetId || process.env.GOOGLE_SPREADSHEET_ID;
  const config = loadConfig();
  const processedBaseDir = "./processed-questions/processed";

  if (!spreadsheetId) {
    console.error("Spreadsheet ID is required when using --all");
    console.error("Provide it via:");
    console.error("  1. --spreadsheet-id flag");
    console.error("  2. GOOGLE_SPREADSHEET_ID environment variable");
    console.error("  3. config.json file");
    process.exit(1);
  }

  if (!existsSync(processedBaseDir)) {
    console.error(`Processed directory not found: ${processedBaseDir}`);
    console.error("Run the pipeline command first to generate results");
    process.exit(1);
  }

  try {
    const examDirs = readdirSync(processedBaseDir).filter((item: string) => {
      const fullPath = join(processedBaseDir, item);
      return statSync(fullPath).isDirectory();
    });

    if (examDirs.length === 0) {
      console.error("No exam directories found in processed folder");
      process.exit(1);
    }

    console.log(`Found ${examDirs.length} processed exam directories:`);
    examDirs.forEach((dir: string) => console.log(`  - ${dir}`));

    const examResults: Array<{
      examName: string;
      pipelineResult: any;
      outputDir: string;
    }> = [];

    console.log("\nLoading results...");
    for (const examDir of examDirs) {
      try {
        const fullPath = join(processedBaseDir, examDir);
        const result = findPipelineResults(fullPath);
        examResults.push({
          examName: examDir,
          pipelineResult: result,
          outputDir: fullPath,
        });
        console.log(
          `✅ Loaded ${examDir}: ${result.summary.questionsTagged} questions`
        );
      } catch (error) {
        console.error(
          `⚠️  Skipping ${examDir}: ${(error as Error).message}`
        );
      }
    }

    if (examResults.length === 0) {
      console.error("No valid exam results found to export");
      process.exit(1);
    }

    console.log(`\n${"=".repeat(80)}`);
    console.log("EXPORTING ALL EXAMS TO GOOGLE SHEETS");
    console.log(`${"=".repeat(80)}`);
    console.log(`📊 Using spreadsheet ID: ${spreadsheetId}`);
    console.log(`📈 Total exams to export: ${examResults.length}`);

    const sheetsConfig = createPipelineToSheetsConfig(
      processedBaseDir,
      serviceAccountKey,
      {
        spreadsheetId: spreadsheetId,
        shareWithEmails: args.shareWith,
        groupBySubject: args.groupBySubject || false,
        includeMetadata: args.includeMetadata,
        maxQuestionsPerSheet: args.maxPerSheet,
      }
    );

    const multiExamResult = await exportMultipleExamsToSheets(examResults, {
      sheets: sheetsConfig.sheets,
      export: sheetsConfig.export,
    });

    if (multiExamResult.success) {
      console.log(`\n✅ Multi-exam Google Sheets export completed!`);
      console.log(`📊 Spreadsheet URL: ${multiExamResult.spreadsheetUrl}`);
      console.log(
        `📈 Successful exports: ${
          multiExamResult.results.filter((r) => r.result.success).length
        }/${examResults.length}`
      );

      if (args.shareWith && args.shareWith.length > 0) {
        console.log(`👥 Shared with: ${args.shareWith.join(", ")}`);
      }

      console.log("\nExport details:");
      multiExamResult.results.forEach((r) => {
        const status = r.result.success ? "✅" : "❌";
        const rows = r.result.rowsExported || 0;
        console.log(`  ${status} ${r.examName}: ${rows} rows`);
      });
    } else {
      console.error(`\n❌ Multi-exam export had errors:`);
      multiExamResult.errors.forEach((error) =>
        console.error(`  - ${error}`)
      );
      process.exit(1);
    }
  } catch (error) {
    console.error(`Error: ${(error as Error).message}`);
    process.exit(1);
  }
}

async function main() {
  const args = parseCliArgs();

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  if (args.setupSheets) {
    console.log(getGoogleSheetsSetupInstructions());
    process.exit(0);
  }

  const errors = validateArgs(args);
  if (errors.length > 0) {
    console.error("Validation errors:");
    errors.forEach((error) => console.error(`  - ${error}`));
    console.error("\nUse --help for usage information");
    process.exit(1);
  }

  if (args.all) {
    await exportAllExams(args);
  } else {
    await exportSingleExam(args);
  }
}

process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
  process.exit(1);
});

process.on("uncaughtException", (error) => {
  console.error("Uncaught Exception:", error);
  process.exit(1);
});

if (require.main === module) {
  main().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
}

export { main as runSheetsExportCli };