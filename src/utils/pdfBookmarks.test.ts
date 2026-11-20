import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getBookmarkDocKey,
  getDefaultBookmarkLabel,
  getVisiblePageIndices,
  parseStoredBookmarks,
  removeBookmarkEntry,
  toggleBookmarkEntry,
  updateBookmarkLabel,
} from './pdfBookmarks.ts';

test('getBookmarkDocKey differentiates URL docs and stabilizes local blob uploads by title', () => {
  assert.equal(
    getBookmarkDocKey('publicaciones/rev1.pdf', 'Revista 1'),
    'flipbook_bookmarks_v1::publicaciones/rev1.pdf'
  );
  assert.equal(
    getBookmarkDocKey('blob:http://localhost:3000/abc-123', 'catalogo.pdf'),
    'flipbook_bookmarks_v1::local::catalogo.pdf'
  );
});

test('parseStoredBookmarks safely parses, deduplicates, and sorts bookmarks', () => {
  const raw = JSON.stringify([
    { pageIndex: 7, label: 'Capítulo 3', createdAt: 200 },
    { pageIndex: 2, label: '', createdAt: 100 },
    { pageIndex: 7, label: 'Capítulo 3 actualizado', createdAt: 300 },
    { pageIndex: -1, label: 'Inválido' },
  ]);

  const parsed = parseStoredBookmarks(raw);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].pageIndex, 2);
  assert.equal(parsed[0].pageNumber, 3);
  assert.equal(parsed[0].label, 'Página 3');
  assert.equal(parsed[1].pageIndex, 7);
  assert.equal(parsed[1].label, 'Capítulo 3 actualizado');
  assert.deepEqual(parseStoredBookmarks('{broken json'), []);
});

test('toggleBookmarkEntry adds in sorted order and removes when toggled again', () => {
  const step1 = toggleBookmarkEntry([], 5, 'Páginas 6–7', 1000);
  assert.equal(step1.added, true);
  assert.equal(step1.entries.length, 1);

  const step2 = toggleBookmarkEntry(step1.entries, 1, 'Índice', 2000);
  assert.equal(step2.added, true);
  assert.deepEqual(
    step2.entries.map((e) => e.pageIndex),
    [1, 5]
  );

  const step3 = toggleBookmarkEntry(step2.entries, 5, undefined, 3000);
  assert.equal(step3.added, false);
  assert.deepEqual(
    step3.entries.map((e) => e.pageIndex),
    [1]
  );
});

test('updateBookmarkLabel and removeBookmarkEntry modify target entries cleanly', () => {
  const initial = toggleBookmarkEntry([], 3, 'Página 4', 1000).entries;
  const renamed = updateBookmarkLabel(initial, 3, 'Ficha técnica');
  assert.equal(renamed[0].label, 'Ficha técnica');

  const removed = removeBookmarkEntry(renamed, 3);
  assert.deepEqual(removed, []);
});

test('getVisiblePageIndices and getDefaultBookmarkLabel resolve spreads accurately', () => {
  assert.deepEqual(getVisiblePageIndices(0, 14, false), [0]);
  assert.deepEqual(getVisiblePageIndices(2, 14, false), [1, 2]);
  assert.deepEqual(getVisiblePageIndices(2, 14, true), [2]);
  assert.equal(getDefaultBookmarkLabel(0, 14, false), 'Portada · Página 1');
  assert.equal(getDefaultBookmarkLabel(2, 14, false), 'Páginas 2–3');
  assert.equal(getDefaultBookmarkLabel(2, 14, true), 'Página 3');
});
