## Plan: Safer plan-driven patch generation

### Goals
- Add a deterministic plan-based edit pipeline that turns token/range edits into verified unified diffs.
- Preserve existing line-based `generate_patch` for compatibility.
- Verify diffs by self-applying before emitting.

### New Types
- `FileChangePlan`: per-file list of edits
  - `replace` { find, replace, occurrence? }
  - `insertAfter` { find, insert, occurrence? }
  - `delete` { find, occurrence? }
  - `replaceRange` { start, end, replace }
- `Plan`: { changes: FileChangePlan[] }

### Core Functions
- `applyEditsToText(original, edits)`
  - Resolve token edits to concrete ranges using Nth occurrence.
  - Collect all concrete edits; reject overlaps.
  - Apply edits right-to-left by start index.

- `generateUnifiedDiffForFile(filePath, oldText, editedText)`
  - Use `diff.createTwoFilesPatch` with 3 lines of context and a/b labels.
  - Self-apply using `diff.parsePatch` + `diff.applyPatch`; if mismatch, throw.

- `planToUnifiedDiffs(plan, readFile)`
  - For each file: read, apply edits, produce verified diff.

### AST Plan Builder (future)
- Use ts-morph to convert intents (rename symbol, insert import) into `replaceRange` edits with exact byte ranges.
- Deconflict overlapping edits before emission.

### Tests (vitest)
- Round-trip diff apply equals edited text.
- Overlapping edits rejected.
- Occurrence targeting (1st, 2nd, nth).
- Mixed token + range edits.
- Multi-edit right-to-left order correctness.

### Integration
- Export new APIs from `src/tools/index.ts`.
- Keep `write_patch` unchanged (already supports unified diffs).


