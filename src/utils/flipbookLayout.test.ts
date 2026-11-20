import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clampPanOffset,
  clampZoom,
  computeBookStageSize,
  formatPageIndicator,
  shouldUseSinglePage,
} from './flipbookLayout';

test('shouldUseSinglePage enables double page for desktop and split-pane preview widths >= 560px', () => {
  assert.equal(shouldUseSinglePage(1440, 'auto'), false);
  assert.equal(shouldUseSinglePage(700, 'auto'), false);
  assert.equal(shouldUseSinglePage(560, 'auto'), false);
  assert.equal(shouldUseSinglePage(390, 'auto'), true);
});

test('shouldUseSinglePage respects explicit user mode override', () => {
  assert.equal(shouldUseSinglePage(390, 'double'), false);
  assert.equal(shouldUseSinglePage(1440, 'single'), true);
});

test('computeBookStageSize fits double-page spread cleanly inside 700x700 preview without clipping', () => {
  const result = computeBookStageSize({
    containerWidth: 700,
    containerHeight: 636,
    pageAspectRatio: 612 / 792,
    isSinglePage: false,
  });

  assert.ok(result.stageWidth <= 700 - 32);
  assert.ok(result.stageHeight <= 636 - 16 - 84);
  assert.equal(result.stageWidth, result.pageWidth * 2);
});

test('computeBookStageSize fits single-page mobile cleanly inside 390x780', () => {
  const result = computeBookStageSize({
    containerWidth: 390,
    containerHeight: 780,
    pageAspectRatio: 612 / 792,
    isSinglePage: true,
  });

  assert.ok(result.stageWidth <= 390 - 32);
  assert.ok(result.stageHeight <= 780 - 16 - 84);
  assert.equal(result.stageWidth, result.pageWidth);
});

test('formatPageIndicator formats cover, double spreads, and back cover accurately', () => {
  assert.deepEqual(
    formatPageIndicator({ currentIndex: 0, totalPages: 14, isSinglePage: false }),
    {
      label: 'Portada · 1 de 14',
      activePages: [1],
      isFirst: true,
      isLast: false,
    }
  );

  assert.deepEqual(
    formatPageIndicator({ currentIndex: 1, totalPages: 14, isSinglePage: false }),
    {
      label: 'Páginas 2–3 de 14',
      activePages: [2, 3],
      isFirst: false,
      isLast: false,
    }
  );

  assert.deepEqual(
    formatPageIndicator({ currentIndex: 13, totalPages: 14, isSinglePage: false }),
    {
      label: 'Contraportada · 14 de 14',
      activePages: [14],
      isFirst: false,
      isLast: true,
    }
  );

  assert.deepEqual(
    formatPageIndicator({ currentIndex: 11, totalPages: 13, isSinglePage: false }),
    {
      label: 'Páginas 12–13 de 13',
      activePages: [12, 13],
      isFirst: false,
      isLast: true,
    }
  );
});

test('clampZoom respects min and max zoom bounds', () => {
  assert.equal(clampZoom(0.2), 0.75);
  assert.equal(clampZoom(1.5), 1.5);
  assert.equal(clampZoom(4.0), 2.5);
});

test('clampPanOffset resets to 0,0 when zoom <= 1 and clamps within bounds when zoomed in', () => {
  assert.deepEqual(
    clampPanOffset({
      x: 200,
      y: -150,
      zoom: 1,
      stageWidth: 800,
      stageHeight: 500,
      containerWidth: 1000,
      containerHeight: 700,
    }),
    { x: 0, y: 0 }
  );

  const clamped = clampPanOffset({
    x: 5000,
    y: -5000,
    zoom: 2,
    stageWidth: 800,
    stageHeight: 500,
    containerWidth: 1000,
    containerHeight: 700,
  });
  assert.ok(clamped.x > 0 && clamped.x < 5000);
  assert.ok(clamped.y < 0 && clamped.y > -5000);
});

