import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeEvictablePages,
  computeRenderPriorityOrder,
  parseDocQueryParam,
} from './pdfLazyLoader';

test('parseDocQueryParam detects ?doc= relative and absolute paths and extracts display title', () => {
  assert.deepEqual(parseDocQueryParam(''), {
    hasDocParam: false,
    docUrl: null,
    displayTitle: null,
    isInvalidScheme: false,
  });

  assert.deepEqual(parseDocQueryParam('?doc=publicaciones/mi-revista%202026.pdf'), {
    hasDocParam: true,
    docUrl: 'publicaciones/mi-revista 2026.pdf',
    displayTitle: 'mi-revista 2026.pdf',
    isInvalidScheme: false,
  });

  assert.deepEqual(
    parseDocQueryParam('?doc=https://example.org/issue.pdf&title=Edici%C3%B3n%20Especial'),
    {
      hasDocParam: true,
      docUrl: 'https://example.org/issue.pdf',
      displayTitle: 'Edición Especial',
      isInvalidScheme: false,
    }
  );
});

test('parseDocQueryParam blocks unsafe URI schemes', () => {
  const res = parseDocQueryParam('?doc=javascript:alert(1)');
  assert.equal(res.hasDocParam, true);
  assert.equal(res.docUrl, null);
  assert.equal(res.isInvalidScheme, true);
});

test('computeRenderPriorityOrder prioritizes visible spread, next spread, cover, then outward pages', () => {
  const order = computeRenderPriorityOrder(5, 10);
  assert.equal(order.length, 10);
  assert.deepEqual(order.slice(0, 7), [5, 6, 4, 7, 8, 3, 0]);
  assert.deepEqual(new Set(order).size, 10);
});

test('computeEvictablePages preserves small docs and evicts farthest non-cover pages on 50-page docs', () => {
  const small = Array.from({ length: 14 }, (_, i) => i);
  assert.deepEqual(computeEvictablePages(small, 6, 14, 24), []);

  const largeRendered = Array.from({ length: 30 }, (_, i) => i);
  const evicted = computeEvictablePages(largeRendered, 25, 50, 24);
  assert.equal(evicted.length, 6);
  assert.ok(!evicted.includes(0));
  assert.ok(!evicted.includes(25));
  assert.ok(!evicted.includes(26));
  assert.ok(evicted.includes(1));
});
