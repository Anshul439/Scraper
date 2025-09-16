#!/usr/bin/env node

import dotenv from "dotenv";
dotenv.config();
import { readFileSync } from 'fs';
import { argv } from "process";
import { existsSync } from "fs";
import {
  runQuestionExtractionPipeline,
  createPipelineConfig,
  runPipelineForExam,
} from "../claudePipeline/pipelineOrchestrator";
import {
  exportPipelineToSheets,
  exportMultipleExamsToSheets,
  createPipelineToSheetsConfig,
  validateSheetsConfig,
  getGoogleSheetsSetupInstructions,
} from "../exporter/sheetsIntegration";

interface CliArgs {
  inputDir?: string;
  outputDir?: string;
  claudeApiKey?: string;
  examName?: string;
  batchSize?: number;
  maxQuestions?: number;
  help?: boolean;
  dryRun?: boolean;
  // Google Sheets options
  exportSheets?: boolean;
  serviceAccountKey?: string;
  shareWith?: string[];
  groupBySubject?: boolean;
  includeMetadata?: boolean;
  maxPerSheet?: number;
  spreadsheetId?: string;
  setupSheets?: boolean;
}

function parseCliArgs(): CliArgs {
  const args: CliArgs = {};

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    switch (arg) {
      case "--input":
      case "-i":
        args.inputDir = argv[i + 1];
        i++;
        break;
      case "--output":
      case "-o":
        args.outputDir = argv[i + 1];
        i++;
        break;
      case "--api-key":
      case "-k":
        args.claudeApiKey = argv[i + 1];
        i++;
        break;
      case "--exam":
      case "-e":
        args.examName = argv[i + 1];
        i++;
        break;
      case "--batch-size":
      case "-b":
        args.batchSize = parseInt(argv[i + 1]) || 5;
        i++;
        break;
      case "--max-questions":
      case "-m":
        args.maxQuestions = parseInt(argv[i + 1]) || 100;
        i++;
        break;
      case "--help":
      case "-h":
        args.help = true;
        break;
      case "--dry-run":
        args.dryRun = true;
        break;
      // Google Sheets options
      case "--export-sheets":
        args.exportSheets = true;
        break;
      case "--service-account-key":
        args.serviceAccountKey = argv[i + 1];
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
      case "--spreadsheet-id":
        args.spreadsheetId = argv[i + 1];
        i++;
        break;
      case "--setup-sheets":
        args.setupSheets = true;
        break;
    }
  }

  return args;
}

function printHelp() {
  console.log(`
Question Extraction Pipeline CLI with Google Sheets Export

USAGE:
  npm run pipeline -- [OPTIONS]

BASIC OPTIONS:
  -i, --input <dir>          Input directory containing PDF files (required)
  -o, --output <dir>         Output directory for results (required)
  -k, --api-key <key>        Claude AI API key (required)
  -e, --exam <name>          Exam name for context (optional)
  -b, --batch-size <num>     Questions per batch to send to Claude (default: 5)
  -m, --max-questions <num>  Max questions per PDF to process (default: 100)
      --dry-run              Show what would be processed without running
  -h, --help                 Show this help message

GOOGLE SHEETS EXPORT OPTIONS:
      --export-sheets              Enable Google Sheets export
      --service-account-key <path> Path to Google service account key JSON file
      --share-with <emails>        Comma-separated list of emails to share with
      --group-by-subject           Create separate sheets for each subject
      --include-metadata           Include processing metadata in export
      --max-per-sheet <num>        Max questions per sheet (default: 1000)
      --spreadsheet-id <id>        Use existing spreadsheet (optional)
      --setup-sheets               Show Google Sheets setup instructions

EXAMPLES:
  # Basic usage
  npm run pipeline -- -i ./data/SSC-CHSL -o ./output -k sk-ant-...

  # With Google Sheets export
  npm run pipeline -- -i ./data/SSC-CHSL -o ./output -k sk-ant-... \\
    --export-sheets --service-account-key ./service-account.json \\
    --share-with "reviewer@example.com,analyst@example.com"

  # Group questions by subject in separate sheets
  npm run pipeline -- -i ./data/SSC-CHSL -o ./output -k sk-ant-... \\
    --export-sheets --service-account-key ./service-account.json \\
    --group-by-subject --include-metadata

  # Update existing spreadsheet
  npm run pipeline -- -i ./data/SSC-CHSL -o ./output -k sk-ant-... \\
    --export-sheets --service-account-key ./service-account.json \\
    --spreadsheet-id "1ABC123def456GHI789jkl"

  # Process all exams in directory
  npm run pipeline -- --all -k sk-ant-... \\
    --export-sheets --service-account-key ./service-account.json

  # Show Google Sheets setup instructions
  npm run pipeline -- --setup-sheets

ENVIRONMENT VARIABLES:
  CLAUDE_API_KEY              Alternative way to provide Claude API key
  GOOGLE_SERVICE_ACCOUNT_KEY  Alternative way to provide service account key path

NOTES:
  - Google Sheets export requires a service account key
  - Spreadsheets are automatically shared with provided emails
  - Processing time depends on number of questions and API rate limits
  - Each question batch is sent to Claude AI for tagging before export
  `);
}

function validateArgs(args: CliArgs): string[] {
  const errors: string[] = [];

  // Skip validation for setup help
  if (args.setupSheets || args.help) {
    return errors;
  }

  if (!args.inputDir) {
    errors.push("Input directory is required (use -i or --input)");
  } else if (!existsSync(args.inputDir)) {
    errors.push(`Input directory does not exist: ${args.inputDir}`);
  }

  if (!args.outputDir) {
    errors.push("Output directory is required (use -o or --output)");
  }

  const apiKey = args.claudeApiKey || process.env.CLAUDE_API_KEY;
  if (!apiKey) {
    errors.push(
      "Claude API key is required (use -k, --api-key, or set CLAUDE_API_KEY env var)"
    );
  }

  if (args.batchSize && (args.batchSize < 1 || args.batchSize > 20)) {
    errors.push("Batch size must be between 1 and 20");
  }

  if (args.maxQuestions && args.maxQuestions < 1) {
    errors.push("Max questions must be greater than 0");
  }

  // Google Sheets validation
  if (args.exportSheets) {
    const serviceAccountKey =
      args.serviceAccountKey || process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
    if (!serviceAccountKey) {
      errors.push(
        "Service account key is required for Google Sheets export (use --service-account-key or set GOOGLE_SERVICE_ACCOUNT_KEY env var)"
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
  }

  return errors;
}

async function runPipelineCli() {
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

  const apiKey = args.claudeApiKey || process.env.CLAUDE_API_KEY!;
  console.log(apiKey);

  const serviceAccountKey =
    args.serviceAccountKey || process.env.GOOGLE_SERVICE_ACCOUNT_KEY;

  if (args.dryRun) {
    console.log("DRY RUN MODE - No actual processing will occur");
    console.log(`
Configuration:
  Input Directory: ${args.inputDir}
  Output Directory: ${args.outputDir}
  Exam Name: ${args.examName || "Auto-detected"}
  Batch Size: ${args.batchSize || 5}
  Max Questions/PDF: ${args.maxQuestions || 1000}
  Claude API Key: ${apiKey.substring(0, 10)}...
  
Google Sheets Export: ${args.exportSheets ? "Enabled" : "Disabled"}
${
  args.exportSheets
    ? `  Service Account Key: ${serviceAccountKey?.substring(0, 20)}...
  Share With: ${args.shareWith?.join(", ") || "None"}
  Group By Subject: ${args.groupBySubject || false}
  Include Metadata: ${args.includeMetadata || false}
  Max Per Sheet: ${args.maxPerSheet || 1000}
  Spreadsheet ID: ${args.spreadsheetId || "New spreadsheet"}`
    : ""
}
    `);

    try {
      const { readdirSync } = require("fs");
      const pdfFiles = readdirSync(args.inputDir!).filter((f: string) =>
        f.toLowerCase().endsWith(".pdf")
      );
      console.log(`Found ${pdfFiles.length} PDF files to process:`);
      pdfFiles
        .slice(0, 10)
        .forEach((file: string) => console.log(`  - ${file}`));
      if (pdfFiles.length > 10) {
        console.log(`  ... and ${pdfFiles.length - 10} more files`);
      }
    } catch (err) {
      console.error(`Error reading input directory: ${(err as Error).message}`);
    }

    console.log("\nTo run for real, remove the --dry-run flag");
    return;
  }

  try {
    console.log("Starting Question Extraction Pipeline...");
    console.log(`Input: ${args.inputDir}`);
    console.log(`Output: ${args.outputDir}`);
    if (args.examName) console.log(`Exam: ${args.examName}`);
    if (args.exportSheets) console.log("Google Sheets export: Enabled");

    const config = createPipelineConfig(
      args.inputDir!,
      args.outputDir!,
      apiKey,
      args.examName
    );

    // Override defaults with CLI args
    if (args.batchSize) config.claude.batchSize = args.batchSize;
    if (args.maxQuestions)
      config.options!.maxQuestionsPerPDF = args.maxQuestions;

    const result = await runQuestionExtractionPipeline(config);

    if (result.success) {
      console.log("\nPipeline completed successfully!");
      console.log(`Results saved to: ${args.outputDir}`);

      // Show key output files
      console.log("\nKey output files:");
      if (result.outputs.taggedQuestions) {
        console.log(`  - Tagged Questions: ${result.outputs.taggedQuestions}`);
      }
      if (result.outputs.statistics) {
        console.log(`  - Statistics: ${result.outputs.statistics}`);
      }

      console.log(`\nProcessing Summary:`);
      console.log(`  - PDFs processed: ${result.summary.pdfsProcessed}`);
      console.log(
        `  - Questions extracted: ${result.summary.questionsExtracted}`
      );
      console.log(`  - Questions tagged: ${result.summary.questionsTagged}`);
      console.log(`  - Time elapsed: ${result.summary.timeElapsed}`);

      // Export to Google Sheets if requested
      if (args.exportSheets && serviceAccountKey) {
        console.log("\n" + "=".repeat(60));
        console.log("GOOGLE SHEETS EXPORT");
        console.log("=".repeat(60));

        const sheetsConfig = createPipelineToSheetsConfig(
          args.outputDir!,
          serviceAccountKey,
          {
            spreadsheetId: args.spreadsheetId,
            shareWithEmails: args.shareWith,
            groupBySubject: args.groupBySubject,
            includeMetadata: args.includeMetadata,
            maxQuestionsPerSheet: args.maxPerSheet,
          }
        );

        const sheetsResult = await exportPipelineToSheets(result, sheetsConfig);

        if (sheetsResult.success) {
          console.log(`\nGoogle Sheets export completed successfully!`);
          console.log(`Spreadsheet URL: ${sheetsResult.spreadsheetUrl}`);
          console.log(`Rows exported: ${sheetsResult.rowsExported}`);

          if (args.shareWith && args.shareWith.length > 0) {
            console.log(`Shared with: ${args.shareWith.join(", ")}`);
          }
        } else {
          console.error("\nGoogle Sheets export failed!");
          sheetsResult.errors.forEach((error) => console.error(`  - ${error}`));
        }
      }

      if (result.errors.length > 0) {
        console.log(`\nWarnings (${result.errors.length}):`);
        result.errors
          .slice(0, 3)
          .forEach((error) => console.log(`  - ${error}`));
        if (result.errors.length > 3) {
          console.log(
            `  ... and ${result.errors.length - 3} more (check detailed logs)`
          );
        }
      }
    } else {
      console.error("\nPipeline failed!");
      if (result.errors.length > 0) {
        console.error("Errors:");
        result.errors.forEach((error) => console.error(`  - ${error}`));
      }
      process.exit(1);
    }
  } catch (error) {
    console.error(`\nUnexpected error: ${(error as Error).message}`);
    console.error("Stack trace:", (error as Error).stack);
    process.exit(1);
  }
}

// Helper function to run pipeline for all exam directories with Google Sheets export
// Helper function to load configuration
function loadConfig(): any {
  try {
    const configPath = './config.json';
    if (existsSync(configPath)) {
      const configData = readFileSync(configPath, 'utf8');
      return JSON.parse(configData);
    }
  } catch (error) {
    console.log('No config.json found or invalid JSON, using environment variables and defaults');
  }
  return null;
}

// Helper function to run pipeline for all exam directories with Google Sheets export
async function runForAllExams() {
  const args = parseCliArgs();
  const config = loadConfig();
  const baseDir = "./data"; // Adjust based on your structure
  const outputBaseDir = "./processed-questions";
  const apiKey = process.env.CLAUDE_API_KEY;
  
  // Get spreadsheet ID from CLI args, config file, or environment variable
  let spreadsheetId = args.spreadsheetId;
  if (!spreadsheetId && config?.googleSheets?.spreadsheetId) {
    spreadsheetId = config.googleSheets.spreadsheetId;
  }
  if (!spreadsheetId) {
    spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID;
  }
  
  // Get service account key from CLI args, config file, or environment variable
  let serviceAccountKey = args.serviceAccountKey;
  if (!serviceAccountKey && config?.googleSheets?.serviceAccountKeyPath) {
    serviceAccountKey = config.googleSheets.serviceAccountKeyPath;
  }
  if (!serviceAccountKey) {
    serviceAccountKey = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  }

  if (!apiKey) {
    console.error("CLAUDE_API_KEY environment variable is required");
    process.exit(1);
  }

  if (args.exportSheets && !serviceAccountKey) {
    console.error("Google service account key is required for sheets export");
    process.exit(1);
  }

  if (args.exportSheets && !spreadsheetId) {
    console.error("Google spreadsheet ID is required for sheets export");
    console.error("Please provide it via:");
    console.error("  1. --spreadsheet-id flag");
    console.error("  2. GOOGLE_SPREADSHEET_ID environment variable");
    console.error("  3. config.json file");
    process.exit(1);
  }

  try {
    const { readdirSync, statSync } = require("fs");
    const { join } = require("path");

    const examDirs = readdirSync(baseDir).filter((item: string) => {
      const fullPath = join(baseDir, item);
      return statSync(fullPath).isDirectory();
    });

    console.log(`Found ${examDirs.length} exam directories to process:`);
    examDirs.forEach((dir: string) => console.log(`  - ${dir}`));

    const examResults: Array<{
      examName: string;
      pipelineResult: any;
      outputDir: string;
    }> = [];

    // Process each exam
    for (let i = 0; i < examDirs.length; i++) {
      const examDir = examDirs[i];
      console.log(`\n${"=".repeat(80)}`);
      console.log(`Processing ${i + 1}/${examDirs.length}: ${examDir}`);
      console.log(`${"=".repeat(80)}`);

      try {
        const result = await runPipelineForExam(
          join(baseDir, examDir),
          outputBaseDir,
          apiKey,
          examDir
        );

        // IMPORTANT: Use the actual output directory from the pipeline result
        // The runPipelineForExam function creates: outputBaseDir/processed/examDir
        const actualOutputDir = join(outputBaseDir, "processed", examDir);

        examResults.push({
          examName: examDir,
          pipelineResult: result,
          outputDir: actualOutputDir  // Pass the correct path where files are actually saved
        });

        if (result.success) {
          console.log(`✅ Successfully processed ${examDir}`);
          console.log(`   Questions tagged: ${result.summary.questionsTagged}`);
          console.log(`   Output saved to: ${actualOutputDir}`);
        } else {
          console.error(`❌ Failed to process ${examDir}`);
          result.errors.forEach((error: string) =>
            console.error(`   - ${error}`)
          );
        }
      } catch (error) {
        console.error(
          `❌ Error processing ${examDir}: ${(error as Error).message}`
        );
      }

      // Delay between exams to be respectful to API
      if (i < examDirs.length - 1) {
        console.log("⏳ Waiting 5 seconds before next exam...");
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
    }

    // Export to Google Sheets if enabled
    if (args.exportSheets && serviceAccountKey && spreadsheetId && examResults.length > 0) {
      console.log(`\n${"=".repeat(80)}`);
      console.log("EXPORTING ALL EXAMS TO GOOGLE SHEETS");
      console.log(`${"=".repeat(80)}`);
      console.log(`📊 Using spreadsheet ID: ${spreadsheetId}`);

      const sheetsConfig = createPipelineToSheetsConfig(
        outputBaseDir, // This is less important for multi-exam export
        serviceAccountKey,
        {
          spreadsheetId: spreadsheetId, // Make sure to pass the spreadsheet ID
          shareWithEmails: args.shareWith,
          groupBySubject: false, // Don't group by subject for multi-exam
          includeMetadata: args.includeMetadata,
          maxQuestionsPerSheet: args.maxPerSheet,
        }
      );

      const multiExamResult = await exportMultipleExamsToSheets(
        examResults.filter((r) => r.pipelineResult.success),
        {
          sheets: sheetsConfig.sheets,
          export: sheetsConfig.export,
        }
      );

      if (multiExamResult.success) {
        console.log(`\n✅ Multi-exam Google Sheets export completed!`);
        console.log(`📊 Spreadsheet URL: ${multiExamResult.spreadsheetUrl}`);
        console.log(
          `📈 Total successful exports: ${
            multiExamResult.results.filter((r) => r.result.success).length
          }`
        );
      } else {
        console.error(`\n❌ Multi-exam Google Sheets export had errors:`);
        multiExamResult.errors.forEach((error) =>
          console.error(`  - ${error}`)
        );
      }
    }

    console.log("\n🎉 All exams processed!");
  } catch (error) {
    console.error(
      `Error reading exam directories: ${(error as Error).message}`
    );
    process.exit(1);
  }
}

// Main CLI entry point
async function main() {
  // Check if --all flag is provided
  if (argv.includes("--all")) {
    console.log("Running pipeline for all exam directories...");
    await runForAllExams();
  } else {
    await runPipelineCli();
  }
}

// Handle unhandled promise rejections
process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
  process.exit(1);
});

// Handle uncaught exceptions
process.on("uncaughtException", (error) => {
  console.error("Uncaught Exception:", error);
  process.exit(1);
});

// Run if called directly
if (require.main === module) {
  main().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
}

export { runPipelineCli, runForAllExams };
