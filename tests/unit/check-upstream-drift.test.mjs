import assert from "node:assert/strict";
import test from "node:test";

import {
  buildManifestFiles,
  parseManifest,
  parseNameStatus,
  resolveUpstreamRef,
} from "../../scripts/check/check-upstream-drift.mjs";

test("parseNameStatus tracks every path and rename/copy destinations", () => {
  const stream =
    [
      "M",
      "modified file.ts",
      "D",
      "deleted file.ts",
      "R100",
      "old renamed file.ts",
      "new renamed file.ts",
      "C100",
      "copy source file.ts",
      "copy destination file.ts",
    ].join("\0") + "\0";

  assert.deepEqual(parseNameStatus(stream), [
    { status: "M", file: "modified file.ts" },
    { status: "D", file: "deleted file.ts" },
    { status: "R100", file: "new renamed file.ts" },
    { status: "C100", file: "copy destination file.ts" },
  ]);
});

test("parseNameStatus accepts empty output and single-path statuses", () => {
  assert.deepEqual(parseNameStatus(""), []);
  assert.deepEqual(parseNameStatus("T\0type changed.ts\0U\0unmerged.ts\0X\0unknown.ts\0"), [
    { status: "T", file: "type changed.ts" },
    { status: "U", file: "unmerged.ts" },
    { status: "X", file: "unknown.ts" },
  ]);
});

test("parseNameStatus rejects malformed or truncated streams", () => {
  assert.throws(() => parseNameStatus("M\0"), /incomplete|malformed/i);
  assert.throws(() => parseNameStatus("R100\0old.ts\0"), /incomplete|malformed/i);
  assert.throws(() => parseNameStatus("not-a-status\0file.ts\0"), /status/i);
});

test("buildManifestFiles extracts sentinels for rename/copy destinations", () => {
  const stream = "R100\0old name.ts\0new name.ts\0C100\0copy source.ts\0copy destination.ts\0";
  const patches = {
    "new name.ts": "diff --git a/old name.ts b/new name.ts\n+const localRenameFix = true;\n",
    "copy destination.ts":
      "diff --git a/copy source.ts b/copy destination.ts\n+const localCopyFix = true;\n",
  };

  assert.deepEqual(
    buildManifestFiles(parseNameStatus(stream), (file) => patches[file]),
    {
      "new name.ts": { sentinels: ["const localRenameFix = true;"] },
      "copy destination.ts": { sentinels: ["const localCopyFix = true;"] },
    }
  );
});

test("resolveUpstreamRef does not consume a following flag as the ref", () => {
  assert.throws(
    () => resolveUpstreamRef(["--upstream", "--update"], "upstream/stable"),
    /--upstream/
  );
});

test("parseManifest reports malformed JSON with the manifest path", () => {
  assert.throws(() => parseManifest("{", "manifest.json"), /not valid JSON.*manifest\.json/);
});
