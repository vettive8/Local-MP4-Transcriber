import type {TranscriptFormat, TranscriptResult} from './appTypes';

export const formatTimestamp = (seconds: number) => {
  const safeSeconds = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const secs = Math.floor(safeSeconds % 60);
  const paddedMinutes = String(minutes).padStart(2, '0');
  const paddedSeconds = String(secs).padStart(2, '0');

  if (hours > 0) {
    return `${String(hours).padStart(2, '0')}:${paddedMinutes}:${paddedSeconds}`;
  }

  return `${paddedMinutes}:${paddedSeconds}`;
};

export const formatDuration = (seconds?: number) => {
  if (!seconds || !Number.isFinite(seconds)) {
    return 'Unknown length';
  }

  return formatTimestamp(seconds);
};

export const formatCount = (value: number) => new Intl.NumberFormat().format(value);

export const getTranscriptText = (transcript: TranscriptResult, format: TranscriptFormat) => {
  if (format === 'timestamped' && transcript.chunks?.length) {
    return transcript.chunks
      .map((chunk) => `[${formatTimestamp(chunk.timestamp[0])}] ${chunk.text.trim()}`)
      .join('\n');
  }

  return transcript.text;
};

export const copyText = async (text: string) => {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  const copied = document.execCommand('copy');
  document.body.removeChild(textarea);

  if (!copied) {
    throw new Error('Copy failed');
  }
};

export const getApiError = async (response: Response, fallback: string) => {
  try {
    const payload = await response.json();
    return payload.error || fallback;
  } catch {
    return fallback;
  }
};

export const getFilenameFromDisposition = (disposition: string | null, fallback: string) => {
  if (!disposition) {
    return fallback;
  }

  const utf8Match = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    return decodeURIComponent(utf8Match[1].replace(/"/g, ''));
  }

  const filenameMatch = disposition.match(/filename="?([^";]+)"?/i);
  return filenameMatch?.[1] || fallback;
};
