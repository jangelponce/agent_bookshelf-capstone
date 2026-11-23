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

describe('GET /api/books?q=', () => {
  it('AC1: finds Dune by title', async () => {
    const res = await request(app).get('/api/books?q=dune');
    expect(res.status).toBe(200);
    expect(res.body.map((b: { title: string }) => b.title)).toContain('Dune');
  });

  it('AC1: matches the author', async () => {
    const res = await request(app).get('/api/books?q=Herbert');
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
  });

  it('AC2: empty query returns all books', async () => {
    const res = await request(app).get('/api/books?q=');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(50);
  });

  it('AC3: trims the query', async () => {
    const res = await request(app).get('/api/books?q=%20%20dune%20%20');
    expect(res.body.map((b: { title: string }) => b.title)).toContain('Dune');
  });

  it('AC4: rejects a 150-character query with 400', async () => {
    const res = await request(app).get(`/api/books?q=${'a'.repeat(150)}`);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Search query must be 100 characters or fewer' });
  });
});

describe('GET /books/search (HTMX)', () => {
  it('AC1: returns matching book cards', async () => {
    const res = await request(app).get('/books/search?q=dune');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Dune');
  });
});
