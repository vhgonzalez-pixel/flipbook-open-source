import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildLocalPublicationDescription,
  formatPublicationTitleFromFilename,
  formatSpanishMonthYear,
  parseLocalQueryParam,
} from './localPdfLibrary.ts';

test('formatPublicationTitleFromFilename removes .pdf extension and underscores cleanly', () => {
  assert.equal(formatPublicationTitleFromFilename('mi_revista_2026.pdf'), 'mi revista 2026');
  assert.equal(formatPublicationTitleFromFilename('  Catalogo-Diseno.PDF  '), 'Catalogo-Diseno');
  assert.equal(formatPublicationTitleFromFilename(''), 'Publicación PDF');
});

test('buildLocalPublicationDescription formats page count or file size cleanly', () => {
  assert.equal(
    buildLocalPublicationDescription(14, 2048),
    'PDF cargado localmente · 14 páginas'
  );
  assert.equal(
    buildLocalPublicationDescription(1, 2048),
    'PDF cargado localmente · 1 página'
  );
  assert.equal(
    buildLocalPublicationDescription(null, 2 * 1024 * 1024),
    'PDF cargado localmente · 2.0 MB'
  );
  assert.equal(
    buildLocalPublicationDescription(null, 45 * 1024),
    'PDF cargado localmente · 45 KB'
  );
});

test('parseLocalQueryParam parses ?local= ID cleanly', () => {
  assert.equal(parseLocalQueryParam('?local=local-123-abc'), 'local-123-abc');
  assert.equal(parseLocalQueryParam('?doc=publicaciones/rev1.pdf'), null);
  assert.equal(parseLocalQueryParam(''), null);
});

test('formatSpanishMonthYear returns capitalized non-empty Spanish month and year', () => {
  const formatted = formatSpanishMonthYear(new Date(2026, 10, 17).getTime());
  assert.match(formatted, /2026/);
  assert.equal(formatted[0], formatted[0].toUpperCase());
});
