// A unified diff is the text format produced by `diff -u` and `git diff`:
// a pair of "--- "/"+++ " file headers followed by one or more hunks, each
// starting with an "@@ -old,+new @@" range header.

export type DiffLine =
  | { kind: "context"; text: string; noNewlineAtEnd?: boolean }
  | { kind: "add"; text: string; noNewlineAtEnd?: boolean }
  | { kind: "remove"; text: string; noNewlineAtEnd?: boolean };

export interface Hunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  // Trailing text on the "@@" line, e.g. the enclosing function signature
  // that `git diff` likes to append. Empty string when absent.
  sectionHeading: string;
  lines: DiffLine[];
}

// The extra metadata `git diff` prints above the "--- "/"+++ " headers.
// Not every field is present on every header: a pure rename carries
// similarityIndex/renameFrom/renameTo and no index line at all, a mode-only
// change carries oldMode/newMode and nothing else, and so on.
export interface GitFileHeader {
  // Paths as they appear on the "diff --git a/X b/Y" line, with the
  // "a/"/"b/" prefix already stripped.
  oldPath: string;
  newPath: string;
  oldMode?: string;
  newMode?: string;
  deletedFileMode?: string;
  newFileMode?: string;
  similarityIndex?: number;
  dissimilarityIndex?: number;
  renameFrom?: string;
  renameTo?: string;
  copyFrom?: string;
  copyTo?: string;
  index?: { oldHash: string; newHash: string; mode?: string };
}

export interface FileDiff {
  oldPath: string;
  newPath: string;
  hunks: Hunk[];
  // Present when this file entry came from a `diff --git` header rather
  // than a plain `diff -u` "--- "/"+++ " pair.
  gitHeader?: GitFileHeader;
}

export interface ParsedDiff {
  files: FileDiff[];
}

export class DiffParseError extends Error {
  constructor(message: string, public readonly lineNumber: number) {
    super(`line ${lineNumber}: ${message}`);
    this.name = "DiffParseError";
  }
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/;

const DIFF_GIT_LINE = /^diff --git a\/(.+) b\/(.+)$/;
const OLD_MODE = /^old mode (\d{6})$/;
const NEW_MODE = /^new mode (\d{6})$/;
const DELETED_FILE_MODE = /^deleted file mode (\d{6})$/;
const NEW_FILE_MODE = /^new file mode (\d{6})$/;
const SIMILARITY_INDEX = /^similarity index (\d+)%$/;
const DISSIMILARITY_INDEX = /^dissimilarity index (\d+)%$/;
const RENAME_FROM = /^rename from (.*)$/;
const RENAME_TO = /^rename to (.*)$/;
const COPY_FROM = /^copy from (.*)$/;
const COPY_TO = /^copy to (.*)$/;
const INDEX_LINE = /^index ([0-9a-f]+)\.\.([0-9a-f]+)(?: (\d{6}))?$/;

export function parseDiff(text: string): ParsedDiff {
  const rawLines = text.length === 0 ? [] : text.split("\n");
  // A trailing "\n" in the source text splits into a trailing "" element;
  // drop it so we don't try to parse a phantom empty diff line.
  if (rawLines.length > 0 && rawLines[rawLines.length - 1] === "") {
    rawLines.pop();
  }

  const files: FileDiff[] = [];
  let i = 0;

  const peek = (): string | undefined => rawLines[i];

  const parseHunk = (): Hunk => {
    const headerLineNumber = i + 1;
    const header = rawLines[i];
    const match = HUNK_HEADER.exec(header);
    if (!match) {
      throw new DiffParseError(`malformed hunk header ${JSON.stringify(header)}`, headerLineNumber);
    }
    const oldStart = Number(match[1]);
    const oldLines = match[2] === undefined ? 1 : Number(match[2]);
    const newStart = Number(match[3]);
    const newLines = match[4] === undefined ? 1 : Number(match[4]);
    const sectionHeading = match[5].length > 0 ? match[5].slice(1) : "";
    i++;

    const lines: DiffLine[] = [];
    let oldSeen = 0;
    let newSeen = 0;

    while (true) {
      const raw = peek();

      // "\ No newline at end of file" can follow a line even after the
      // header's declared counts are already satisfied, so it has to be
      // checked before we decide the hunk is done.
      if (raw !== undefined && raw.startsWith("\\ ")) {
        const prev = lines[lines.length - 1];
        if (prev === undefined) {
          throw new DiffParseError(`"\\ No newline" marker with no preceding line`, i + 1);
        }
        prev.noNewlineAtEnd = true;
        i++;
        continue;
      }

      if (oldSeen >= oldLines && newSeen >= newLines) {
        break;
      }

      if (raw === undefined) {
        throw new DiffParseError(
          `hunk ended early: expected ${oldLines} old line(s) and ${newLines} new line(s), saw ${oldSeen} and ${newSeen}`,
          i + 1
        );
      }

      const marker = raw.charAt(0);
      const lineText = raw.slice(1);
      if (marker === " ") {
        lines.push({ kind: "context", text: lineText });
        oldSeen++;
        newSeen++;
      } else if (marker === "-") {
        lines.push({ kind: "remove", text: lineText });
        oldSeen++;
      } else if (marker === "+") {
        lines.push({ kind: "add", text: lineText });
        newSeen++;
      } else {
        throw new DiffParseError(`unrecognized hunk line prefix ${JSON.stringify(marker)}`, i + 1);
      }
      i++;
    }

    if (oldSeen !== oldLines || newSeen !== newLines) {
      throw new DiffParseError(
        `hunk header declared ${oldLines} old / ${newLines} new line(s) but body has ${oldSeen} / ${newSeen}`,
        headerLineNumber
      );
    }

    return { oldStart, oldLines, newStart, newLines, sectionHeading, lines };
  };

  const parseGitHeader = (): GitFileHeader => {
    const line = rawLines[i];
    const match = DIFF_GIT_LINE.exec(line);
    if (!match) {
      throw new DiffParseError(`malformed "diff --git" line ${JSON.stringify(line)}`, i + 1);
    }
    const header: GitFileHeader = { oldPath: match[1], newPath: match[2] };
    i++;

    while (true) {
      const raw = peek();
      if (raw === undefined || raw.startsWith("--- ") || raw.startsWith("diff --git ")) {
        break;
      }
      let m: RegExpExecArray | null;
      if ((m = OLD_MODE.exec(raw))) {
        header.oldMode = m[1];
      } else if ((m = NEW_MODE.exec(raw))) {
        header.newMode = m[1];
      } else if ((m = DELETED_FILE_MODE.exec(raw))) {
        header.deletedFileMode = m[1];
      } else if ((m = NEW_FILE_MODE.exec(raw))) {
        header.newFileMode = m[1];
      } else if ((m = SIMILARITY_INDEX.exec(raw))) {
        header.similarityIndex = Number(m[1]);
      } else if ((m = DISSIMILARITY_INDEX.exec(raw))) {
        header.dissimilarityIndex = Number(m[1]);
      } else if ((m = RENAME_FROM.exec(raw))) {
        header.renameFrom = m[1];
      } else if ((m = RENAME_TO.exec(raw))) {
        header.renameTo = m[1];
      } else if ((m = COPY_FROM.exec(raw))) {
        header.copyFrom = m[1];
      } else if ((m = COPY_TO.exec(raw))) {
        header.copyTo = m[1];
      } else if ((m = INDEX_LINE.exec(raw))) {
        header.index = { oldHash: m[1], newHash: m[2], mode: m[3] };
      } else {
        // Something we don't recognize (e.g. a binary patch marker) - stop
        // here and let whatever comes next be parsed on its own terms.
        break;
      }
      i++;
    }

    return header;
  };

  while (i < rawLines.length) {
    const line = peek();
    const gitHeader = line !== undefined && line.startsWith("diff --git ") ? parseGitHeader() : undefined;

    const headerLine = peek();
    let oldPath: string;
    let newPath: string;
    const hunks: Hunk[] = [];

    if (headerLine !== undefined && headerLine.startsWith("--- ")) {
      oldPath = headerLine.slice(4).trim();
      i++;

      const plusLine = peek();
      if (plusLine === undefined || !plusLine.startsWith("+++ ")) {
        throw new DiffParseError(`expected a "+++ " new-file header after a "--- " header`, i + 1);
      }
      newPath = plusLine.slice(4).trim();
      i++;

      while (peek() !== undefined && peek()!.startsWith("@@ ")) {
        hunks.push(parseHunk());
      }

      if (hunks.length === 0) {
        throw new DiffParseError(`file header for ${JSON.stringify(oldPath)} has no hunks`, i + 1);
      }
    } else if (gitHeader !== undefined) {
      // A pure rename, copy, or mode change carries no "--- "/"+++ " pair
      // or hunks at all - the diff --git header is the whole story.
      oldPath = `a/${gitHeader.oldPath}`;
      newPath = `b/${gitHeader.newPath}`;
    } else {
      throw new DiffParseError(`expected a "--- " old-file header, found ${JSON.stringify(headerLine)}`, i + 1);
    }

    files.push({ oldPath, newPath, hunks, gitHeader });
  }

  return { files };
}

function printHunkHeader(hunk: Hunk): string {
  const oldRange = hunk.oldLines === 1 ? `${hunk.oldStart}` : `${hunk.oldStart},${hunk.oldLines}`;
  const newRange = hunk.newLines === 1 ? `${hunk.newStart}` : `${hunk.newStart},${hunk.newLines}`;
  const heading = hunk.sectionHeading.length > 0 ? ` ${hunk.sectionHeading}` : "";
  return `@@ -${oldRange} +${newRange} @@${heading}`;
}

// Mirrors the fixed order git itself emits these lines in: mode lines,
// then similarity/rename/copy, then the index line.
function printGitHeaderLines(header: GitFileHeader): string[] {
  const out: string[] = [`diff --git a/${header.oldPath} b/${header.newPath}`];
  if (header.oldMode !== undefined && header.newMode !== undefined) {
    out.push(`old mode ${header.oldMode}`);
    out.push(`new mode ${header.newMode}`);
  }
  if (header.deletedFileMode !== undefined) {
    out.push(`deleted file mode ${header.deletedFileMode}`);
  }
  if (header.newFileMode !== undefined) {
    out.push(`new file mode ${header.newFileMode}`);
  }
  if (header.similarityIndex !== undefined) {
    out.push(`similarity index ${header.similarityIndex}%`);
  }
  if (header.dissimilarityIndex !== undefined) {
    out.push(`dissimilarity index ${header.dissimilarityIndex}%`);
  }
  if (header.renameFrom !== undefined && header.renameTo !== undefined) {
    out.push(`rename from ${header.renameFrom}`);
    out.push(`rename to ${header.renameTo}`);
  }
  if (header.copyFrom !== undefined && header.copyTo !== undefined) {
    out.push(`copy from ${header.copyFrom}`);
    out.push(`copy to ${header.copyTo}`);
  }
  if (header.index !== undefined) {
    const mode = header.index.mode !== undefined ? ` ${header.index.mode}` : "";
    out.push(`index ${header.index.oldHash}..${header.index.newHash}${mode}`);
  }
  return out;
}

export function printDiff(diff: ParsedDiff): string {
  const out: string[] = [];
  for (const file of diff.files) {
    if (file.gitHeader !== undefined) {
      out.push(...printGitHeaderLines(file.gitHeader));
    }
    if (file.hunks.length > 0) {
      out.push(`--- ${file.oldPath}`);
      out.push(`+++ ${file.newPath}`);
      for (const hunk of file.hunks) {
        out.push(printHunkHeader(hunk));
        for (const line of hunk.lines) {
          const marker = line.kind === "context" ? " " : line.kind === "add" ? "+" : "-";
          out.push(marker + line.text);
          if (line.noNewlineAtEnd) {
            out.push("\\ No newline at end of file");
          }
        }
      }
    }
  }
  return out.length === 0 ? "" : out.join("\n") + "\n";
}
