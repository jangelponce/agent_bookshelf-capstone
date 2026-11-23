import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import request from 'supertest';
import app from '../../src/server.js';
import { initDb, closeDb } from '../../src/db/index.js';

const DB_PATH = '/tmp/test-search-routes.db';

beforeEach(async () => {
  await initDb(DB_PATH);
});

afterEach(() => {
  closeDb();
  try {
    fs.unlinkSync(DB_PATH);
  } catch (e) {
    // ignore
  }
});

const LENGTH_ERROR = { error: 'Search query must be 100 characters or fewer' };
const SINGLE_ERROR = { error: 'Search query must be a single string' };
const titles = (body: { title: string }[]) => body.map((b) => b.title);
const cardCount = (html: string) => (html.match(/class="book-card"/g) || []).length;

describe('JSON API search', () => {
  describe.each(['/api/books', '/api/books/search'])('GET %s', (path) => {
    it(`AC1: ${path}?q=dune finds Dune by title`, async () => {
      const res = await request(app).get(path).query({ q: 'dune' });
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(titles(res.body)).toEqual(['Dune']);
    });

    it(`AC1: ${path} matches author and is case-insensitive`, async () => {
      const upper = await request(app).get(path).query({ q: 'HERBERT' });
      expect(upper.status).toBe(200);
      expect(titles(upper.body)).toEqual(['Dune']);
    });

    it(`AC1: ${path} returns [] when nothing matches`, async () => {
      const res = await request(app).get(path).query({ q: 'zzzz-no-such-book' });
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it(`AC2: ${path} with empty q returns all books in /api/books order`, async () => {
      const all = await request(app).get('/api/books');
      const res = await request(app).get(path).query({ q: '' });
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(50);
      expect(res.body).toEqual(all.body);
    });

    it(`AC2: ${path} with whitespace-only q returns all books`, async () => {
      const res = await request(app).get(path).query({ q: '   ' });
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(50);
    });

    it(`AC3: ${path} trims q`, async () => {
      const res = await request(app).get(path).query({ q: '  dune  ' });
      expect(res.status).toBe(200);
      expect(titles(res.body)).toEqual(['Dune']);
    });

    it(`AC4: ${path} allows exactly 100 characters`, async () => {
      const res = await request(app).get(path).query({ q: 'a'.repeat(100) });
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it(`AC4: ${path} rejects 101 characters with 400 and the error JSON`, async () => {
      const res = await request(app).get(path).query({ q: 'a'.repeat(101) });
      expect(res.status).toBe(400);
      expect(res.body).toEqual(LENGTH_ERROR);
    });

    it(`AC4: ${path} measures length after trim`, async () => {
      const ok = await request(app).get(path).query({ q: `  ${'a'.repeat(100)}  ` });
      expect(ok.status).toBe(200);
      const bad = await request(app).get(path).query({ q: `  ${'a'.repeat(101)}  ` });
      expect(bad.status).toBe(400);
      expect(bad.body).toEqual(LENGTH_ERROR);
    });

    it(`${path} rejects repeated q with 400 and the error JSON`, async () => {
      const res = await request(app).get(`${path}?q=a&q=b`);
      expect(res.status).toBe(400);
      expect(res.body).toEqual(SINGLE_ERROR);
    });

    it(`AC5: ${path} treats % and _ as literals`, async () => {
      const pct = await request(app).get(path).query({ q: '%' });
      expect(pct.status).toBe(200);
      expect(pct.body).toEqual([]);
      const us = await request(app).get(path).query({ q: '_' });
      expect(us.status).toBe(200);
      expect(us.body).toEqual([]);
    });

    it(`AC5: ${path} handles SQL injection text safely`, async () => {
      const res = await request(app).get(path).query({ q: "' OR 1=1 --" });
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });
  });

  it('GET /api/books without q is unchanged (all 50 books)', async () => {
    const res = await request(app).get('/api/books');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(50);
  });

  it('/api/books/search is not caught by /api/books/:id', async () => {
    const res = await request(app).get('/api/books/search').query({ q: 'dune' });
    expect(res.status).not.toBe(404);
    expect(res.status).toBe(200);
  });

  it('GET /api/books/:id still works for numeric ids', async () => {
    const res = await request(app).get('/api/books/16');
    expect(res.status).toBe(200);
    expect(res.body.title).toBe('Dune');
  });
});

describe('HTMX search fragment: GET /books/search', () => {
  it('AC1: returns a book-grid with the matching book-card', async () => {
    const res = await request(app).get('/books/search').query({ q: 'dune' });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/html/);
    expect(res.text).toContain('class="book-grid"');
    expect(cardCount(res.text)).toBe(1);
    expect(res.text).toContain('Dune');
    expect(res.text).toContain('Frank Herbert');
    expect(res.text).not.toContain('Neuromancer');
  });

  it('AC1: matches by author case-insensitively', async () => {
    const res = await request(app).get('/books/search').query({ q: 'TOLKIEN' });
    expect(res.status).toBe(200);
    expect(cardCount(res.text)).toBe(2);
    expect(res.text).toContain('The Hobbit');
  });

  it('returns the no-results message when nothing matches', async () => {
    const res = await request(app).get('/books/search').query({ q: 'zzzz-no-such-book' });
    expect(res.status).toBe(200);
    expect(res.text).toContain('<p class="search-message">No books found.</p>');
    expect(cardCount(res.text)).toBe(0);
  });

  it('AC2: empty q returns all 50 books', async () => {
    const res = await request(app).get('/books/search').query({ q: '' });
    expect(res.status).toBe(200);
    expect(cardCount(res.text)).toBe(50);
  });

  it('AC2: missing q returns all 50 books', async () => {
    const res = await request(app).get('/books/search');
    expect(res.status).toBe(200);
    expect(cardCount(res.text)).toBe(50);
  });

  it('AC3: trims q', async () => {
    const res = await request(app).get('/books/search').query({ q: '  dune  ' });
    expect(res.status).toBe(200);
    expect(cardCount(res.text)).toBe(1);
    expect(res.text).toContain('Dune');
  });

  it('AC4: allows exactly 100 characters', async () => {
    const res = await request(app).get('/books/search').query({ q: 'a'.repeat(100) });
    expect(res.status).toBe(200);
    expect(res.text).toContain('No books found.');
  });

  it('AC4: rejects 101 characters with 400 and an error message', async () => {
    const res = await request(app).get('/books/search').query({ q: 'a'.repeat(101) });
    expect(res.status).toBe(400);
    expect(res.text).toContain('<p class="search-message error">');
    expect(cardCount(res.text)).toBe(0);
  });

  it('AC5: % matches only a literal percent sign', async () => {
    const res = await request(app).get('/books/search').query({ q: '%' });
    expect(res.status).toBe(200);
    expect(res.text).toContain('No books found.');
  });

  it('escapes <script> in titles and authors', async () => {
    const created = await request(app)
      .post('/api/books')
      .send({
        title: '<script>alert(1)</script>',
        author: '<b>Evil</b> & Co',
        isbn: null,
        cover_url: null,
        description: null,
        published_year: null,
      });
    expect(created.status).toBe(201);

    const res = await request(app).get('/books/search').query({ q: 'alert' });
    expect(res.status).toBe(200);
    expect(res.text).not.toContain('<script>alert(1)</script>');
    expect(res.text).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(res.text).not.toContain('<b>Evil</b>');
    expect(res.text).toContain('&lt;b&gt;Evil&lt;/b&gt; &amp; Co');
  });
});
