# Interview notes

A running list of questions this project has equipped you to answer, added to at the end of
each milestone while the reasoning is still fresh.

The answers here are prompts, not scripts. If you cannot expand one into a two-minute
explanation in your own words, that is the signal to go back and re-read the code.

---

## M0 — Repository foundation

**Why a monorepo instead of two repositories?**
Because the cube engine, the averaging rules and the request schemas are needed by both the
client and the server. Two repositories means either duplicating that logic or publishing a
package for a project with one developer. The concrete risk being avoided is divergence: two
implementations of the ao5 DNF rules would eventually disagree, and a statistics product that
reports different numbers in two places is worthless. See ADR-0002.

**Why is the shared package consumed as TypeScript source rather than compiled output?**
Pointing `exports` at `src/index.ts` removes the build step from the dependency graph. Editing
a shared file is immediately visible to both apps with no watcher, and the stale-`dist` class
of bug cannot occur. The cost is that consumers must be able to compile TypeScript found in
`node_modules`, and the package could not be published externally without adding a real build.

**Why is TypeScript pinned to 6.0.3 when 7.0.2 exists?**
TypeScript 7 is the native compiler rewrite, and `typescript-eslint` only supports `<6.1.0`.
The compiler was not the binding constraint — the tooling ecosystem around it was. The general
point: "latest" and "best" are different questions, and on a real team the answer is usually
whatever the whole toolchain agrees on.

**What does `noUncheckedIndexedAccess` actually do, and why turn it on?**
It makes `array[i]` produce `T | undefined` instead of `T`, forcing an explicit check. Without
it, TypeScript will confidently tell you an out-of-bounds access is a valid value — one of the
few places the type system lies by default. It is occasionally irritating and it will matter in
the cube engine, where fixed-size arrays are indexed constantly.

**Why must `eslint-config-prettier` be last in the ESLint config array?**
Flat config applies objects in order, later entries overriding earlier ones. That config does
nothing but switch rules _off_ — every stylistic rule Prettier already controls. If it is not
last, ESLint and Prettier fight over the same formatting and you get unfixable errors.

**Why `pnpm install --frozen-lockfile` in CI but not locally?**
It fails the build if `pnpm-lock.yaml` and `package.json` disagree, rather than quietly
resolving new versions. That guarantees CI tests the exact dependency tree you tested locally.
Locally you want the opposite, because adding a dependency is supposed to update the lockfile.

**Why does `.gitattributes` force `eol=lf`?**
Git on Windows converts line endings on checkout by default. Without normalisation, a file
saved on Windows and committed shows up as 100% modified to everyone else, which makes diffs
and code review useless. Native Windows scripts (`.bat`, `.cmd`, `.ps1`) are excepted because
they require CRLF to run.

**Why are the CI gates separate steps instead of one `pnpm run check`?**
GitHub shows step names in the UI, so a failure is identifiable without opening logs. The
ordering is also deliberate — formatting and linting are seconds, tests are minutes, so the
cheap checks fail fast.
