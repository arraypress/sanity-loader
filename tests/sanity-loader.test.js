import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { sanityLoader, _resetClientCache } from '../src/index.js';

/* ── Test fixtures ────────────────────────── */

/** Build a fake Sanity client with `.fetch()` stub. */
function fakeClient(docs, { onFetch } = {}) {
  return {
    async fetch(query, params) {
      if (onFetch) onFetch(query, params);
      return docs;
    },
  };
}

/** Build a fake LoaderContext that records every `store.set()` and
 *  `logger.*` call so tests can assert on them. */
function fakeContext(collection = 'products') {
  const writes = [];
  const logs = { info: [], warn: [], error: [] };
  return {
    collection,
    store: {
      clear() { writes.length = 0; },
      set(entry) { writes.push(entry); },
    },
    logger: {
      info: (msg) => logs.info.push(msg),
      warn: (msg) => logs.warn.push(msg),
      error: (msg) => logs.error.push(msg),
    },
    writes,
    logs,
  };
}

const SAMPLE_DOCS = [
  { _id: 'a1', _type: 'product', title: 'Pack One', slug: { current: 'pack-one' }, price: 49 },
  { _id: 'a2', _type: 'product', title: 'Pack Two', slug: { current: 'pack-two' }, price: 99 },
  { _id: 'a3', _type: 'product', title: 'Drafts only', /* no slug */ },
];

/* ── Input validation ─────────────────────── */

describe('sanityLoader — input validation', () => {
  it('throws when options is missing', () => {
    assert.throws(() => sanityLoader(), /options object is required/);
  });

  it('throws when `type` is missing', () => {
    assert.throws(() => sanityLoader({ client: fakeClient([]) }), /`type` is required/);
  });

  it('throws on first `load()` when no projectId + no client', async () => {
    _resetClientCache();
    const prevId = process.env.SANITY_PROJECT_ID;
    const prevDs = process.env.SANITY_DATASET;
    delete process.env.SANITY_PROJECT_ID;
    delete process.env.SANITY_DATASET;
    try {
      const loader = sanityLoader({ type: 'product' });
      const ctx = fakeContext();
      await assert.rejects(() => loader.load(ctx), /No projectId/);
    } finally {
      if (prevId) process.env.SANITY_PROJECT_ID = prevId;
      if (prevDs) process.env.SANITY_DATASET = prevDs;
    }
  });
});

/* ── Loader shape ─────────────────────────── */

describe('sanityLoader — loader contract', () => {
  it('returns a Loader with the expected name', () => {
    const loader = sanityLoader({ type: 'product', client: fakeClient([]) });
    assert.equal(loader.name, 'sanity-loader:product');
    assert.equal(typeof loader.load, 'function');
  });

  it('clears the store before writing new docs', async () => {
    const loader = sanityLoader({ type: 'product', client: fakeClient(SAMPLE_DOCS.slice(0, 2)) });
    const ctx = fakeContext();
    /* Pre-populate the store with a stale entry so clear() shows up. */
    ctx.store.set({ id: 'stale', data: { stale: true }, body: '' });
    await loader.load(ctx);
    assert.ok(!ctx.writes.some((e) => e.id === 'stale'));
    assert.equal(ctx.writes.length, 2);
  });
});

/* ── Document loading ─────────────────────── */

describe('sanityLoader — document loading', () => {
  it('writes each doc with slug.current as id by default', async () => {
    const loader = sanityLoader({
      type: 'product',
      client: fakeClient(SAMPLE_DOCS.slice(0, 2)),
    });
    const ctx = fakeContext();
    await loader.load(ctx);
    assert.deepEqual(ctx.writes.map((w) => w.id), ['pack-one', 'pack-two']);
  });

  it('falls back to _id when idField is missing', async () => {
    const loader = sanityLoader({
      type: 'product',
      client: fakeClient([{ _id: 'fallback-1', title: 'No slug' }]),
    });
    const ctx = fakeContext();
    await loader.load(ctx);
    assert.equal(ctx.writes[0].id, 'fallback-1');
  });

  it('warns + skips when neither slug nor _id is present', async () => {
    const loader = sanityLoader({
      type: 'product',
      client: fakeClient([{ title: 'Orphan doc with no id at all' }]),
    });
    const ctx = fakeContext();
    await loader.load(ctx);
    assert.equal(ctx.writes.length, 0);
    assert.match(ctx.logs.warn[0], /Skipping doc/);
  });

  it('logs the load count with proper pluralisation', async () => {
    const loader1 = sanityLoader({ type: 'post', client: fakeClient([SAMPLE_DOCS[0]]) });
    const ctx1 = fakeContext('posts');
    await loader1.load(ctx1);
    assert.match(ctx1.logs.info[0], /Loaded 1 document from Sanity/);

    const loader2 = sanityLoader({ type: 'post', client: fakeClient(SAMPLE_DOCS.slice(0, 2)) });
    const ctx2 = fakeContext('posts');
    await loader2.load(ctx2);
    assert.match(ctx2.logs.info[0], /Loaded 2 documents from Sanity/);
  });

  it('writes empty body so portable-text lives in schema-defined fields', async () => {
    const loader = sanityLoader({ type: 'product', client: fakeClient([SAMPLE_DOCS[0]]) });
    const ctx = fakeContext();
    await loader.load(ctx);
    assert.equal(ctx.writes[0].body, '');
  });
});

/* ── Query + transforms ───────────────────── */

describe('sanityLoader — query + transforms', () => {
  it('uses the default GROQ when none provided', async () => {
    let calledQuery = null;
    const loader = sanityLoader({
      type: 'product',
      client: fakeClient([], {
        onFetch: (q) => { calledQuery = q; },
      }),
    });
    await loader.load(fakeContext());
    assert.match(calledQuery, /_type == \$type/);
    assert.match(calledQuery, /drafts\.\*\*/);
  });

  it('passes the type as the bound parameter', async () => {
    let calledParams = null;
    const loader = sanityLoader({
      type: 'video',
      client: fakeClient([], {
        onFetch: (_q, p) => { calledParams = p; },
      }),
    });
    await loader.load(fakeContext());
    assert.deepEqual(calledParams, { type: 'video' });
  });

  it('honours a custom query', async () => {
    let calledQuery = null;
    const loader = sanityLoader({
      type: 'product',
      query: '*[_type == $type && featured]',
      client: fakeClient([], {
        onFetch: (q) => { calledQuery = q; },
      }),
    });
    await loader.load(fakeContext());
    assert.equal(calledQuery, '*[_type == $type && featured]');
  });

  it('applies the `map` transform per doc', async () => {
    const loader = sanityLoader({
      type: 'product',
      client: fakeClient([{ _id: 'x', slug: { current: 'x' }, title: 'hello', extra: true }]),
      map: (doc) => ({ title: doc.title.toUpperCase(), customField: 'added' }),
    });
    const ctx = fakeContext();
    await loader.load(ctx);
    assert.deepEqual(ctx.writes[0].data, { title: 'HELLO', customField: 'added' });
  });

  it('uses a custom idField path', async () => {
    const loader = sanityLoader({
      type: 'product',
      idField: 'seo.path',
      client: fakeClient([{ _id: 'a', seo: { path: 'custom-route' }, title: 'X' }]),
    });
    const ctx = fakeContext();
    await loader.load(ctx);
    assert.equal(ctx.writes[0].id, 'custom-route');
  });
});

/* ── Client injection ─────────────────────── */

describe('sanityLoader — client injection', () => {
  it('uses opts.client when provided — no env vars needed', async () => {
    /* Wipe env to confirm we never read it when `client` is set. */
    const prev = process.env.SANITY_PROJECT_ID;
    delete process.env.SANITY_PROJECT_ID;
    try {
      const loader = sanityLoader({
        type: 'product',
        client: fakeClient([SAMPLE_DOCS[0]]),
      });
      const ctx = fakeContext();
      await loader.load(ctx);
      assert.equal(ctx.writes.length, 1);
    } finally {
      if (prev) process.env.SANITY_PROJECT_ID = prev;
    }
  });
});
