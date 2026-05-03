export type AppPage = 'transcriber' | 'youtube' | 'epub';

export type YoutubeInfo = {
  title: string;
  author?: string;
  durationSeconds?: number;
  thumbnail?: string;
};

export type YoutubeStatus = 'idle' | 'loading' | 'ready' | 'error';

export type EpubStatus = 'idle' | 'processing' | 'complete' | 'error';

export type TranscriptChunk = {
  text: string;
  timestamp: [number, number];
};

export type TranscriptResult = {
  text: string;
  chunks?: TranscriptChunk[];
};

export type TranscriptFormat = 'plain' | 'timestamped';
