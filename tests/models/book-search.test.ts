import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import { initDb, closeDb } from '../../src/db/index.js';
import {
  getAllBooks,
  createBook,
  searchBooks,
  SEARCH_MAX_LENGTH,
  SearchValidationError,
} from '../../src/models/book.js';

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

function addBook(title: string, author = 'Test Author') {
  return createBook({
    title,
    author,
    isbn: null,
    cover_url: null,
    description: null,
    published_year: null,
  });
}

const titles = (books: { title: string }[]) => books.map((b) => b.title);

describe('searchBooks', () => {
  it('exports SEARCH_MAX_LENGTH equal to 100', () => {
    expect(SEARCH_MAX_LENGTH).toBe(100);
  });

  describe('AC1: substring match on title or author, case-insensitive', () => {
    it('AC1: matches a title substring', () => {
      expect(titles(searchBooks('dune'))).toEqual(['Dune']);
    });

    it('AC1: matches an author substring', () => {
      expect(titles(searchBooks('herbert'))).toEqual(['Dune']);
    });

    it('AC1: is case-insensitive for uppercase queries', () => {
      expect(titles(searchBooks('DUNE'))).toEqual(['Dune']);
      expect(titles(searchBooks('HERBERT'))).toEqual(['Dune']);
    });

    it('AC1: is case-insensitive for mixed-case queries', () => {
      expect(titles(searchBooks('dUnE'))).toEqual(['Dune']);
    });

    it('AC1: returns multiple matches ordered by title', () => {
      expect(titles(searchBooks('tolkien'))).toEqual(['The Hobbit', 'The Lord of the Rings']);
    });

    it('AC1: returns full Book rows', () => {
      const [book] = searchBooks('dune');
      expect(book.id).toBe(16);
      expect(book.author).toBe('Frank Herbert');
      expect(book.published_year).toBe(1965);
    });

    it('AC1: does not match on description text', () => {
      expect(searchBooks('Arrakis')).toEqual([]);
    });

    it('AC1: returns [] when nothing matches', () => {
      expect(searchBooks('zzzz-no-such-book')).toEqual([]);
    });
  });

  describe('AC2: empty query returns all books', () => {
    it.each([['empty string', ''], ['spaces', '   '], ['tabs and newlines', ' \t\n ']])(
      'AC2: %s returns all books in getAllBooks order',
      (_label, q) => {
        const result = searchBooks(q);
        expect(result).toHaveLength(50);
        expect(result).toEqual(getAllBooks());
      }
    );
  });

  describe('AC3: query is trimmed', () => {
    it('AC3: "  dune  " behaves like "dune"', () => {
      expect(searchBooks('  dune  ')).toEqual(searchBooks('dune'));
      expect(titles(searchBooks('  dune  '))).toEqual(['Dune']);
    });

    it('AC3: trims tabs and newlines around the query', () => {
      expect(titles(searchBooks('\t herbert \n'))).toEqual(['Dune']);
    });
  });

  describe('AC4: length limit', () => {
    it('AC4: allows exactly 100 characters', () => {
      expect(searchBooks('a'.repeat(100))).toEqual([]);
    });

    it('AC4: matches a book whose title is exactly 100 characters', () => {
      const title = 'x'.repeat(100);
      addBook(title);
      expect(titles(searchBooks(title))).toEqual([title]);
    });

    it('AC4: rejects 101 characters with SearchValidationError', () => {
      expect(() => searchBooks('a'.repeat(101))).toThrow(SearchValidationError);
    });

    it('AC4: measures length after trimming (100 chars plus padding is allowed)', () => {
      expect(searchBooks(`   ${'a'.repeat(100)}   `)).toEqual([]);
    });

    it('AC4: 101 chars plus padding is still rejected', () => {
      expect(() => searchBooks(`  ${'a'.repeat(101)}  `)).toThrow(SearchValidationError);
    });

    it('AC4: SearchValidationError is an Error subclass', () => {
      expect(new SearchValidationError('x')).toBeInstanceOf(Error);
    });
  });

  describe('AC5: parameterised, wildcards are literal', () => {
    it('AC5: SQL injection text matches nothing and does not break the table', () => {
      expect(searchBooks("' OR 1=1 --")).toEqual([]);
      expect(searchBooks("x'; DROP TABLE books; --")).toEqual([]);
      expect(getAllBooks()).toHaveLength(50);
    });

    it('AC5: a single quote is matched literally', () => {
      expect(titles(searchBooks("Ender's"))).toEqual(["Ender's Game"]);
    });

    it('AC5: % matches only a literal percent sign', () => {
      addBook('100% Pure');
      addBook('Plain Title');
      expect(titles(searchBooks('%'))).toEqual(['100% Pure']);
    });

    it('AC5: % matches nothing when no book contains a percent sign', () => {
      expect(searchBooks('%')).toEqual([]);
    });

    it('AC5: _ matches only a literal underscore', () => {
      addBook('snake_case');
      expect(titles(searchBooks('_'))).toEqual(['snake_case']);
    });

    it('AC5: _ is not a single-character wildcard', () => {
      addBook('abc');
      addBook('a_c');
      expect(titles(searchBooks('a_c'))).toEqual(['a_c']);
    });

    it('AC5: % inside a query is not a multi-character wildcard', () => {
      addBook('foo-bar');
      addBook('foo%bar');
      expect(titles(searchBooks('foo%bar'))).toEqual(['foo%bar']);
    });

    it('AC5: backslash is matched literally', () => {
      addBook('back\\slash');
      addBook('backslash');
      expect(titles(searchBooks('\\'))).toEqual(['back\\slash']);
    });

    it('AC5: wildcards in the author are literal too', () => {
      addBook('Wildcard Author Book', 'R_D 100%');
      expect(titles(searchBooks('r_d 100%'))).toEqual(['Wildcard Author Book']);
    });
  });
});
