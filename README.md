# unified-diff-kit

A parser and pretty printer for unified diff text — the format produced by
`diff -u` and `git diff`.

## why

I kept writing small scripts that needed to read or rewrite unified diffs,
and every quick regex-based parser I threw together either accepted garbage
silently or dropped edge cases like a missing trailing newline. A unified
diff hunk header declares exactly how many old and new lines follow it
(`@@ -oldStart,oldLines +newStart,newLines @@`), which means a correct parser
can actually check its own work instead of guessing where a hunk ends. This
library does that: `parseDiff` rejects a hunk whose body doesn't match its
declared counts instead of returning a diff that looks plausible but isn't,
and `printDiff` is built to round-trip whatever `parseDiff` produced.

## install

No package is published yet. Clone the repo and build it:

```
npm install --no-save typescript @types/node
npm run build
```

(`--no-save` keeps this zero-dependency at the source level; the two
packages above are only needed to compile TypeScript, not at runtime.)

## usage

```ts
import { parseDiff, printDiff } from "./dist/index.js";

const patch = `--- a/greeting.txt
+++ b/greeting.txt
@@ -1,3 +1,3 @@
 hello
-old world
+new world
 goodbye
`;

const diff = parseDiff(patch);

for (const file of diff.files) {
  console.log(`${file.oldPath} -> ${file.newPath}`);
  for (const hunk of file.hunks) {
    const added = hunk.lines.filter((l) => l.kind === "add").length;
    const removed = hunk.lines.filter((l) => l.kind === "remove").length;
    console.log(`  hunk at ${hunk.newStart}: +${added} -${removed}`);
  }
}

// printDiff(diff) === patch
```

A malformed patch throws a `DiffParseError` with a line number attached,
instead of returning a hunk with the wrong lines in it:

```ts
import { parseDiff, DiffParseError } from "./dist/index.js";

try {
  parseDiff("--- a/x\n+++ b/x\n@@ -1,2 +1,2 @@\n only one line\n");
} catch (err) {
  if (err instanceof DiffParseError) {
    console.error(err.message); // "line 3: hunk ended early: ..."
  }
}
```

## what it does not do (yet)

- `diff --git` extended headers (rename/copy/mode-change lines)
- combined diffs (`diff -c`, three-way merge output)
- applying a parsed diff back onto source text

See the data model in `src/diff.ts` (`ParsedDiff`, `FileDiff`, `Hunk`,
`DiffLine`) if you want to build on top of it before those land.

## testing

```
npm test
```

Runs `tsc` then Node's built-in test runner (`node --test`) against the
compiled output in `dist/test`. The suite in `test/diff.test.ts` is
table-driven: one table of diffs that must round-trip exactly (empty diffs,
omitted hunk counts, multiple hunks, multiple files, "no newline at end of
file", new-file creation, section headings), and one table of malformed
diffs that must be rejected with a specific error.

## license

MIT, see `LICENSE`.
