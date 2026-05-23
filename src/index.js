/**
 * @arraypress/sanity-loader
 *
 * Astro Content Layer loader for Sanity. Plug a GROQ query into
 * `defineCollection({ loader: sanityLoader({ type: 'product' }) })`
 * and treat the Sanity dataset like any other Astro content source —
 * `getCollection()`, `getEntry()`, dynamic routes, the lot.
 *
 * The loader runs at build time, fires one GROQ query per
 * collection, and writes each document into Astro's content store
 * keyed by the Sanity document's slug (falling back to `_id`).
 *
 * ## Quick start
 *
 * ```ts
 * // src/content.config.ts
 * import { defineCollection, z } from 'astro:content';
 * import { sanityLoader } from '@arraypress/sanity-loader';
 *
 * const products = defineCollection({
 *   loader: sanityLoader({ type: 'product' }),
 *   schema: z.object({
 *     title: z.string(),
 *     price: z.number(),
 *   }),
 * });
 * ```
 *
 * ## Configuration
 *
 * Reads `SANITY_PROJECT_ID` + `SANITY_DATASET` from `process.env` by
 * default. Override either at the loader call site:
 *
 * ```ts
 * sanityLoader({
 *   type: 'post',
 *   projectId: 'xyz12345',
 *   dataset: 'production',
 *   apiVersion: '2024-10-01',
 *   useCdn: true,
 *   token: process.env.SANITY_READ_TOKEN, // for private datasets
 * });
 * ```
 *
 * ## Customisation hooks
 *
 *   - `query` — full GROQ override (reference expansion, partial
 *     projection, exclude-drafts variants).
 *   - `map`   — per-doc transform applied before the schema runs
 *     (flatten nested references, coerce types).
 *   - `idField` — dotted path to the entry id. Default: `slug.current`.
 *
 * @module @arraypress/sanity-loader
 */

/**
 * @typedef {Object} SanityLoaderOptions
 * @property {string} type - Sanity document `_type` to query.
 * @property {string} [projectId] - Sanity project id. Default: `process.env.SANITY_PROJECT_ID`.
 * @property {string} [dataset] - Sanity dataset. Default: `process.env.SANITY_DATASET` or `'production'`.
 * @property {string} [apiVersion] - API date pin. Default: `'2024-10-01'`.
 * @property {boolean} [useCdn] - Use Sanity's CDN. Default: `true`.
 * @property {string} [token] - Auth token for private datasets / drafts.
 * @property {import('@sanity/client').SanityClient} [client] - Pre-built Sanity client. Bypasses the projectId/dataset path entirely — useful when you've configured a client with extra headers, a custom perspective, or a test stub.
 * @property {string} [query] - Full GROQ override. Default: every non-draft doc of `type`.
 * @property {(doc: Record<string, unknown>) => Record<string, unknown>} [map] - Per-doc transform before the schema runs.
 * @property {string} [idField] - Dotted path to the entry id. Default: `'slug.current'`.
 */

/**
 * Memoise the Sanity client across loader calls in a single build —
 * the typical theme has 3+ collections sharing one connection.
 * Keyed on projectId+dataset so multi-project monorepos still work.
 *
 * @type {Map<string, import('@sanity/client').SanityClient>}
 */
const clientCache = new Map();

async function getClient(opts) {
  const projectId = opts.projectId ?? process.env.SANITY_PROJECT_ID;
  const dataset = opts.dataset ?? process.env.SANITY_DATASET ?? 'production';

  if (!projectId) {
    throw new Error(
      '[@arraypress/sanity-loader] No projectId — set SANITY_PROJECT_ID in your env ' +
        'or pass `projectId` to sanityLoader().',
    );
  }

  const cacheKey = `${projectId}/${dataset}`;
  const cached = clientCache.get(cacheKey);
  if (cached) return cached;

  /* Lazy-import the peer dep so the package is importable (for
   * type definitions etc.) without forcing `@sanity/client` into
   * every consumer's tree. The error path here surfaces the real
   * cause when the peer is genuinely missing. */
  let createClient;
  try {
    ({ createClient } = await import('@sanity/client'));
  } catch (err) {
    throw new Error(
      '[@arraypress/sanity-loader] Could not load `@sanity/client`. Install it as a ' +
        'dependency (`npm install @sanity/client`) or pass `opts.client` directly.',
      { cause: err },
    );
  }

  const client = createClient({
    projectId,
    dataset,
    apiVersion: opts.apiVersion ?? '2024-10-01',
    useCdn: opts.useCdn ?? true,
    ...(opts.token ? { token: opts.token } : {}),
  });
  clientCache.set(cacheKey, client);
  return client;
}

/**
 * Read a dotted-path value from an object. Returns `undefined` when
 * any segment along the path is missing.
 *
 * @param {Record<string, unknown>} obj
 * @param {string} path
 */
function readPath(obj, path) {
  return path
    .split('.')
    .reduce(
      (acc, key) => (acc && typeof acc === 'object' ? acc[key] : undefined),
      obj,
    );
}

/**
 * Build an Astro Content Layer loader bound to a Sanity document
 * type. Plugs into `defineCollection({ loader: ... })` exactly
 * like Astro's built-in `glob()` loader.
 *
 * @param {SanityLoaderOptions} opts
 * @returns {import('astro/loaders').Loader}
 */
export function sanityLoader(opts) {
  if (!opts || typeof opts !== 'object') {
    throw new TypeError('[@arraypress/sanity-loader] options object is required');
  }
  if (!opts.type || typeof opts.type !== 'string') {
    throw new TypeError('[@arraypress/sanity-loader] `type` is required');
  }

  const {
    type,
    query,
    map,
    idField = 'slug.current',
  } = opts;

  return {
    name: `sanity-loader:${type}`,
    async load(context) {
      const client = opts.client ?? (await getClient(opts));

      /* Default query — every non-draft doc of the given type with
       * all fields projected. Buyers who need reference expansion
       * or partial projection override via `opts.query`. */
      const groq = query ?? `*[_type == $type && !(_id in path('drafts.**'))]`;
      const docs = await client.fetch(groq, { type });

      context.store.clear();

      for (const doc of docs) {
        /* Pick the entry id: slug first, then _id. The slug becomes
         * the URL segment in dynamic routes so this matches what
         * Astro's glob() loader does with filenames. */
        const slug = readPath(doc, idField);
        const id = typeof slug === 'string' ? slug : doc._id;
        if (!id) {
          context.logger.warn(
            `[${context.collection}] Skipping doc — no id at "${idField}" or "_id".`,
          );
          continue;
        }

        const data = map ? map(doc) : doc;
        context.store.set({
          id,
          data,
          /* Markdown bodies become `body` in the Astro entry.
           * Sanity stores long-form as Portable Text — leave empty
           * here and let the schema's body field carry the array.
           * Render with @portabletext/to-html in the consuming
           * component. */
          body: '',
        });
      }

      const word = docs.length === 1 ? 'document' : 'documents';
      context.logger.info(
        `[${context.collection}] Loaded ${docs.length} ${word} from Sanity (type: ${type})`,
      );
    },
  };
}

/**
 * Clear the internal client cache. Mostly useful for tests so each
 * `sanityLoader()` call gets a fresh client. Not needed at runtime.
 */
export function _resetClientCache() {
  clientCache.clear();
}
