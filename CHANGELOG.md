# Changelog

All notable changes to this project will be documented in this file.

## [1.0.0] — Unreleased

### Initial Release

- `sanityLoader({ type, projectId?, dataset?, apiVersion?, useCdn?,
  token?, client?, query?, map?, idField? })` — Astro Content
  Layer loader for Sanity. Plugs into
  `defineCollection({ loader: ... })` exactly like Astro's built-in
  `glob()` loader.
- Reads `SANITY_PROJECT_ID` + `SANITY_DATASET` from `process.env`
  by default. Pass overrides per-call for multi-project monorepos.
- `client` option accepts a pre-built `SanityClient` — bypass the
  internal client factory entirely when you need custom headers,
  perspectives, or test stubs.
- `query` GROQ override for reference expansion / partial projection.
- `map` per-doc transform (runs before the Zod schema fires).
- `idField` dotted-path id selector (default `'slug.current'`, falls
  back to `_id`).
- Client is memoised across loader calls within a build (keyed on
  projectId+dataset) so the 3 typical collections (products, posts,
  news) share one connection.
- Lazy-imports `@sanity/client` so the package can be imported for
  type help without forcing the peer into every consumer's tree.

16 tests passing under Node's built-in test runner. Zero runtime
dependencies (Sanity's SDK is a peer).
