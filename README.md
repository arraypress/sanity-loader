# @arraypress/sanity-loader

> Astro Content Layer loader for Sanity. Plug a GROQ query into
> `defineCollection({ loader: sanityLoader({ type: 'product' }) })`
> and treat your Sanity dataset like any other Astro content source.

`getCollection()`, `getEntry()`, dynamic routes, RSS, sitemap, OG
images — everything that already works against `glob()` keeps
working unchanged.

## Install

```bash
npm install --save-dev @arraypress/sanity-loader @sanity/client
```

`@sanity/client` is a peer dep — install it alongside.

## Configure

Either set env vars (most common):

```bash
# .env
SANITY_PROJECT_ID=abcd1234
SANITY_DATASET=production
```

Or pass overrides at the call site (multi-project monorepos):

```ts
sanityLoader({
  type: 'product',
  projectId: 'abcd1234',
  dataset: 'production',
  apiVersion: '2024-10-01',
  useCdn: true,
  token: process.env.SANITY_READ_TOKEN, // for private datasets
});
```

## Use

```ts
// src/content.config.ts
import { defineCollection, z } from 'astro:content';
import { sanityLoader } from '@arraypress/sanity-loader';

const products = defineCollection({
  loader: sanityLoader({ type: 'product' }),
  schema: z.object({
    title: z.string(),
    price: z.number(),
    summary: z.string().optional(),
  }),
});

export const collections = { products };
```

Then anywhere in your Astro pages:

```astro
---
import { getCollection } from 'astro:content';
const products = await getCollection('products');
---
{products.map((p) => <ProductCard data={p.data} />)}
```

## Options

| Option       | Default                                | Description                                                                 |
|--------------|----------------------------------------|-----------------------------------------------------------------------------|
| `type`       | **required**                           | Sanity document `_type`.                                                    |
| `projectId`  | `process.env.SANITY_PROJECT_ID`        | Sanity project id.                                                          |
| `dataset`    | `process.env.SANITY_DATASET` ↦ `'production'` | Dataset name.                                                       |
| `apiVersion` | `'2024-10-01'`                         | API date pin.                                                               |
| `useCdn`     | `true`                                 | Read through Sanity's CDN.                                                  |
| `token`      | —                                      | Auth token for private datasets / drafts.                                   |
| `client`     | —                                      | Pre-built `SanityClient` (bypasses the internal factory).                   |
| `query`      | `*[_type == $type && !(_id in path('drafts.**'))]` | GROQ override — reference expansion, partial projection. |
| `map`        | identity                               | Per-doc transform applied before the Zod schema runs.                       |
| `idField`    | `'slug.current'`                       | Dotted path to the entry id. Falls back to `_id`.                           |

## Tips

### Flatten Sanity references with `map`

Sanity stores references as `{ _ref, _type: 'reference' }`. Astro
schemas usually want flat values — use `map` to resolve them:

```ts
sanityLoader({
  type: 'product',
  query: `*[_type == $type && !(_id in path('drafts.**'))]{
    ...,
    "artist": artist->name,
    "category": category->slug.current
  }`,
});
```

### Multi-project monorepos

The internal client cache is keyed on `projectId+dataset`, so
multiple `sanityLoader()` calls pointing at different projects each
get their own connection:

```ts
const storefront = defineCollection({
  loader: sanityLoader({ type: 'product', projectId: 'aaaa1111' }),
});
const blog = defineCollection({
  loader: sanityLoader({ type: 'post', projectId: 'bbbb2222' }),
});
```

### Test stubs via `client`

Pass a pre-built client (or stub) when you want to drive the loader
from a test without env vars or a network:

```ts
import { sanityLoader } from '@arraypress/sanity-loader';

const stub = { fetch: async () => [{ _id: 'a', slug: { current: 'a' }, title: 'A' }] };
const loader = sanityLoader({ type: 'product', client: stub });
```

## Portable Text bodies

Long-form fields in Sanity are stored as Portable Text — an array
of blocks, not Markdown. The loader writes an empty `body` field on
each entry; render the Portable Text from the schema-typed field
using [`@portabletext/to-html`](https://www.npmjs.com/package/@portabletext/to-html):

```ts
import { toHTML } from '@portabletext/to-html';

const html = toHTML(entry.data.bodyBlocks);
```

## License

MIT
