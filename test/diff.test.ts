import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDiff, printDiff, DiffParseError } from "../src/diff.js";

// Table-driven: each entry is a full unified diff that should parse and
// then print back out byte-for-byte identical to what went in. These are
// the cases that tend to break hand-rolled parsers.
interface RoundTripCase {
  name: string;
  input: string;
}

const roundTripCases: RoundTripCase[] = [
  {
    name: "empty diff",
    input: "",
  },
  {
    name: "single hunk, single file",
    input: [
      "--- a/greeting.txt",
      "+++ b/greeting.txt",
      "@@ -1,3 +1,3 @@",
      " hello",
      "-old world",
      "+new world",
      " goodbye",
      "",
    ].join("\n"),
  },
  {
    name: "hunk header omits the count when it is 1",
    input: [
      "--- a/one.txt",
      "+++ b/one.txt",
      "@@ -1 +1,2 @@",
      "-only line",
      "+first line",
      "+second line",
      "",
    ].join("\n"),
  },
  {
    name: "multiple hunks in one file",
    input: [
      "--- a/multi.txt",
      "+++ b/multi.txt",
      "@@ -1,2 +1,2 @@",
      "-top old",
      "+top new",
      " middle",
      "@@ -10,2 +10,2 @@",
      " middle two",
      "-bottom old",
      "+bottom new",
      "",
    ].join("\n"),
  },
  {
    name: "multiple files in one diff",
    input: [
      "--- a/one.txt",
      "+++ b/one.txt",
      "@@ -1 +1 @@",
      "-a",
      "+b",
      "--- a/two.txt",
      "+++ b/two.txt",
      "@@ -1 +1 @@",
      "-c",
      "+d",
      "",
    ].join("\n"),
  },
  {
    name: "no newline at end of file, on both sides of a change",
    input: [
      "--- a/tail.txt",
      "+++ b/tail.txt",
      "@@ -1,2 +1,2 @@",
      " kept",
      "-old tail",
      "\\ No newline at end of file",
      "+new tail",
      "\\ No newline at end of file",
      "",
    ].join("\n"),
  },
  {
    name: "new file creation (old side has zero lines)",
    input: ["--- /dev/null", "+++ b/created.txt", "@@ -0,0 +1,2 @@", "+first", "+second", ""].join("\n"),
  },
  {
    name: "hunk header carries a section heading",
    input: [
      "--- a/code.ts",
      "+++ b/code.ts",
      "@@ -4,3 +4,3 @@ function example() {",
      "   const a = 1;",
      "-  const b = 2;",
      "+  const b = 3;",
      "   return a + b;",
      "",
    ].join("\n"),
  },
  {
    name: "git diff with an index line and a content change",
    input: [
      "diff --git a/greeting.txt b/greeting.txt",
      "index 1234567..89abcde 100644",
      "--- a/greeting.txt",
      "+++ b/greeting.txt",
      "@@ -1,3 +1,3 @@",
      " hello",
      "-old world",
      "+new world",
      " goodbye",
      "",
    ].join("\n"),
  },
  {
    name: "pure rename, no content change",
    input: [
      "diff --git a/old.txt b/new.txt",
      "similarity index 100%",
      "rename from old.txt",
      "rename to new.txt",
      "",
    ].join("\n"),
  },
  {
    name: "rename with a content change",
    input: [
      "diff --git a/old.txt b/new.txt",
      "similarity index 88%",
      "rename from old.txt",
      "rename to new.txt",
      "index 1234567..89abcde 100644",
      "--- a/old.txt",
      "+++ b/new.txt",
      "@@ -1 +1 @@",
      "-old text",
      "+new text",
      "",
    ].join("\n"),
  },
  {
    name: "pure copy, no content change",
    input: [
      "diff --git a/file.txt b/copy.txt",
      "similarity index 100%",
      "copy from file.txt",
      "copy to copy.txt",
      "",
    ].join("\n"),
  },
  {
    name: "mode change only, no content change",
    input: ["diff --git a/script.sh b/script.sh", "old mode 100644", "new mode 100755", ""].join("\n"),
  },
  {
    name: "new file created through a git diff",
    input: [
      "diff --git a/created.txt b/created.txt",
      "new file mode 100644",
      "index 0000000..e69de29",
      "--- /dev/null",
      "+++ b/created.txt",
      "@@ -0,0 +1,1 @@",
      "+content",
      "",
    ].join("\n"),
  },
  {
    name: "file deleted through a git diff",
    input: [
      "diff --git a/gone.txt b/gone.txt",
      "deleted file mode 100644",
      "index e69de29..0000000",
      "--- a/gone.txt",
      "+++ /dev/null",
      "@@ -1,1 +0,0 @@",
      "-content",
      "",
    ].join("\n"),
  },
  {
    name: "two git-diff files in one patch",
    input: [
      "diff --git a/one.txt b/one.txt",
      "index 1111111..2222222 100644",
      "--- a/one.txt",
      "+++ b/one.txt",
      "@@ -1 +1 @@",
      "-a",
      "+b",
      "diff --git a/two.txt b/renamed.txt",
      "similarity index 100%",
      "rename from two.txt",
      "rename to renamed.txt",
      "",
    ].join("\n"),
  },
];

for (const { name, input } of roundTripCases) {
  test(`round-trips: ${name}`, () => {
    const parsed = parseDiff(input);
    const printed = printDiff(parsed);
    assert.equal(printed, input);
    // A pretty printer that doesn't reproduce its own input on a second
    // pass is broken, even if the first pass happened to look right.
    assert.deepEqual(parseDiff(printed), parsed);
  });
}

interface ErrorCase {
  name: string;
  input: string;
  messageContains: string;
}

const errorCases: ErrorCase[] = [
  {
    name: "missing +++ header after ---",
    input: ["--- a/file.txt", "@@ -1 +1 @@", "-a", "+b", ""].join("\n"),
    messageContains: '"+++ "',
  },
  {
    name: "file header with no hunks",
    input: ["--- a/file.txt", "+++ b/file.txt", ""].join("\n"),
    messageContains: "no hunks",
  },
  {
    name: "hunk truncated before the declared line count is reached",
    input: ["--- a/file.txt", "+++ b/file.txt", "@@ -1,3 +1,3 @@", " one", "-two", ""].join("\n"),
    messageContains: "ended early",
  },
  {
    name: "hunk body has more lines than the header declared",
    input: ["--- a/file.txt", "+++ b/file.txt", "@@ -1,1 +1,1 @@", " one", " two", ""].join("\n"),
    messageContains: '"--- "',
  },
  {
    name: "malformed hunk header",
    input: ["--- a/file.txt", "+++ b/file.txt", "@@ nonsense @@", " one", ""].join("\n"),
    messageContains: "malformed hunk header",
  },
  {
    name: "no-newline marker with nothing before it",
    input: ["--- a/file.txt", "+++ b/file.txt", "@@ -0,0 +1,1 @@", "\\ No newline at end of file", ""].join("\n"),
    messageContains: "no preceding line",
  },
  {
    name: "diff --git line missing the b/ path",
    input: ["diff --git a/file.txt", "--- a/file.txt", "+++ b/file.txt", "@@ -1 +1 @@", "-a", "+b", ""].join("\n"),
    messageContains: "malformed",
  },
];

for (const { name, input, messageContains } of errorCases) {
  test(`rejects: ${name}`, () => {
    assert.throws(
      () => parseDiff(input),
      (err: unknown) => {
        assert.ok(err instanceof DiffParseError, "expected a DiffParseError");
        const message = (err as DiffParseError).message;
        assert.ok(
          message.includes(messageContains),
          `expected message to include ${JSON.stringify(messageContains)}, got ${JSON.stringify(message)}`
        );
        return true;
      }
    );
  });
}
