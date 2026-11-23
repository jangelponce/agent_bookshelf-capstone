import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import request from 'supertest';
import app from '../../src/server.js';
import { initDb, closeDb } from '../../src/db/index.js';
import * as Book from '../../src/models/book.js';

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

const titles = (body: { title: string }[]) => body.map((b) => b.title);
const cardCount = (html: string) => (html.match(/class="book-card"/g) ?? []).length;
const TOO_LONG = { error: 'Search query must be 100 characters or fewer' };
const REPEATED = { error: 'Search query must be a single string' };

describe('GET /api/books?q=', () => {
  it('AC1: finds Dune by title', async () => {
    const res = await request(app).get('/api/books?q=dune');
    expect(res.status).toBe(200);
    expect(titles(res.body)).toEqual(['Dune']);
  });

  it('AC1: matches the author with an exact result', async () => {
    const res = await request(app).get('/api/books?q=Herbert');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(titles(res.body)).toEqual(['Dune']);
    expect(res.body[0].author).toBe('Frank Herbert');
  });

  it('AC1: author match returns all books by that author ordered by title', async () => {
    const res = await request(app).get('/api/books?q=andy%20weir');
    expect(titles(res.body)).toEqual(['Project Hail Mary', 'The Martian']);
  });

  it('AC1: is case-insensitive', async () => {
    const res = await request(app).get('/api/books?q=DUNE');
    expect(titles(res.body)).toEqual(['Dune']);
  });

  it('AC1: no match returns 200 and []', async () => {
    const res = await request(app).get('/api/books?q=zzzz-no-such-book');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('AC2: empty query returns all books in the same order as GET /api/books', async () => {
    const res = await request(app).get('/api/books?q=');
    const base = await request(app).get('/api/books');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(50);
    expect(res.body).toEqual(base.body);
  });

  it('AC2: no q returns all 50 books', async () => {
    const res = await request(app).get('/api/books');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(50);
  });

  it('AC2: whitespace-only query returns all books', async () => {
    const res = await request(app).get('/api/books?q=%20%20%20');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(50);
  });

  it('AC3: trims the query', async () => {
    const res = await request(app).get('/api/books?q=%20%20dune%20%20');
    expect(titles(res.body)).toEqual(['Dune']);
  });

  it('AC4: accepts a 100-character query', async () => {
    const res = await request(app).get(`/api/books?q=${'a'.repeat(100)}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('AC4: rejects a 101-character query with 400', async () => {
    const res = await request(app).get(`/api/books?q=${'a'.repeat(101)}`);
    expect(res.status).toBe(400);
    expect(res.body).toEqual(TOO_LONG);
  });

  it('AC4: rejects a 150-character query with 400', async () => {
    const res = await request(app).get(`/api/books?q=${'a'.repeat(150)}`);
    expect(res.status).toBe(400);
    expect(res.body).toEqual(TOO_LONG);
  });

  it('AC4: length is measured after trim', async () => {
    const ok = await request(app).get(`/api/books?q=%20${'a'.repeat(100)}%20`);
    expect(ok.status).toBe(200);
    const bad = await request(app).get(`/api/books?q=%20${'a'.repeat(101)}%20`);
    expect(bad.status).toBe(400);
  });

  it('AC5: a single quote does not cause a 500', async () => {
    const res = await request(app).get(`/api/books?q=${encodeURIComponent("Ender's")}`);
    expect(res.status).toBe(200);
    expect(titles(res.body)).toEqual(["Ender's Game"]);
  });

  it('AC5: an injection payload returns []', async () => {
    const res = await request(app).get(`/api/books?q=${encodeURIComponent("x' OR '1'='1")}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('AC5: % is literal', async () => {
    const res = await request(app).get('/api/books?q=%25');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('AC5: _ is literal (also against the author)', async () => {
    const a = await request(app).get('/api/books?q=D_ne');
    expect(a.body).toEqual([]);
    const b = await request(app).get('/api/books?q=Frank_Herbert');
    expect(b.body).toEqual([]);
  });

  it('repeated q returns 400 with the single-string error', async () => {
    const res = await request(app).get('/api/books?q=a&q=b');
    expect(res.status).toBe(400);
    expect(res.body).toEqual(REPEATED);
  });
});

describe('GET /api/books/search (alias)', () => {
  it('AC1: is not caught by /api/books/:id and returns matches', async () => {
    const res = await request(app).get('/api/books/search?q=dune');
    expect(res.status).toBe(200);
    expect(titles(res.body)).toEqual(['Dune']);
  });

  it('AC1: returns the same body as /api/books?q=', async () => {
    const alias = await request(app).get('/api/books/search?q=herbert');
    const base = await request(app).get('/api/books?q=herbert');
    expect(alias.body).toEqual(base.body);
  });

  it('AC2: no q returns all 50 books', async () => {
    const res = await request(app).get('/api/books/search');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(50);
  });

  it('AC4: rejects a 101-character query with 400', async () => {
    const res = await request(app).get(`/api/books/search?q=${'a'.repeat(101)}`);
    expect(res.status).toBe(400);
    expect(res.body).toEqual(TOO_LONG);
  });

  it('repeated q returns 400 with the single-string error', async () => {
    const res = await request(app).get('/api/books/search?q=a&q=b');
    expect(res.status).toBe(400);
    expect(res.body).toEqual(REPEATED);
  });

  it('GET /api/books/1 still returns the book by id', async () => {
    const res = await request(app).get('/api/books/1');
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(1);
  });
});

describe('GET /books/search (HTMX)', () => {
  it('AC1: returns matching book cards', async () => {
    const res = await request(app).get('/books/search?q=dune');
    expect(res.status).toBe(200);
    expect(cardCount(res.text)).toBe(1);
    expect(res.text).toContain('Dune');
    expect(res.text).toContain('Frank Herbert');
  });

  it('AC1: matches the author', async () => {
    const res = await request(app).get('/books/search?q=herbert');
    expect(cardCount(res.text)).toBe(1);
    expect(res.text).toContain('Dune');
  });

  it('AC1: no match renders the no-results message', async () => {
    const res = await request(app).get('/books/search?q=zzzz-no-such-book');
    expect(res.status).toBe(200);
    expect(res.text).toContain('<p class="search-message">No books found.</p>');
    expect(cardCount(res.text)).toBe(0);
  });

  it('AC2: empty q returns all 50 books', async () => {
    const res = await request(app).get('/books/search?q=');
    expect(res.status).toBe(200);
    expect(cardCount(res.text)).toBe(50);
    expect(res.text).not.toContain('No books found.');
  });

  it('AC2: missing q returns all 50 books', async () => {
    const res = await request(app).get('/books/search');
    expect(res.status).toBe(200);
    expect(cardCount(res.text)).toBe(50);
  });

  it('AC2: whitespace-only q returns all 50 books', async () => {
    const res = await request(app).get('/books/search?q=%20%20');
    expect(cardCount(res.text)).toBe(50);
  });

  it('AC4: 100 characters is accepted', async () => {
    const res = await request(app).get(`/books/search?q=${'a'.repeat(100)}`);
    expect(res.status).toBe(200);
  });

  it('AC4: 101 characters returns 400 with an error message', async () => {
    const res = await request(app).get(`/books/search?q=${'a'.repeat(101)}`);
    expect(res.status).toBe(400);
    expect(res.text).toContain(
      '<p class="search-message error">Search query must be 100 characters or fewer</p>'
    );
  });

  it('repeated q returns 400 with an error message', async () => {
    const res = await request(app).get('/books/search?q=a&q=b');
    expect(res.status).toBe(400);
    expect(res.text).toContain(
      '<p class="search-message error">Search query must be a single string</p>'
    );
  });

  it('AC5: escapes a script tag in the author', async () => {
    Book.createBook({
      title: 'Plain Title',
      author: '<script>alert(1)</script>',
      isbn: null,
      cover_url: null,
      description: null,
      published_year: null,
    });
    const res = await request(app).get(`/books/search?q=${encodeURIComponent('<script>')}`);
    expect(res.status).toBe(200);
    expect(cardCount(res.text)).toBe(1);
    expect(res.text).not.toContain('<script>');
    expect(res.text).toContain('&lt;script&gt;');
  });

  it('AC5: escapes a script tag in the title', async () => {
    Book.createBook({
      title: '<script>alert(2)</script>',
      author: 'Plain Author',
      isbn: null,
      cover_url: null,
      description: null,
      published_year: null,
    });
    const res = await request(app).get(`/books/search?q=${encodeURIComponent('<script>')}`);
    expect(res.text).not.toContain('<script>');
    expect(res.text).toContain('&lt;script&gt;');
  });

  it('AC5: a single quote in q does not cause a 500', async () => {
    const res = await request(app).get(`/books/search?q=${encodeURIComponent("Ender's")}`);
    expect(res.status).toBe(200);
    expect(cardCount(res.text)).toBe(1);
  });
});
