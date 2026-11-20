import test from 'node:test';
import assert from 'node:assert/strict';
import {
  joinPdfTextItems,
  normalizeQuery,
  searchPagesText,
} from './pdfTextSearch.ts';

test('normalizeQuery strips diacritics and normalizes case/whitespace', () => {
  assert.equal(normalizeQuery('  Diseño  Arquitectónico '), 'diseno  arquitectonico');
  assert.equal(normalizeQuery('PABELLÓN'), 'pabellon');
});

test('searchPagesText finds accent-insensitive matches with original casing snippets', () => {
  const pages = [
    'Portada de Estudio Editorial.',
    'Artículo principal sobre Diseño Arquitectónico y hormigón visto.',
    'Página sin coincidencias.',
    'Más notas sobre diseño sostenible y diseño urbano.',
  ];

  const results = searchPagesText(pages, 'diseno');
  assert.equal(results.length, 2);

  assert.equal(results[0].pageIndex, 1);
  assert.equal(results[0].pageNumber, 2);
  assert.equal(results[0].matchCount, 1);
  assert.equal(results[0].snippets[0].match, 'Diseño');

  assert.equal(results[1].pageIndex, 3);
  assert.equal(results[1].pageNumber, 4);
  assert.equal(results[1].matchCount, 2);
});

test('searchPagesText returns empty array for empty query', () => {
  assert.deepEqual(searchPagesText(['Hola mundo'], '   '), []);
});

test('joinPdfTextItems cleans whitespace and combines lines', () => {
  const joined = joinPdfTextItems([
    { str: 'Trace-based', hasEOL: false },
    { str: 'Just-in-Time', hasEOL: true },
    { str: 'Compilation', hasEOL: false },
  ]);
  assert.equal(joined, 'Trace-based Just-in-Time Compilation');
});
