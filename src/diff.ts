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

export interface FileDiff {
  oldPath: string;
  newPath: string;
  hunks: Hunk[];
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

  while (i < rawLines.length) {
    const line = peek();
    if (line === undefined || !line.startsWith("--- ")) {
      throw new DiffParseError(`expected a "--- " old-file header, found ${JSON.stringify(line)}`, i + 1);
    }
    const oldPath = line.slice(4).trim();
    i++;

    const plusLine = peek();
    if (plusLine === undefined || !plusLine.startsWith("+++ ")) {
      throw new DiffParseError(`expected a "+++ " new-file header after a "--- " header`, i + 1);
    }
    const newPath = plusLine.slice(4).trim();
    i++;

    const hunks: Hunk[] = [];
    while (peek() !== undefined && peek()!.startsWith("@@ ")) {
      hunks.push(parseHunk());
    }

    if (hunks.length === 0) {
      throw new DiffParseError(`file header for ${JSON.stringify(oldPath)} has no hunks`, i + 1);
    }

    files.push({ oldPath, newPath, hunks });
  }

  return { files };
}

function printHunkHeader(hunk: Hunk): string {
  const oldRange = hunk.oldLines === 1 ? `${hunk.oldStart}` : `${hunk.oldStart},${hunk.oldLines}`;
  const newRange = hunk.newLines === 1 ? `${hunk.newStart}` : `${hunk.newStart},${hunk.newLines}`;
  const heading = hunk.sectionHeading.length > 0 ? ` ${hunk.sectionHeading}` : "";
  return `@@ -${oldRange} +${newRange} @@${heading}`;
}

export function printDiff(diff: ParsedDiff): string {
  const out: string[] = [];
  for (const file of diff.files) {
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
  return out.length === 0 ? "" : out.join("\n") + "\n";
}
