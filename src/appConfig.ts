import type {EpubPdfOptions} from './epubToPdf';

export const defaultEpubPdfOptions: EpubPdfOptions = {
  pageSize: 'letter',
  fontSize: 12,
  includeTitlePage: false,
  includeImages: true,
};
