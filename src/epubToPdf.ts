import type JSZip from 'jszip';
import type {jsPDF} from 'jspdf';
import {wrapTextToWidth} from './pdfTextLayout.js';

export type EpubPageSize = 'a4' | 'letter';

export type EpubPdfOptions = {
  pageSize: EpubPageSize;
  fontSize: number;
  includeTitlePage: boolean;
  includeImages: boolean;
};

export type EpubPdfResult = {
  blob: Blob;
  filename: string;
  title: string;
  author?: string;
  chapterCount: number;
  pageCount: number;
  wordCount: number;
};

type EpubManifestItem = {
  id: string;
  href: string;
  mediaType: string;
};

type EpubBlock =
  | {
      type: 'heading' | 'paragraph';
      text: string;
    }
  | {
      type: 'image';
      alt: string;
      src: string;
      basePath: string;
      isCover: boolean;
    };

type EpubChapter = {
  title: string;
  path: string;
  blocks: EpubBlock[];
};

type ProgressHandler = (message: string) => void;
type JsPdfConstructor = typeof import('jspdf').jsPDF;

const xmlParser = new DOMParser();

const safeDecodeURIComponent = (value: string) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const normalizeZipPath = (value: string) => {
  const parts: string[] = [];
  const cleanedValue = safeDecodeURIComponent(value).replace(/\\/g, '/').replace(/^\/+/, '');

  for (const part of cleanedValue.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      parts.pop();
    } else {
      parts.push(part);
    }
  }

  return parts.join('/');
};

const resolveZipPath = (basePath: string, href: string) => {
  const cleanHref = href.split('#')[0].split('?')[0];
  const baseDir = basePath.includes('/') ? basePath.slice(0, basePath.lastIndexOf('/') + 1) : '';

  return normalizeZipPath(`${baseDir}${cleanHref}`);
};

const getZipFile = (zip: JSZip, path: string) => {
  const normalizedPath = normalizeZipPath(path);
  const directFile = zip.file(normalizedPath);

  if (directFile) {
    return directFile;
  }

  const lowerPath = normalizedPath.toLowerCase();
  return zip.file(/.*/).find((file) => file.name.toLowerCase() === lowerPath) || null;
};

const parseXml = (value: string, label: string) => {
  const document = xmlParser.parseFromString(value, 'application/xml');

  if (document.querySelector('parsererror')) {
    throw new Error(`Could not read ${label}.`);
  }

  return document;
};

const getTextFromTags = (document: Document, tagNames: string[]) => {
  for (const tagName of tagNames) {
    const value = document.getElementsByTagName(tagName)[0]?.textContent?.trim();

    if (value) {
      return value;
    }
  }

  return '';
};

const getAttribute = (element: Element, name: string) =>
  element.getAttribute(name) || element.getAttributeNS('http://www.w3.org/1999/xlink', name) || '';

const normalizeText = (value: string) => value.replace(/\s+/g, ' ').trim();

const getElementText = (element: Element) => normalizeText(element.textContent || '');

const getChapterTitle = (blocks: EpubBlock[], fallback: string) => {
  const heading = blocks.find((block) => block.type === 'heading' && block.text.trim());
  return heading?.type === 'heading' ? heading.text : fallback;
};

const pushTextBlock = (blocks: EpubBlock[], type: 'heading' | 'paragraph', text: string) => {
  const cleanText = normalizeText(text);

  if (cleanText) {
    blocks.push({type, text: cleanText});
  }
};

const extractBlocksFromElement = (element: Element, blocks: EpubBlock[], chapterPath: string, includeImages: boolean) => {
  const tagName = element.tagName.toLowerCase();

  if (['script', 'style', 'head', 'metadata', 'link'].includes(tagName)) {
    return;
  }

  if (/^h[1-6]$/.test(tagName)) {
    pushTextBlock(blocks, 'heading', getElementText(element));
    return;
  }

  if (tagName === 'img' || tagName === 'image') {
    const src = getAttribute(element, 'src') || getAttribute(element, 'href');

    if (includeImages && src) {
      const role = getAttribute(element, 'role');
      const className = getAttribute(element, 'class');
      const alt = getAttribute(element, 'alt');

      blocks.push({
        type: 'image',
        alt,
        src,
        basePath: chapterPath,
        isCover: /cover/i.test(`${role} ${className} ${alt} ${src}`),
      });
    }

    return;
  }

  if (['p', 'li', 'blockquote', 'pre'].includes(tagName)) {
    pushTextBlock(blocks, 'paragraph', getElementText(element));
    return;
  }

  for (const child of Array.from(element.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      pushTextBlock(blocks, 'paragraph', child.textContent || '');
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      extractBlocksFromElement(child as Element, blocks, chapterPath, includeImages);
    }
  }
};

const extractChapter = async (zip: JSZip, chapterPath: string, fallbackTitle: string, includeImages: boolean) => {
  const chapterFile = getZipFile(zip, chapterPath);

  if (!chapterFile) {
    return null;
  }

  const chapterHtml = await chapterFile.async('string');
  const document = new DOMParser().parseFromString(chapterHtml, 'text/html');
  const body = document.body || document.querySelector('body');
  const blocks: EpubBlock[] = [];

  if (body) {
    extractBlocksFromElement(body, blocks, chapterPath, includeImages);
  }

  if (!blocks.length) {
    return null;
  }

  return {
    title: getChapterTitle(blocks, fallbackTitle),
    path: chapterPath,
    blocks,
  };
};

const getManifest = (opfDocument: Document) =>
  Array.from(opfDocument.getElementsByTagName('item')).map((item) => ({
    id: item.getAttribute('id') || '',
    href: item.getAttribute('href') || '',
    mediaType: item.getAttribute('media-type') || '',
  }));

const getSpineItems = (opfDocument: Document, manifest: EpubManifestItem[]) => {
  const manifestById = new Map(manifest.map((item) => [item.id, item]));
  const spineItems = Array.from(opfDocument.getElementsByTagName('itemref'))
    .map((itemref) => manifestById.get(itemref.getAttribute('idref') || ''))
    .filter(Boolean) as EpubManifestItem[];

  if (spineItems.length) {
    return spineItems;
  }

  return manifest.filter((item) => /x?html/i.test(item.mediaType));
};

const getPageFormat = (pageSize: EpubPageSize) => (pageSize === 'letter' ? 'letter' : 'a4');

const addFooter = (pdf: jsPDF, pageWidth: number, pageHeight: number) => {
  const pageCount = pdf.getNumberOfPages();

  for (let page = 1; page <= pageCount; page += 1) {
    pdf.setPage(page);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(9);
    pdf.setTextColor(130, 145, 166);
    pdf.text(String(page), pageWidth / 2, pageHeight - 24, {align: 'center'});
  }

  pdf.setTextColor(15, 23, 42);
};

const createTitlePage = (
  pdf: jsPDF,
  title: string,
  author: string | undefined,
  fileName: string,
  pageWidth: number,
  pageHeight: number,
  margin: number,
) => {
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(24);
  const titleLines = pdf.splitTextToSize(title || fileName, pageWidth - margin * 2) as string[];
  pdf.text(titleLines, margin, pageHeight * 0.36);

  if (author) {
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(13);
    pdf.setTextColor(71, 85, 105);
    pdf.text(author, margin, pageHeight * 0.36 + titleLines.length * 30 + 12);
    pdf.setTextColor(15, 23, 42);
  }
};

const getMimeFromPath = (path: string) => {
  const extension = path.split('.').pop()?.toLowerCase();

  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg';
  if (extension === 'png') return 'image/png';
  if (extension === 'webp') return 'image/webp';
  if (extension === 'gif') return 'image/gif';
  if (extension === 'svg') return 'image/svg+xml';

  return '';
};

const loadImage = (dataUrl: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Could not read image.'));
    image.src = dataUrl;
  });

const prepareImageForPdf = async (dataUrl: string, mimeType: string) => {
  const image = await loadImage(dataUrl);
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;

  if (mimeType !== 'image/jpeg' && mimeType !== 'image/png') {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');

    if (!context) {
      throw new Error('Could not prepare image.');
    }

    context.drawImage(image, 0, 0);

    return {
      dataUrl: canvas.toDataURL('image/png'),
      format: 'PNG',
      width,
      height,
    };
  }

  return {
    dataUrl,
    format: mimeType === 'image/jpeg' ? 'JPEG' : 'PNG',
    width,
    height,
  };
};

const addImageBlock = async (
  pdf: jsPDF,
  zip: JSZip,
  block: Extract<EpubBlock, {type: 'image'}>,
  y: number,
  pageWidth: number,
  pageHeight: number,
  margin: number,
  fullBleed = false,
) => {
  const imagePath = resolveZipPath(block.basePath, block.src);
  const imageFile = getZipFile(zip, imagePath);
  const mimeType = getMimeFromPath(imagePath);

  if (!imageFile || !mimeType) {
    return y;
  }

  try {
    const base64 = await imageFile.async('base64');
    const dataUrl = `data:${mimeType};base64,${base64}`;
    const image = await prepareImageForPdf(dataUrl, mimeType);
    const maxWidth = fullBleed ? pageWidth : pageWidth - margin * 2;
    const maxHeight = fullBleed ? pageHeight : (pageHeight - margin * 2) * 0.72;
    const scale = fullBleed
      ? Math.max(maxWidth / image.width, maxHeight / image.height)
      : Math.min(maxWidth / image.width, maxHeight / image.height, 1);
    const width = image.width * scale;
    const height = image.height * scale;

    if (!fullBleed && y + height > pageHeight - margin) {
      pdf.addPage();
      y = margin;
    }

    if (fullBleed) {
      if (y > margin) {
        pdf.addPage();
      }

      pdf.addImage(image.dataUrl, image.format, (pageWidth - width) / 2, (pageHeight - height) / 2, width, height);
      return pageHeight;
    }

    pdf.addImage(image.dataUrl, image.format, margin + (maxWidth - width) / 2, y, width, height);
    return y + height + 16;
  } catch {
    return y;
  }
};

const getWordCount = (chapters: EpubChapter[]) =>
  chapters.reduce((count, chapter) => {
    const chapterWords = chapter.blocks.reduce((blockCount, block) => {
      if (block.type === 'image') return blockCount;
      return blockCount + block.text.split(/\s+/).filter(Boolean).length;
    }, 0);

    return count + chapterWords;
  }, 0);

const createPdf = async (
  PdfDocument: JsPdfConstructor,
  zip: JSZip,
  chapters: EpubChapter[],
  sourceFileName: string,
  title: string,
  author: string | undefined,
  options: EpubPdfOptions,
  onProgress?: ProgressHandler,
) => {
  const pdf = new PdfDocument({unit: 'pt', format: getPageFormat(options.pageSize)});
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = options.pageSize === 'letter' ? 56 : 54;
  const contentWidth = pageWidth - margin * 2;
  const paragraphSize = options.fontSize;
  const lineHeight = paragraphSize * 1.45;
  let y = margin;

  const ensureSpace = (neededHeight: number) => {
    if (y + neededHeight > pageHeight - margin) {
      pdf.addPage();
      y = margin;
    }
  };

  if (options.includeTitlePage) {
    createTitlePage(pdf, title, author, sourceFileName, pageWidth, pageHeight, margin);
    pdf.addPage();
  }

  for (const [index, chapter] of chapters.entries()) {
    onProgress?.(`Writing chapter ${index + 1} of ${chapters.length}...`);

    if (index > 0) {
      pdf.addPage();
      y = margin;
    }

    const imageOnlyChapter = chapter.blocks.every((block) => block.type === 'image');

    for (const block of chapter.blocks) {
      if (block.type === 'image') {
        if (options.includeImages) {
          y = await addImageBlock(pdf, zip, block, y, pageWidth, pageHeight, margin, imageOnlyChapter && block.isCover);
        }

        continue;
      }

      const isHeading = block.type === 'heading';
      const fontSize = isHeading ? Math.min(paragraphSize + 6, 22) : paragraphSize;
      const blockLineHeight = isHeading ? fontSize * 1.25 : lineHeight;
      const spacing = isHeading ? 14 : 10;
      pdf.setFont('times', isHeading ? 'bold' : 'normal');
      pdf.setFontSize(fontSize);
      pdf.setTextColor(15, 23, 42);
      const lines = wrapTextToWidth(pdf, block.text, contentWidth);

      ensureSpace(lines.length * blockLineHeight + spacing);
      pdf.text(lines, margin, y);
      y += lines.length * blockLineHeight + spacing;
    }
  }

  return pdf;
};

const getOutputFilename = (title: string, sourceFileName: string) => {
  const baseName = title || sourceFileName.replace(/\.epub$/i, '') || 'converted-book';
  const safeName = baseName
    .normalize('NFKD')
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);

  return `${safeName || 'converted-book'}.pdf`;
};

export const convertEpubToPdf = async (
  file: File,
  options: EpubPdfOptions,
  onProgress?: ProgressHandler,
): Promise<EpubPdfResult> => {
  onProgress?.('Reading EPUB...');
  const [{default: JSZip}, {jsPDF: PdfDocument}] = await Promise.all([import('jszip'), import('jspdf')]);
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const containerFile = getZipFile(zip, 'META-INF/container.xml');

  if (!containerFile) {
    throw new Error('This does not look like a valid EPUB file.');
  }

  const containerDocument = parseXml(await containerFile.async('string'), 'EPUB container');
  const opfPath = containerDocument.querySelector('rootfile')?.getAttribute('full-path');

  if (!opfPath) {
    throw new Error('Could not find the EPUB package file.');
  }

  const packageFile = getZipFile(zip, opfPath);

  if (!packageFile) {
    throw new Error('Could not open the EPUB package file.');
  }

  onProgress?.('Reading book structure...');
  const opfDocument = parseXml(await packageFile.async('string'), 'EPUB package');
  const title = getTextFromTags(opfDocument, ['dc:title', 'title']) || file.name.replace(/\.epub$/i, '');
  const author = getTextFromTags(opfDocument, ['dc:creator', 'creator']);
  const manifest = getManifest(opfDocument);
  const spineItems = getSpineItems(opfDocument, manifest);

  if (!spineItems.length) {
    throw new Error('Could not find readable chapters in this EPUB.');
  }

  const chapters: EpubChapter[] = [];

  for (const [index, item] of spineItems.entries()) {
    onProgress?.(`Extracting chapter ${index + 1} of ${spineItems.length}...`);
    const chapterPath = resolveZipPath(opfPath, item.href);
    const chapter = await extractChapter(zip, chapterPath, `Chapter ${index + 1}`, options.includeImages);

    if (chapter) {
      chapters.push(chapter);
    }
  }

  if (!chapters.length) {
    throw new Error('No readable text was found in this EPUB.');
  }

  const pdf = await createPdf(PdfDocument, zip, chapters, file.name, title, author || undefined, options, onProgress);
  const blob = pdf.output('blob');

  return {
    blob,
    filename: getOutputFilename(title, file.name),
    title,
    author: author || undefined,
    chapterCount: chapters.length,
    pageCount: pdf.getNumberOfPages(),
    wordCount: getWordCount(chapters),
  };
};
