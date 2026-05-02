import {expect, test} from '@playwright/test';
import JSZip from 'jszip';

const createTinyEpub = async () => {
  const zip = new JSZip();

  zip.file('mimetype', 'application/epub+zip');
  zip.file(
    'META-INF/container.xml',
    `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`,
  );
  zip.file(
    'OEBPS/content.opf',
    `<?xml version="1.0" encoding="UTF-8"?>
<package version="3.0" unique-identifier="book-id" xmlns="http://www.idpf.org/2007/opf">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="book-id">codex-fixture</dc:identifier>
    <dc:title>Codex Fixture</dc:title>
    <dc:creator>Test Author</dc:creator>
    <dc:language>en</dc:language>
  </metadata>
  <manifest>
    <item id="chapter-1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="chapter-1"/>
  </spine>
</package>`,
  );
  zip.file(
    'OEBPS/chapter1.xhtml',
    `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <head><title>Chapter One</title></head>
  <body>
    <h1>Chapter One</h1>
    <p>This browser fixture confirms that EPUB conversion creates a downloadable PDF.</p>
  </body>
</html>`,
  );

  return zip.generateAsync({type: 'nodebuffer'});
};

test('transcriber does not download Whisper until requested', async ({page}) => {
  await page.goto('/');

  await expect(page.getByRole('button', {name: 'Load Whisper model'})).toBeVisible();
  await expect(page.getByText('Loading AI Model')).toHaveCount(0);
});

test('YouTube converter exposes MP4 alongside audio formats', async ({page}) => {
  await page.goto('/');
  await page.getByRole('button', {name: 'YouTube'}).click();

  await expect(page.getByRole('heading', {name: 'YouTube Converter'})).toBeVisible();
  await expect(page.getByRole('button', {name: 'mp3', exact: true})).toBeVisible();
  await expect(page.getByRole('button', {name: 'wav', exact: true})).toBeVisible();
  await expect(page.getByRole('button', {name: 'mp4', exact: true})).toBeVisible();
});

test('EPUB converter has a simple no-settings flow', async ({page}) => {
  await page.goto('/');
  await page.getByRole('button', {name: 'EPUB to PDF'}).click();

  await expect(page.getByRole('heading', {name: 'Free Browser EPUB to PDF Converter'})).toBeVisible();
  await expect(page.getByText('PDF settings')).toHaveCount(0);
  await expect(page.getByRole('button', {name: 'Convert to PDF'})).toBeVisible();
});

test('EPUB converter produces a downloadable PDF in the browser', async ({page}) => {
  await page.goto('/');
  await page.getByRole('button', {name: 'EPUB to PDF'}).click();

  await page.locator('input[type="file"]').setInputFiles({
    name: 'codex-fixture.epub',
    mimeType: 'application/epub+zip',
    buffer: await createTinyEpub(),
  });

  await expect(page.getByText('codex-fixture.epub', {exact: true})).toBeVisible();
  await page.getByRole('button', {name: 'Convert to PDF'}).click();

  await expect(page.getByText('PDF ready')).toBeVisible({timeout: 20_000});
  await expect(page.getByText('Codex Fixture by Test Author')).toBeVisible();

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', {name: 'Download PDF'}).click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toBe('Codex Fixture.pdf');
});
