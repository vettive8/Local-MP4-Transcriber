import assert from 'node:assert/strict';
import test from 'node:test';

import {jsPDF} from 'jspdf';
import {wrapTextToWidth} from '../../src/pdfTextLayout.js';

test('wraps long headings using the active font and size', () => {
  const pdf = new jsPDF({unit: 'pt', format: 'letter'});
  const maxWidth = 612 - 56 * 2;
  const title = 'Chapter 7: Using Copilot and Power Query connectors with Python in Excel';

  pdf.setFont('times', 'bold');
  pdf.setFontSize(18);

  const lines = wrapTextToWidth(pdf, title, maxWidth);

  assert.deepEqual(lines, ['Chapter 7: Using Copilot and Power Query connectors with', 'Python in Excel']);
  assert.ok(lines.every((line) => pdf.getTextWidth(line) <= maxWidth));
});

test('splits single words that are wider than the content box', () => {
  const pdf = new jsPDF({unit: 'pt', format: 'letter'});
  const maxWidth = 120;

  pdf.setFont('times', 'bold');
  pdf.setFontSize(18);

  const lines = wrapTextToWidth(pdf, 'Supercalifragilisticexpialidocious', maxWidth);

  assert.ok(lines.length > 1);
  assert.ok(lines.every((line) => pdf.getTextWidth(line) <= maxWidth));
});
