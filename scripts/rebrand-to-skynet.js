import fs from "node:fs/promises";
import path from "node:path";

const IGNORE_DIRS = new Set([
  "node_modules",
  ".git",
  ".agent",
  ".agents",
  ".gemini",
  "vendor",
  "dist",
  "dist_temp",
  "apps/android/build",
  "apps/android/app/build",
  "apps/ios/build",
  "apps/ios/Pods",
]);

const IGNORE_EXTS = new Set([
  ".png", ".jpg", ".jpeg", ".webp", ".gif", ".ico", ".svg", ".mp4", ".mov", ".zip", ".tar", ".gz", ".db", ".sqlite", ".woff", ".woff2", ".ttf", ".eot", ".pdf"
]);

function replaceContent(text) {
  // Ordered by longest or specific casing first if needed, but global replace works fine
  let newText = text;
  newText = newText.replace(/Skynet/g, "Skynet");
  newText = newText.replace(/skynet/g, "skynet");
  newText = newText.replace(/SKYNET/g, "SKYNET");
  newText = newText.replace(/skynet/g, "skynet");
  return newText;
}

function replaceName(name) {
  let newName = name;
  newName = newName.replace(/Skynet/g, "Skynet");
  newName = newName.replace(/skynet/g, "skynet");
  newName = newName.replace(/SKYNET/g, "SKYNET");
  newName = newName.replace(/skynet/g, "skynet");
  return newName;
}

async function processDirectory(dirPath) {
  let entries;
  try {
    entries = await fs.readdir(dirPath, { withFileTypes: true });
  } catch (err) {
    if (err.code === "EPERM" || err.code === "EACCES") {
      console.warn(`Skipping unreadable directory: ${dirPath}`);
      return;
    }
    throw err;
  }

  for (const entry of entries) {
    if (IGNORE_DIRS.has(entry.name)) {
      continue;
    }

    const fullPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      if (IGNORE_DIRS.has(fullPath) || fullPath.includes("node_modules") || fullPath.includes(".git") || fullPath.includes("vendor") || fullPath.includes(".gemini")) {
           continue;
      }
      // Process children first (bottom-up)
      await processDirectory(fullPath);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (!IGNORE_EXTS.has(ext)) {
        try {
          const content = await fs.readFile(fullPath, "utf-8");
          const newContent = replaceContent(content);
          if (content !== newContent) {
            await fs.writeFile(fullPath, newContent, "utf-8");
            console.log(`Updated content: ${fullPath}`);
          }
        } catch (err) {
          // ignore binary files or unreadable files
        }
      }
    }
  }

  // Now rename children of this directory if their names contain the target word
  let currentEntries = [];
  try {
    currentEntries = await fs.readdir(dirPath, { withFileTypes: true });
  } catch (err) {
    return;
  }
  
  for (const entry of currentEntries) {
    const newName = replaceName(entry.name);
    if (newName !== entry.name) {
      const oldPath = path.join(dirPath, entry.name);
      const newPath = path.join(dirPath, newName);
      await fs.rename(oldPath, newPath);
      console.log(`Renamed: ${oldPath} -> ${newPath}`);
    }
  }
}

async function main() {
  const rootDir = process.cwd();
  console.log(`Starting massive rebrand in ${rootDir}`);
  await processDirectory(rootDir);
  console.log("Done.");
}

main().catch(console.error);
