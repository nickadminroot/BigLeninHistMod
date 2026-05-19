/**
 * Document chunker for HOI4 mod documentation.
 *
 * Splits markdown files into semantic chunks by ## headings.
 * Merges tiny consecutive chunks (< minChunkSize) into neighbours.
 * Skips Table of Contents sections.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import type { RAGConfig } from "./config";

export interface Chunk {
  id: string;
  filePath: string;
  heading: string;
  content: string;
  embedding?: number[];
  similarity?: number;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function createChunkId(filePath: string, heading: string, index: number): string {
  const safePath = filePath.replace(/[/\\:]/g, "_");
  const safeHeading = heading.replace(/[^a-zA-Z0-9_\u0080-\uFFFF]/g, "_").slice(0, 48);
  return `${safePath}_${safeHeading}_${index}`;
}

function extractHeadingText(headingLine: string): string {
  return headingLine.replace(/^#+\s*/, "").trim();
}

function isTocHeading(headingLine: string): boolean {
  const text = extractHeadingText(headingLine).toLowerCase();
  return text === "table of content" || text === "table of contents";
}

/**
 * Merge consecutive chunks below minSize into neighbours.
 * - If chunk[i] < minSize: prepend its content to chunk[i+1], remove chunk[i].
 * - The last chunk is never merged into nothing; if it's tiny, merge into previous.
 */
function mergeTinyChunks(chunks: Chunk[], minSize: number): Chunk[] {
  if (chunks.length <= 1) return chunks;

  const result: Chunk[] = [];
  let buffer = "";

  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i];
    if (c.content.length < minSize && i < chunks.length - 1) {
      // Too small and not last — merge into next chunk
      chunks[i + 1] = {
        ...chunks[i + 1],
        content: c.content + "\n\n" + chunks[i + 1].content,
        id: createChunkId(c.filePath, chunks[i + 1].heading, result.length),
      };
    } else if (c.content.length < minSize && result.length > 0) {
      // Too small and is last — merge into previous
      const prev = result[result.length - 1];
      result[result.length - 1] = {
        ...prev,
        content: prev.content + "\n\n" + c.content,
        id: createChunkId(prev.filePath, prev.heading, result.length - 1),
      };
    } else {
      result.push(c);
    }
  }

  return result;
}

/**
 * Clean up a file-specific heading prefix like "dynamic_variables_documentation.mdglobal"
 * to just "global". This handles files where the ## heading includes the filename.
 */
function cleanHeadingPrefix(heading: string, filePath: string): string {
  // The filePath may include .md extension that also appears in the heading
  // e.g. file="dynamic_variables_documentation.md" heading="dynamic_variables_documentation.mdglobal"
  // Strip both the filename without extension AND with extension from the heading
  const fileBase = filePath
    .replace(/\.md$/i, "")          // remove .md extension
    .replace(/[/\\]/g, "_")        // normalize separators
    .toLowerCase();
  const fileBaseWithMd = fileBase + ".md";

  const headingLower = heading.toLowerCase();

  // Try stripping with .md first, then without
  if (headingLower.startsWith(fileBaseWithMd)) {
    const cleaned = heading.slice(fileBaseWithMd.length);
    if (cleaned.length > 0) return cleaned;
  }
  if (headingLower.startsWith(fileBase)) {
    const cleaned = heading.slice(fileBase.length);
    // If result starts with .md, strip that too (it's part of the filename extension)
    if (cleaned.toLowerCase().startsWith(".md") && cleaned.length > 3) {
      return cleaned.slice(3);
    }
    if (cleaned.length > 0) return cleaned;
  }
  return heading;
}

// ─── Main chunking logic ───────────────────────────────────────────────────

/**
 * Split a markdown file into chunks by ## headings.
 * `minChunkSize` — chunks below this threshold get merged into neighbours.
 */
export function chunkMarkdown(
  content: string,
  filePath: string,
  maxChunkSize: number,
  minChunkSize = 200,
): Chunk[] {
  const lines = content.split(/\r?\n/);
  let rawChunks: Chunk[] = [];

  // Find all ## (exactly two hashes) heading lines
  const headingPositions: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (/^## (?!#)/.test(lines[i])) {
      headingPositions.push(i);
    }
  }

  if (headingPositions.length === 0) {
    // No headings — treat entire file as one chunk
    const trimmed = content.trim();
    if (trimmed) {
      rawChunks.push({
        id: createChunkId(filePath, "(root)", 0),
        filePath,
        heading: "(root)",
        content: trimmed,
      });
    }
    return rawChunks;
  }

  for (let i = 0; i < headingPositions.length; i++) {
    const startLine = headingPositions[i];
    const endLine =
      i + 1 < headingPositions.length
        ? headingPositions[i + 1]
        : lines.length;

    const headingLine = lines[startLine];

    // Skip Table of Contents
    if (isTocHeading(headingLine)) continue;

    let heading = extractHeadingText(headingLine);
    // Clean file-prefixed headings (e.g. dynamic_variables_documentation.mdglobal → global)
    heading = cleanHeadingPrefix(heading, filePath);

    const body = lines.slice(startLine + 1, endLine).join("\n").trim();
    let chunkText = headingLine.trim() + "\n" + body;
    if (chunkText.trim().length < 10) continue;

    if (chunkText.length > maxChunkSize) {
      const subChunks = splitLargeChunk(chunkText, heading, filePath, maxChunkSize);
      rawChunks.push(...subChunks);
    } else {
      rawChunks.push({
        id: createChunkId(filePath, heading, rawChunks.length),
        filePath,
        heading,
        content: chunkText,
      });
    }
  }

  // Merge tiny chunks into neighbours
  rawChunks = mergeTinyChunks(rawChunks, minChunkSize);

  // Re-assign stable IDs after merging
  rawChunks.forEach((c, i) => {
    c.id = createChunkId(c.filePath, c.heading, i);
  });

  return rawChunks;
}

/**
 * Split a large chunk by ### subheadings or paragraphs.
 */
function splitLargeChunk(
  fullText: string,
  parentHeading: string,
  filePath: string,
  maxSize: number,
): Chunk[] {
  const result: Chunk[] = [];
  const lines = fullText.split(/\r?\n/);

  // Try splitting by ### subheadings first
  const subPositions: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (/^### (?!#)/.test(lines[i])) {
      subPositions.push(i);
    }
  }

  if (subPositions.length > 1) {
    for (let i = 0; i < subPositions.length; i++) {
      const start = subPositions[i];
      const end =
        i + 1 < subPositions.length ? subPositions[i + 1] : lines.length;
      const text = lines.slice(start, end).join("\n").trim();
      if (text.length >= 10) {
        const subHeading = cleanHeadingPrefix(
          extractHeadingText(lines[start]),
          filePath,
        );
        result.push({
          id: createChunkId(
            filePath,
            `${parentHeading} > ${subHeading}`,
            result.length,
          ),
          filePath,
          heading: subHeading,  // use actual variable name, not parent scope
          content: text,
        });
      }
    }
    if (result.length > 0) return result;
  }

  // Fallback: split by paragraphs at ~maxSize boundaries
  let current = "";
  for (const line of lines) {
    if (current.length + line.length > maxSize && current.length > 0) {
      if (current.trim().length >= 10) {
        result.push({
          id: createChunkId(filePath, parentHeading, result.length),
          filePath,
          heading: parentHeading,
          content: current.trim(),
        });
      }
      current = line;
    } else {
      current += (current ? "\n" : "") + line;
    }
  }
  if (current.trim().length >= 10) {
    result.push({
      id: createChunkId(filePath, parentHeading, result.length),
      filePath,
      heading: parentHeading,
      content: current.trim(),
    });
  }

  return result;
}

// ─── File discovery (glob-less) ─────────────────────────────────────────────

function walkDir(dir: string, callback: (file: string) => void): void {
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        walkDir(fullPath, callback);
      } else if (entry.isFile()) {
        callback(fullPath);
      }
    }
  } catch {
    // skip unreadable
  }
}

function matchGlob(filePath: string, pattern: string): boolean {
  const normalizedPath = filePath.replace(/\\/g, "/");
  const normalizedPattern = pattern.replace(/\\/g, "/");

  let regexStr = "^";
  let i = 0;
  while (i < normalizedPattern.length) {
    const ch = normalizedPattern[i];
    if (ch === "*" && normalizedPattern[i + 1] === "*") {
      regexStr += ".*";
      i += 2;
      if (normalizedPattern[i] === "/") i++;
    } else if (ch === "*") {
      regexStr += "[^/]*";
      i++;
    } else if (ch === "?") {
      regexStr += "[^/]";
      i++;
    } else if (/[.+^${}()|\[\]\\]/.test(ch)) {
      regexStr += "\\" + ch;
      i++;
    } else {
      regexStr += ch;
      i++;
    }
  }
  regexStr += "$";

  try {
    return new RegExp(regexStr, "i").test(normalizedPath);
  } catch {
    return false;
  }
}

function resolvePatterns(patterns: string[], rootDir: string): string[] {
  const results = new Set<string>();

  for (const pattern of patterns) {
    if (!pattern.includes("*") && !pattern.includes("?")) {
      const fullPath = resolve(rootDir, pattern);
      try {
        if (statSync(fullPath).isFile()) results.add(fullPath);
      } catch { /* skip missing */ }
      continue;
    }

    const starIndex = pattern.indexOf("*");
    const qIndex = pattern.indexOf("?");
    const firstWildcard =
      starIndex >= 0 && qIndex >= 0
        ? Math.min(starIndex, qIndex)
        : starIndex >= 0
          ? starIndex
          : qIndex;

    const beforeWildcard = pattern.slice(0, firstWildcard);
    const lastSep = beforeWildcard.lastIndexOf("/");
    const baseRel = lastSep >= 0 ? beforeWildcard.slice(0, lastSep) : ".";
    const baseDir = resolve(rootDir, baseRel);

    walkDir(baseDir, (filePath) => {
      const relPath = relative(rootDir, filePath).replace(/\\/g, "/");
      if (matchGlob(relPath, pattern.replace(/\\/g, "/"))) {
        results.add(filePath);
      }
    });
  }

  return [...results];
}

// ─── Public API ─────────────────────────────────────────────────────────────

export function discoverDocumentationFiles(
  config: RAGConfig,
  rootDir: string,
): Array<{ filePath: string; content: string }> {
  const files = resolvePatterns(config.includePatterns, rootDir);

  return files
    .map((filePath) => {
      try {
        const content = readFileSync(filePath, "utf-8");
        return { filePath: relative(rootDir, filePath), content };
      } catch {
        return null;
      }
    })
    .filter((f): f is { filePath: string; content: string } => f !== null);
}

export function chunkFiles(
  files: Array<{ filePath: string; content: string }>,
  config: RAGConfig,
): Chunk[] {
  const allChunks: Chunk[] = [];
  for (const file of files) {
    const chunks = chunkMarkdown(
      file.content,
      file.filePath,
      config.maxChunkSize,
      200, // minChunkSize — merge anything below
    );
    allChunks.push(...chunks);
  }
  return allChunks;
}
