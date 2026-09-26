import assert from "node:assert/strict";
import test from "node:test";

import { parseNameStatus } from "../../scripts/check/check-upstream-drift.mjs";

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
