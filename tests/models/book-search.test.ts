import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import { initDb, closeDb } from '../../src/db/index.js';
import * as Book from '../../src/models/book.js';

const DB_PATH = '/tmp/test-book-search-model.db';

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

const titles = (books: Book.Book[]) => books.map((b) => b.title);

describe('searchBooks model', () => {
  it('exports SEARCH_MAX_LENGTH = 100', () => {
    expect(Book.SEARCH_MAX_LENGTH).toBe(100);
  });

  it('AC1: matches a title substring', () => {
    expect(titles(Book.searchBooks('dune'))).toEqual(['Dune']);
  });

  it('AC1: matches an author substring and nothing else', () => {
    expect(titles(Book.searchBooks('herbert'))).toEqual(['Dune']);
  });

  it('AC1: author match returns every book by that author ordered by title', () => {
    expect(titles(Book.searchBooks('Andy Weir'))).toEqual(['Project Hail Mary', 'The Martian']);
    expect(titles(Book.searchBooks('tolkien'))).toEqual(['The Hobbit', 'The Lord of the Rings']);
  });

  it('AC1: matches title or author in one query, ordered by title', () => {
    expect(titles(Book.searchBooks('martin'))).toEqual([
      'A Game of Thrones',
      'A Memory Called Empire',
      'Clean Code',
      'Refactoring',
    ]);
  });

  it('AC1: is case-insensitive', () => {
    for (const q of ['dune', 'DUNE', 'DuNe', 'herbert', 'HERBERT']) {
      expect(titles(Book.searchBooks(q))).toEqual(['Dune']);
    }
  });

  it('AC1: no match returns an empty array', () => {
    expect(Book.searchBooks('zzzz-no-such-book')).toEqual([]);
  });

  it('AC2: empty query returns all books ordered like getAllBooks', () => {
    const all = Book.getAllBooks();
    expect(all).toHaveLength(50);
    expect(Book.searchBooks('')).toEqual(all);
  });

  it('AC2: whitespace-only query returns all books', () => {
    expect(Book.searchBooks('   \t ')).toEqual(Book.getAllBooks());
  });

  it('AC3: trims the query', () => {
    expect(titles(Book.searchBooks('  dune  '))).toEqual(['Dune']);
  });

  it('AC4: a 100-character query is allowed', () => {
    expect(Book.searchBooks('a'.repeat(100))).toEqual([]);
  });

  it('AC4: a 99-character query is allowed', () => {
    expect(Book.searchBooks('a'.repeat(99))).toEqual([]);
  });

  it('AC4: a 101-character query throws SearchValidationError', () => {
    expect(() => Book.searchBooks('a'.repeat(101))).toThrow(Book.SearchValidationError);
    expect(() => Book.searchBooks('a'.repeat(101))).toThrow(
      'Search query must be 100 characters or fewer'
    );
  });

  it('AC4: length is measured after trimming (100 chars plus padding is allowed)', () => {
    expect(Book.searchBooks(`  ${'a'.repeat(100)}  `)).toEqual([]);
  });

  it('AC4: 101 chars plus padding still throws', () => {
    expect(() => Book.searchBooks(` ${'a'.repeat(101)} `)).toThrow(Book.SearchValidationError);
  });

  it('AC5: a single quote does not break the query (title)', () => {
    expect(titles(Book.searchBooks("Ender's"))).toEqual(["Ender's Game"]);
  });

  it('AC5: a single quote in an author-only context does not throw', () => {
    expect(Book.searchBooks("O'Brien")).toEqual([]);
  });

  it('AC5: an injection payload matches nothing', () => {
    expect(Book.searchBooks("x' OR '1'='1")).toEqual([]);
    expect(Book.searchBooks("%' OR 1=1 --")).toEqual([]);
  });

  it('AC5: % matches itself, not anything', () => {
    expect(Book.searchBooks('%')).toEqual([]);
    expect(Book.searchBooks('Frank%Herbert')).toEqual([]);
  });

  it('AC5: _ matches itself, not any single character', () => {
    expect(Book.searchBooks('_')).toEqual([]);
    expect(Book.searchBooks('D_ne')).toEqual([]);
    expect(Book.searchBooks('Frank_Herbert')).toEqual([]);
  });

  it('AC5: a backslash matches itself', () => {
    expect(Book.searchBooks('\\')).toEqual([]);
  });

  it('AC5: % and _ match literal occurrences in author and title', () => {
    Book.createBook({
      title: '100% Pure',
      author: 'Snake_Case Writer',
      isbn: null,
      cover_url: null,
      description: null,
      published_year: null,
    });
    expect(titles(Book.searchBooks('100%'))).toEqual(['100% Pure']);
    expect(titles(Book.searchBooks('snake_case'))).toEqual(['100% Pure']);
    expect(Book.searchBooks('snakeXcase')).toEqual([]);
  });
});
