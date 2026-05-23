/**
 * @arraypress/sanity-loader — TypeScript definitions.
 */
import type { Loader } from 'astro/loaders';
import type { SanityClient } from '@sanity/client';

export interface SanityLoaderOptions {
  /** Sanity document `_type` to query. */
  type: string;
  /** Sanity project id. Default: `process.env.SANITY_PROJECT_ID`. */
  projectId?: string;
  /** Sanity dataset. Default: `process.env.SANITY_DATASET` or `'production'`. */
  dataset?: string;
  /** API date pin. Default: `'2024-10-01'`. */
  apiVersion?: string;
  /** Use Sanity's CDN. Default: `true`. */
  useCdn?: boolean;
  /** Auth token for private datasets / drafts. */
  token?: string;
  /**
   * Pre-built Sanity client. Bypasses the projectId/dataset path
   * entirely — useful when you've configured a client with extra
   * headers, a custom perspective, or a test stub.
   */
  client?: SanityClient;
  /**
   * Full GROQ override. Default:
   *   `*[_type == $type && !(_id in path('drafts.**'))]`
   * Override when you need reference expansion, partial projection,
   * or a different draft-filtering strategy. Receives `{ type }`
   * as the bound parameter.
   */
  query?: string;
  /**
   * Per-doc transform applied before the schema runs. Useful for
   * flattening Sanity's nested reference shapes
   * (`artist: { _ref }` → `artist: 'Sunny Lax'`).
   */
  map?: (doc: Record<string, unknown>) => Record<string, unknown>;
  /**
   * Dotted path to the entry id. Default: `'slug.current'`. The
   * resolved string becomes the URL segment in
   * `/route/[slug].astro`. Falls back to `_id` when the path
   * doesn't resolve.
   */
  idField?: string;
}

/**
 * Build an Astro Content Layer loader bound to a Sanity document
 * type. Plugs into `defineCollection({ loader: ... })`.
 */
export function sanityLoader(opts: SanityLoaderOptions): Loader;

/** @internal — used by tests to flush the cached client. */
export function _resetClientCache(): void;
