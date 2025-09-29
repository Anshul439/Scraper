#!/usr/bin/env node

import dotenv from "dotenv";
dotenv.config();
import { readFileSync } from "fs";
import { argv } from "process";
import { existsSync } from "fs";
import {
  runDirectPdfExtractionPipeline,
  createDirectPipelineConfig,
  runDirectPipelineForExam,
} from "../claudePipeline/pipelineOrchestrator";

export interface parsingCliArgs {
  inputDir?: string;
  outputDir?: string;
  claudeApiKey?: string;
  examName?: string;
  maxFiles?: number;
  help?: boolean;
  dryRun?: boolean;
  delayBetweenFiles?: number;
  all?: boolean;
}

function parseCliArgs(): parsingCliArgs {
  const args: parsingCliArgs = {};

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
      case "--max-files":
      case "-f":
        args.maxFiles = parseInt(argv[i + 1]) || undefined;
        i++;
        break;
      case "--delay":
      case "-d":
        args.delayBetweenFiles = parseInt(argv[i + 1]) || 3000;
        i++;
        break;
      case "--help":
      case "-h":
        args.help = true;
        break;
      case "--dry-run":
        args.dryRun = true;
        break;
      case "--all":
        args.all = true;
        break;
    }
  }

  return args;
}

function printHelp() {
  console.log(`
Direct PDF Question Extraction parsing CLI

USAGE:
  npm run parsing -- [OPTIONS]

OPTIONS:
  -i, --input <dir>          Input directory containing PDF files (required unless --all)
  -o, --output <dir>         Output directory for results (required)
  -k, --api-key <key>        Claude AI API key (required)
  -e, --exam <name>          Exam name for context (optional)
  -f, --max-files <num>      Maximum number of PDF files to process (optional)
  -d, --delay <ms>           Delay between files in milliseconds (default: 3000)
      --dry-run              Show what would be processed without running
      --all                  Process all exam directories in ./data
  -h, --help                 Show this help message

EXAMPLES:
  # Process a single exam directory
  npm run parsing -- -i ./data/SSC-CHSL -o ./output -k sk-ant-...

  # Process only first 5 PDFs with custom delay
  npm run parsing -- -i ./data/SSC-CHSL -o ./output -k sk-ant-... \\
    --max-files 5 --delay 5000

  # Process all exam directories
  npm run parsing -- --all -o ./output -k sk-ant-...

  # Dry run to preview
  npm run parsing -- -i ./data/SSC-CHSL -o ./output -k sk-ant-... --dry-run

ENVIRONMENT VARIABLES:
  CLAUDE_API_KEY              Alternative way to provide Claude API key

NOTES:
  - This processes PDFs directly with Claude for high-quality extraction
  - Questions are extracted AND tagged in a single step
  - Results are saved as JSON files in the output directory
  - Use the separate 'sheets-export' command to export results to Google Sheets
  `);
}

function validateArgs(args: parsingCliArgs): string[] {
  const errors: string[] = [];

  // Skip validation for setup/help
  if (args.setupSheets || args.help) {
    return errors;
  }

  // Only require inputDir when not running --all
  if (!args.all && !args.inputDir) {
    errors.push("Input directory is required (use -i or --input, or use --all)");
  } else if (args.inputDir && !existsSync(args.inputDir)) {
    errors.push(`Input directory does not exist: ${args.inputDir}`);
  }

  // Output dir required unless --all (we'll default it for --all)
  if (!args.all && !args.outputDir) {
    errors.push("Output directory is required (use -o or --output)");
  }

  const apiKey = args.claudeApiKey || process.env.CLAUDE_API_KEY;
  if (!apiKey) {
    errors.push(
      "Claude API key is required (use -k, --api-key, or set CLAUDE_API_KEY env var)"
    );
  }

  if (args.maxFiles && args.maxFiles < 1) {
    errors.push("Max files must be greater than 0");
  }

  if (args.delayBetweenFiles && args.delayBetweenFiles < 1000) {
    errors.push("Delay between files should be at least 1000ms (1 second)");
  }

  return errors;
}


async function runParsingForSingleExam(args: parsingCliArgs) {
  const apiKey = args.claudeApiKey || process.env.CLAUDE_API_KEY!;

  if (args.dryRun) {
    console.log("DRY RUN MODE - No actual processing will occur");
    console.log(`
Configuration:
  Input Directory: ${args.inputDir}
  Output Directory: ${args.outputDir}
  Exam Name: ${args.examName || "Auto-detected"}
  Max Files: ${args.maxFiles || "All files"}
  Delay Between Files: ${args.delayBetweenFiles || 3000}ms
  Claude API Key: ${apiKey.substring(0, 10)}...
  Processing Method: Direct PDF with Claude
    `);

    try {
      const { readdirSync } = require("fs");
      const pdfFiles = readdirSync(args.inputDir!).filter((f: string) =>
        f.toLowerCase().endsWith(".pdf")
      );
      const filesToProcess = args.maxFiles
        ? pdfFiles.slice(0, args.maxFiles)
        : pdfFiles;

      console.log(`Found ${pdfFiles.length} PDF files total`);
      console.log(`Will process ${filesToProcess.length} files:`);
      filesToProcess
        .slice(0, 10)
        .forEach((file: string) => console.log(`  - ${file}`));
      if (filesToProcess.length > 10) {
        console.log(`  ... and ${filesToProcess.length - 10} more files`);
      }
    } catch (err) {
      console.error(`Error reading input directory: ${(err as Error).message}`);
    }

    console.log("\nTo run for real, remove the --dry-run flag");
    return;
  }

  try {
    console.log("Starting Direct PDF Question Extraction Pipeline...");
    console.log(`Input: ${args.inputDir}`);
    console.log(`Output: ${args.outputDir}`);
    console.log("Method: Direct PDF processing with Claude AI");
    if (args.examName) console.log(`Exam: ${args.examName}`);

    const config = createDirectPipelineConfig(
      args.inputDir!,
      args.outputDir!,
      apiKey,
      args.examName
    );

    if (args.maxFiles) config.options!.maxFiles = args.maxFiles;
    if (args.delayBetweenFiles)
      config.options!.delayBetweenFiles = args.delayBetweenFiles;

    const result = await runDirectPdfExtractionPipeline(config);

    if (result.success) {
      console.log("\n✅ Pipeline completed successfully!");
      console.log(`Results saved to: ${args.outputDir}`);

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
        `  - Questions extracted & tagged: ${result.summary.questionsTagged}`
      );
      console.log(`  - Time elapsed: ${result.summary.timeElapsed}`);

      console.log("\n💡 Next step: Export to Google Sheets");
      console.log("   Run: npm run sheets-export -- -i ./output");

      if (result.errors.length > 0) {
        console.log(`\nWarnings (${result.errors.length}):`);
        result.errors
          .slice(0, 3)
          .forEach((error) => console.log(`  - ${error}`));
      }
    } else {
      console.error("\n❌ parsing failed!");
      result.errors.forEach((error) => console.error(`  - ${error}`));
      process.exit(1);
    }
  } catch (error) {
    console.error(`\nUnexpected error: ${(error as Error).message}`);
    console.error("Stack trace:", (error as Error).stack);
    process.exit(1);
  }
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

async function runParsingForAllExams(args: parsingCliArgs) {
  const apiKey = args.claudeApiKey || process.env.CLAUDE_API_KEY!;
  const config = loadConfig();
  const baseDir = "./data";
  const outputBaseDir = args.outputDir!;

  try {
    const { readdirSync, statSync } = require("fs");
    const { join } = require("path");

    const examDirs = readdirSync(baseDir).filter((item: string) => {
      const fullPath = join(baseDir, item);
      return statSync(fullPath).isDirectory();
    });

    console.log(`Found ${examDirs.length} exam directories to process:`);
    examDirs.forEach((dir: string) => console.log(`  - ${dir}`));

    for (let i = 0; i < examDirs.length; i++) {
      const examDir = examDirs[i];
      console.log(`\n${"=".repeat(80)}`);
      console.log(`Processing ${i + 1}/${examDirs.length}: ${examDir}`);
      console.log(`${"=".repeat(80)}`);

      try {
        let examConfigForDir = null;
        if (config?.exams) {
          examConfigForDir = config.exams.find(
            (exam: any) =>
              exam.examName === examDir ||
              exam.examKey?.some((key: string) =>
                examDir.toLowerCase().includes(key.toLowerCase())
              )
          );
        }

        const result = await runDirectPipelineForExam(
          join(baseDir, examDir),
          outputBaseDir,
          apiKey,
          examDir,
          examConfigForDir
        );

        if (result.success) {
          console.log(`✅ Successfully processed ${examDir}`);
          console.log(
            `   Questions extracted: ${result.summary.questionsTagged}`
          );
        } else {
          console.error(`❌ Failed to process ${examDir}`);
        }
      } catch (error) {
        console.error(
          `❌ Error processing ${examDir}: ${(error as Error).message}`
        );
      }

      if (i < examDirs.length - 1) {
        console.log("⏳ Waiting 10 seconds before next exam...");
        await new Promise((resolve) => setTimeout(resolve, 10000));
      }
    }

    console.log("\n🎉 All exams processed!");
    console.log("\n💡 Next step: Export all results to Google Sheets");
    console.log("   Run: npm run sheets-export -- --all");
  } catch (error) {
    console.error(`Error: ${(error as Error).message}`);
    process.exit(1);
  }
}

async function main() {
  const args = parseCliArgs();

  // If user asked for --all and didn't pass -o, default output dir
  if (args.all && !args.outputDir) {
    args.outputDir = "./processed-questions";
    console.log(`--all detected: defaulting outputDir to ${args.outputDir}`);
  }

  if (args.help) {
    printHelp();
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
    await runParsingForAllExams(args);
  } else {
    await runParsingForSingleExam(args);
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

export { main as runParsingCli };