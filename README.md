# bun-manifest-metadata-probe

Probe #22 — Tier 4 (official-docs gap), `bun-manifest-metadata-probe`.

## Pattern bundle

This probe covers four `package.json` metadata features from the §3 docs-gap audit,
all bundled into a single probe:

| §3 ID | Field | Value in this probe |
|-------|-------|---------------------|
| D6 | `engines.bun` | `">=1.1.0"` |
| D6 | `engines.node` | `">=20.0.0"` |
| D7 | `private` | `true` |
| D8 | `bundleDependencies` | `["is-odd"]` |
| D9 | `workspaces.nohoist` | `["**/react-native", "**/react-native/**"]` |

## Why bundled

All four are top-level `package.json` metadata fields with no effect on dependency edges:

- `engines.*` — runtime constraints; purely advisory at install time; not a dep block.
- `private: true` — publish guard; no effect on tree shape or detection.
- `bundleDependencies` — tar-bundling list for `npm publish`; deps still appear in the lockfile.
- `workspaces.nohoist` — parsed by Bun but ignored at install time; used here also to exercise
  the OBJECT form of `workspaces` (not the common string-array shorthand).

One probe verifies the question: "do any of these fields break the parser, suppress deps, or
generate phantom entries?" cleanly. If the tree is wrong, the diff immediately points to which
field caused it (D7 if the tree is empty; D8 if `is-odd` is missing; D6 if spurious `bun`/`node`
entries appear; D9 if the parser crashes before reaching the packages).

## Dependency graph

```
bun-manifest-metadata-probe@0.1.0
  ├── hono@4.12.18           (direct, main — no runtime deps)
  └── is-odd@3.0.1           (direct, main — bundleDependencies flag)
        └── is-number@6.0.0  (transitive — no deps)
```

Total: 2 direct + 1 transitive = 3 packages.

## Mend config

No `.whitesource` file is emitted with this probe.

Rationale: Bun is NOT in the Mend `install-tool` supported list. The `scanSettings.versioning`
block cannot pin a Bun toolchain version. Detection is lockfile-driven only — Mend reads
`bun.lock` (text JSONC format, Bun 1.1+) statically without executing any install step.
Emitting `.whitesource` would have no effect on the scanned result and would introduce
noise into the comparator baseline. This limitation is tracked in
`docs/BUN_COVERAGE_PLAN.md §4` ("Bun not in install-tool list") and is the subject of
probe #24 (`bun-not-in-install-tool-probe`).

## Metadata fields → expected `project_metadata` mapping

| `package.json` field | `project_metadata` key | Expected value | Notes |
|----------------------|----------------------|----------------|-------|
| `engines.bun` | `engines.bun` | `">=1.1.0"` | Must round-trip as-declared |
| `engines.node` | `engines.node` | `">=20.0.0"` | Must round-trip as-declared |
| `private` | `private` | `true` (boolean) | Not the string `"true"` |
| `bundleDependencies` | `bundle_dependencies` | `["is-odd"]` | Array of names |
| `workspaces.nohoist` | `workspaces_nohoist` | `["**/react-native", "**/react-native/**"]` | Parsed from object-form workspaces |

Note: `project_metadata` is a Mend output field — actual key names depend on Mend's schema.
The table above documents the expected semantic mapping; the comparator should check that
each piece of information is reachable in the scan output, not necessarily at these exact key names.

## `workspaces` object form (D9 specifics)

Standard `package.json` workspaces can be declared as either:

```json
// Array shorthand (most common):
"workspaces": ["packages/*"]

// Object form (less common — used by this probe):
"workspaces": {
  "packages": ["packages/*"],
  "nohoist": ["**/react-native", "**/react-native/**"]
}
```

This probe uses the object form to test `nohoist` parsing. The `packages/` directory
exists but contains no workspace members — the glob `"packages/*"` matches nothing, which
is valid. Bun accepts this gracefully and resolves the root manifest only.

## Failure modes

### D6 — `engines.bun` / `engines.node`

| Failure mode | Observable symptom |
|---|---|
| `engines` block treated as a dependency block | Spurious library entries `bun@>=1.1.0` and `node@>=20.0.0` appear in the tree |
| `engines` values used to gate detection | Tree is empty or scan aborted because installed Bun/Node version does not satisfy the declared constraints |
| `engines` field silently dropped | `project_metadata.engines` is missing or null in scan output |

### D7 — `private: true`

| Failure mode | Observable symptom |
|---|---|
| Parser treats `private:true` as "skip this package" | Entire tree is empty — parser short-circuits before reading deps |
| `private` flag suppresses dep reporting for the root only | Root is skipped, workspace members scanned, but root direct deps lost |
| `private` field copied to each dep's metadata | Phantom `private:true` flags on `hono` and `is-odd` in the output |

### D8 — `bundleDependencies: ["is-odd"]`

| Failure mode | Observable symptom |
|---|---|
| `bundleDependencies` treated as exclusion list | `is-odd` missing from tree; `is-number` (transitive) also missing |
| `bundleDependencies` entry duplicated into `dependencies` | `is-odd` appears twice — once from lockfile, once from `bundleDependencies` |
| `bundleDependencies` (npm spelling) vs `bundledDependencies` (alt spelling) | Parser reads only one spelling; if manifest uses the other, field is silently ignored |

### D9 — `workspaces.nohoist`

| Failure mode | Observable symptom |
|---|---|
| Parser crashes on object-form `workspaces` (expects array) | Parse error; entire tree extraction fails |
| `nohoist` causes packages to be de-hoisted in the dep tree | Packages that should appear once appear multiple times (one per workspace location) |
| `workspaces.packages` (the glob) not read from object form | Root's `packages/*` workspace glob is ignored; workspace members (if any) not discovered |
| `nohoist` field treated as a dep list | Spurious deps `react-native` appear in the tree |

## Resolver notes (UA analog)

The UA javascript resolver (npm fallback path) is the closest analog for Bun.
Key behaviors relevant to this probe:

- The UA does NOT have native Bun support. It would parse `bun.lock` only if its
  lockfile detection logic recognises the JSONC format. If not, the tree is empty.
- The UA npm resolver reads `package.json` for direct deps and uses the lockfile for
  resolved versions. The `engines`, `private`, and `bundleDependencies` fields in
  `package.json` are metadata — the UA npm resolver ignores them during dep extraction
  (correct behavior). If Mend's Bun-specific logic adds parsing for these fields,
  it must do so without interfering with the dep tree.
- `workspaces` (object form) is a Yarn-compat feature. The UA yarn resolver handles
  workspace detection; whether the Bun resolver inherits this logic or re-implements
  it is unknown. Object-form `workspaces` is the probe target.

This probe is exploratory for UA behavior — no upstream resolver file documents Bun-specific
handling of these fields. See `docs/BUN_COVERAGE_PLAN.md §9` open questions.

## Probe metadata

- Pattern: `dep-types-basic` (base — metadata fields as sibling top-level fields)
- Bundled patterns: `engines` (D6), `private-true` (D7), `bundleDependencies` (D8), `workspaces-nohoist` (D9)
- Target: `local`
- Bun version under test: `1.1.30` (text `bun.lock` format, `lockfileVersion: 1`)
- Lockfile format: `bun.lock` (JSONC, Bun 1.1+)
- Install-tool key: NOT in install-tool list — no `.whitesource` emitted
- `pm_version_tested` in `expected-tree.json`: `1.1.30`

Tracked in: `docs/BUN_COVERAGE_PLAN.md §11.4` entry #22
