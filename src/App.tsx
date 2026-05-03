import React, {useEffect, useRef, useState} from 'react';
import {
  AlertCircle,
  BookOpen,
  CheckCircle,
  Clipboard,
  Clock,
  Download,
  FileDown,
  FileText,
  Link,
  Loader2,
  RefreshCw,
  Upload,
  Youtube,
} from 'lucide-react';
import {
  convertEpubToPdf,
  type EpubPdfResult,
} from './epubToPdf';
import {defaultEpubPdfOptions} from './appConfig';
import {
  copyText,
  formatCount,
  formatTimestamp,
  getApiError,
  getTranscriptText,
} from './appHelpers';
import type {
  AppPage,
  EpubStatus,
  TranscriptFormat,
  TranscriptResult,
  YoutubeInfo,
  YoutubeStatus,
} from './appTypes';

function TranscriberPage() {
  const [status, setStatus] = useState<
    'idle' | 'loading_model' | 'ready' | 'decoding' | 'transcribing' | 'complete' | 'error'
  >('idle');
  const [progressMsg, setProgressMsg] = useState('');
  const [downloadProgress, setDownloadProgress] = useState<number>(0);
  const [errorMsg, setErrorMsg] = useState('');
  const [transcript, setTranscript] = useState<TranscriptResult | null>(null);
  const [transcriptFormat, setTranscriptFormat] = useState<TranscriptFormat>('timestamped');
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'error'>('idle');

  const workerRef = useRef<Worker | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const modelReadyRef = useRef(false);

  useEffect(() => {
    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
      modelReadyRef.current = false;
      if (audioCtxRef.current?.state !== 'closed') {
        audioCtxRef.current?.close().catch(console.error);
      }
    };
  }, []);

  useEffect(() => {
    setCopyStatus('idle');
  }, [transcriptFormat]);

  const createTranscriberWorker = () => {
    if (workerRef.current) {
      return workerRef.current;
    }

    const worker = new Worker(new URL('./worker.ts', import.meta.url), {type: 'module'});

    worker.onmessage = (e) => {
      const {status: msgStatus, message, info, result} = e.data;

      if (msgStatus === 'loading') {
        setStatus('loading_model');
        setProgressMsg(message);
      } else if (msgStatus === 'progress' && info) {
        if (info.status === 'init' || info.status === 'progress' || info.status === 'downloading') {
          if (info.name && info.progress !== undefined) {
            setDownloadProgress(Math.round(info.progress));
            setProgressMsg(`Downloading model files... ${Math.round(info.progress)}%`);
          }
        } else if (info.status === 'done') {
          setDownloadProgress(100);
        }
      } else if (msgStatus === 'ready') {
        modelReadyRef.current = true;
        setStatus('ready');
        setProgressMsg('');
        setDownloadProgress(0);
      } else if (msgStatus === 'transcribing') {
        setStatus('transcribing');
        setProgressMsg('Transcribing audio using Whisper model...');
      } else if (msgStatus === 'complete') {
        setStatus('complete');
        setTranscript(result);
        setTranscriptFormat(result?.chunks?.length ? 'timestamped' : 'plain');
        setCopyStatus('idle');
        setProgressMsg('');
      } else if (msgStatus === 'error') {
        if (!modelReadyRef.current) {
          workerRef.current?.terminate();
          workerRef.current = null;
        }
        setStatus('error');
        setErrorMsg(message);
      }
    };

    workerRef.current = worker;
    return worker;
  };

  const loadWhisperModel = () => {
    setTranscript(null);
    setErrorMsg('');
    setCopyStatus('idle');
    setDownloadProgress(0);
    modelReadyRef.current = false;
    setStatus('loading_model');
    setProgressMsg('Initializing WebAssembly...');
    createTranscriberWorker().postMessage({type: 'load'});
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('audio/') && !file.type.startsWith('video/')) {
      setStatus('error');
      setErrorMsg('Please upload a valid audio or video file.');
      return;
    }

    try {
      setTranscript(null);
      setErrorMsg('');
      setCopyStatus('idle');
      setStatus('decoding');
      setProgressMsg('Extracting audio from file...');

      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      const audioCtx = new AudioContextClass({sampleRate: 16000});
      audioCtxRef.current = audioCtx;

      const arrayBuffer = await file.arrayBuffer();
      const decodedData = await audioCtx.decodeAudioData(arrayBuffer);
      const audioData = decodedData.getChannelData(0);

      workerRef.current?.postMessage({
        type: 'transcribe',
        data: {audio: audioData},
      });
    } catch (err: any) {
      console.error(err);
      setStatus('error');
      setErrorMsg(`Failed to extract audio: ${err.message || 'Unknown error. Make sure the file is a valid MP4/Audio.'}`);
    }
  };

  const reset = () => {
    setTranscript(null);
    setErrorMsg('');
    setCopyStatus('idle');
    setStatus(modelReadyRef.current ? 'ready' : 'idle');
    setProgressMsg('');
  };

  const exportTranscriptText = transcript ? getTranscriptText(transcript, transcriptFormat) : '';
  const hasTimestampedTranscript = Boolean(transcript?.chunks?.length);

  const handleCopyTranscript = async () => {
    if (!exportTranscriptText) return;

    try {
      await copyText(exportTranscriptText);
      setCopyStatus('copied');
    } catch (err) {
      console.error(err);
      setCopyStatus('error');
    }
  };

  const handleDownloadTranscript = () => {
    if (!exportTranscriptText) return;

    const blob = new Blob([exportTranscriptText], {type: 'text/plain'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const formatSuffix = transcriptFormat === 'timestamped' ? 'timestamps' : 'plain';
    a.href = url;
    a.download = `transcript-${formatSuffix}-${Date.now()}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="mx-auto w-full max-w-3xl space-y-8">
      <div className="text-center">
        <div className="mx-auto flex h-12 w-12 flex-col items-center justify-center rounded-full bg-indigo-100 text-indigo-600">
          <CheckCircle className="h-6 w-6" />
        </div>
        <h2 className="mt-4 text-4xl font-extrabold tracking-tight text-slate-900">Free Browser Video Transcriber</h2>
        <p className="mt-2 text-lg text-slate-600">
          Convert MP4 video audio to text directly in your browser.
          <br className="max-sm:hidden" />
          No API limits, no accounts, and private.
        </p>
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-xl">
        <div className="p-8">
          {status === 'idle' && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="mb-4 flex h-16 w-16 flex-col items-center justify-center rounded-full bg-indigo-50">
                <FileText className="h-8 w-8 text-indigo-500" />
              </div>
              <p className="text-lg font-medium text-slate-900">Whisper model is paused</p>
              <p className="mt-2 max-w-md text-sm text-slate-500">
                Load it only when you want to transcribe an audio or video file.
              </p>
              <button
                type="button"
                onClick={loadWhisperModel}
                className="mt-6 flex h-12 flex-row items-center justify-center gap-2 rounded-lg bg-indigo-600 px-5 text-sm font-semibold text-white transition hover:bg-indigo-700"
              >
                <Download className="h-4 w-4" />
                <span>Load Whisper model</span>
              </button>
            </div>
          )}

          {status === 'loading_model' && (
            <div className="flex flex-col items-center justify-center py-12 text-center text-slate-500">
              <Loader2 className="mb-4 h-10 w-10 animate-spin text-indigo-500" />
              <p className="text-lg font-medium text-slate-700">Loading AI Model (Whisper)</p>
              <p className="mt-1 text-sm">{progressMsg || 'Initializing WebAssembly...'}</p>
              {downloadProgress > 0 && downloadProgress < 100 && (
                <div className="mt-4 h-2.5 w-full max-w-xs rounded-full bg-slate-200">
                  <div
                    className="h-2.5 rounded-full bg-indigo-600 transition-all duration-300"
                    style={{width: `${downloadProgress}%`}}
                  />
                </div>
              )}
            </div>
          )}

          {status === 'ready' && (
            <label className="flex h-64 w-full cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 transition-colors hover:bg-slate-100">
              <div className="flex flex-col items-center justify-center pb-6 pt-5">
                <Upload className="mb-4 h-12 w-12 text-slate-400" />
                <p className="mb-2 text-lg font-medium text-slate-700">
                  <span className="font-semibold text-indigo-600">Click to upload</span> or drag and drop
                </p>
                <p className="text-sm text-slate-500">MP4, WEBM, MOV, MP3, WAV</p>
              </div>
              <input type="file" accept="video/*,audio/*" className="hidden" onChange={handleFileUpload} />
            </label>
          )}

          {['decoding', 'transcribing'].includes(status) && (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Loader2 className="mb-4 h-12 w-12 animate-spin text-indigo-500" />
              <p className="text-xl font-medium text-slate-900">
                {status === 'decoding' ? 'Extracting Audio...' : 'Transcribing Speech to Text'}
              </p>
              <p className="mt-2 text-slate-500">
                {progressMsg || 'This may take a few moments depending on video length and your device.'}
              </p>
            </div>
          )}

          {status === 'error' && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="mb-4 flex h-16 w-16 flex-col items-center justify-center rounded-full bg-red-50">
                <AlertCircle className="h-8 w-8 text-red-500" />
              </div>
              <h3 className="mb-2 text-lg font-medium text-slate-900">Something went wrong</h3>
              <p className="max-w-md text-slate-600">{errorMsg}</p>
              <button
                onClick={reset}
                className="mt-6 flex flex-row items-center space-x-2 rounded-lg bg-slate-900 px-4 py-2 text-white transition-colors hover:bg-slate-800"
              >
                <RefreshCw className="h-4 w-4" />
                <span>Try again</span>
              </button>
            </div>
          )}

          {status === 'complete' && transcript && (
            <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
              <div className="mb-6 space-y-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex flex-row items-center space-x-3 text-emerald-600">
                    <CheckCircle className="h-6 w-6" />
                    <h3 className="text-lg font-semibold">Transcription Complete</h3>
                  </div>
                  <button onClick={reset} className="text-sm font-medium text-indigo-600 hover:text-indigo-700 sm:text-right">
                    Transcribe another file
                  </button>
                </div>

                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div className="inline-flex w-full rounded-lg border border-slate-200 bg-slate-100 p-1 sm:w-auto">
                    <button
                      type="button"
                      onClick={() => setTranscriptFormat('plain')}
                      aria-pressed={transcriptFormat === 'plain'}
                      className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition sm:flex-none ${
                        transcriptFormat === 'plain' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      No timestamps
                    </button>
                    <button
                      type="button"
                      onClick={() => setTranscriptFormat('timestamped')}
                      disabled={!hasTimestampedTranscript}
                      aria-pressed={transcriptFormat === 'timestamped'}
                      className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition sm:flex-none ${
                        transcriptFormat === 'timestamped'
                          ? 'bg-white text-slate-900 shadow-sm'
                          : 'text-slate-600 hover:text-slate-900'
                      } ${!hasTimestampedTranscript ? 'cursor-not-allowed opacity-50' : ''}`}
                    >
                      With timestamps
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-row">
                    <button
                      type="button"
                      onClick={handleCopyTranscript}
                      className="flex flex-row items-center justify-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                    >
                      <Clipboard className="h-4 w-4" />
                      <span>{copyStatus === 'copied' ? 'Copied' : copyStatus === 'error' ? 'Copy failed' : 'Copy'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleDownloadTranscript}
                      className="flex flex-row items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-700"
                    >
                      <FileText className="h-4 w-4" />
                      <span>Download .TXT</span>
                    </button>
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-6">
                {transcriptFormat === 'timestamped' && transcript.chunks && transcript.chunks.length > 0 ? (
                  <div className="space-y-4">
                    {transcript.chunks.map((chunk, i) => (
                      <div key={i} className="flex flex-row gap-4">
                        <span className="mt-1 whitespace-nowrap font-mono text-xs text-slate-400">
                          [{formatTimestamp(chunk.timestamp[0])}]
                        </span>
                        <p className="font-sans leading-relaxed text-slate-800">{chunk.text}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="whitespace-pre-wrap leading-relaxed text-slate-800">{transcript.text}</p>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="border-t border-slate-100 bg-slate-50 p-4 text-center">
          <p className="flex flex-row items-center justify-center space-x-1 text-xs text-slate-500">
            <span>Powered by</span>
            <a
              href="https://huggingface.co/docs/transformers.js"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center text-indigo-600 hover:underline"
            >
              transformers.js
            </a>
            <span>and Whisper</span>
          </p>
        </div>
      </div>
    </div>
  );
}

function YoutubePage({onOpenTranscriber}: {onOpenTranscriber: () => void}) {
  const [url, setUrl] = useState('');
  const [status, setStatus] = useState<YoutubeStatus>('idle');
  const [videoInfo, setVideoInfo] = useState<YoutubeInfo | null>(null);
  const [errorMsg, setErrorMsg] = useState('');

  const fetchVideoInfo = async () => {
    const trimmedUrl = url.trim();

    if (!trimmedUrl) {
      setStatus('error');
      setErrorMsg('Paste a YouTube link first.');
      return false;
    }

    setStatus('loading');
    setErrorMsg('');

    try {
      const response = await fetch(`/api/youtube/info?url=${encodeURIComponent(trimmedUrl)}`);

      if (!response.ok) {
        throw new Error(await getApiError(response, 'Could not read that YouTube link.'));
      }

      const info = (await response.json()) as YoutubeInfo;
      setVideoInfo(info);
      setStatus('ready');
      return true;
    } catch (err: any) {
      console.error(err);
      setVideoInfo(null);
      setStatus('error');
      setErrorMsg(err.message || 'Could not read that YouTube link.');
      return false;
    }
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await fetchVideoInfo();
  };

  const clearUrl = () => {
    setUrl('');
    setVideoInfo(null);
    setErrorMsg('');
    setStatus('idle');
  };

  const currentUrl = url.trim();

  return (
    <div className="mx-auto w-full max-w-3xl space-y-8">
      <div className="text-center">
        <div className="mx-auto flex h-12 w-12 flex-col items-center justify-center rounded-full bg-red-50 text-red-600">
          <Youtube className="h-6 w-6" />
        </div>
        <h2 className="mt-4 text-4xl font-extrabold tracking-tight text-slate-900">Video Link Preview</h2>
        <p className="mt-2 text-lg text-slate-600">
          Preview public YouTube links without downloading them on the server.
          <br className="max-sm:hidden" />
          Convert media files you already have from the Transcriber tab.
        </p>
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-xl">
        <form onSubmit={handleSubmit} className="space-y-6 p-8">
          <div className="space-y-3">
            <label htmlFor="youtube-url" className="text-sm font-semibold text-slate-700">
              YouTube link
            </label>
            <div className="flex flex-col gap-3 sm:flex-row">
              <div className="relative flex-1">
                <Link className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
                <input
                  id="youtube-url"
                  type="url"
                  value={url}
                  onChange={(event) => {
                    setUrl(event.target.value);
                    setVideoInfo(null);
                    if (status === 'error') {
                      setStatus('idle');
                      setErrorMsg('');
                    }
                  }}
                  placeholder="https://www.youtube.com/watch?v=..."
                  className="h-12 w-full rounded-lg border border-slate-300 bg-white pl-10 pr-4 text-slate-900 outline-none transition focus:border-red-400 focus:ring-4 focus:ring-red-100"
                />
              </div>
              <button
                type="submit"
                disabled={status === 'loading'}
                className="flex h-12 flex-row items-center justify-center gap-2 rounded-lg border border-slate-300 px-5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {status === 'loading' ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}
                <span>Preview link</span>
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-4 rounded-xl border border-amber-100 bg-amber-50 p-4 text-amber-800 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-semibold">Server-side downloads are off</p>
              <p className="mt-1 text-sm text-amber-700">
                For public production, upload media files you own instead of having Cloud Run download from YouTube.
              </p>
            </div>
            <button
              type="button"
              onClick={onOpenTranscriber}
              className="flex h-12 flex-none flex-row items-center justify-center gap-2 rounded-lg bg-slate-900 px-5 text-sm font-semibold text-white transition hover:bg-slate-800"
            >
              <Upload className="h-4 w-4" />
              <span>Upload media</span>
            </button>
          </div>

          {status === 'error' && (
            <div className="flex flex-row gap-3 rounded-xl bg-red-50 p-4 text-red-700">
              <AlertCircle className="mt-0.5 h-5 w-5 flex-none" />
              <div>
                <p className="font-medium">Could not preview link</p>
                <p className="mt-1 text-sm text-red-600">{errorMsg}</p>
              </div>
            </div>
          )}

          {videoInfo && (
            <div className="border-t border-slate-100 pt-6">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                {videoInfo.thumbnail && (
                  <img
                    src={videoInfo.thumbnail}
                    alt=""
                    className="aspect-video w-full rounded-lg object-cover sm:w-48"
                  />
                )}
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 text-lg font-semibold text-slate-900">{videoInfo.title}</p>
                  <div className="mt-3 flex flex-wrap gap-3 text-sm text-slate-500">
                    {videoInfo.author && (
                      <span className="inline-flex items-center gap-1">
                        <Youtube className="h-4 w-4 text-red-500" />
                        {videoInfo.author}
                      </span>
                    )}
                    <span className="inline-flex items-center gap-1">
                      <Clock className="h-4 w-4 text-slate-400" />
                      Preview only
                    </span>
                  </div>
                  <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                    <a
                      href={currentUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="flex h-10 flex-row items-center justify-center gap-2 rounded-lg border border-slate-300 px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                    >
                      <Youtube className="h-4 w-4" />
                      <span>Open source link</span>
                    </a>
                    <button
                      type="button"
                      onClick={onOpenTranscriber}
                      className="flex h-10 flex-row items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 text-sm font-semibold text-white transition hover:bg-slate-800"
                    >
                      <Upload className="h-4 w-4" />
                      <span>Upload owned file</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </form>

        <div className="border-t border-slate-100 bg-slate-50 p-4 text-center">
          <p className="text-xs text-slate-500">
            Download your own uploads through the source platform first, then upload the media file here.
          </p>
          {url && (
            <button type="button" onClick={clearUrl} className="mt-2 text-xs font-medium text-red-600 hover:text-red-700">
              Clear current link
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function EpubToPdfPage() {
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [status, setStatus] = useState<EpubStatus>('idle');
  const [progressMsg, setProgressMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [results, setResults] = useState<EpubPdfResult[]>([]);
  const [failures, setFailures] = useState<Array<{fileName: string; message: string}>>([]);

  const isEpubFile = (file: File) => {
    return file.name.toLowerCase().endsWith('.epub') || file.type === 'application/epub+zip';
  };

  const applySelectedFiles = (files?: FileList | File[]) => {
    const nextFiles = Array.from(files ?? []);
    if (!nextFiles.length) return;

    if (nextFiles.some((file) => !isEpubFile(file))) {
      setSelectedFiles([]);
      setResults([]);
      setFailures([]);
      setStatus('error');
      setErrorMsg('Please choose only EPUB files.');
      return;
    }

    setSelectedFiles(nextFiles);
    setResults([]);
    setFailures([]);
    setStatus('idle');
    setErrorMsg('');
    setProgressMsg('');
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    applySelectedFiles(event.target.files ?? undefined);
    event.target.value = '';
  };

  const handleFileDrop = (event: React.DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    applySelectedFiles(event.dataTransfer.files);
  };

  const handleConvert = async () => {
    if (!selectedFiles.length) {
      setStatus('error');
      setErrorMsg('Choose one or more EPUB files first.');
      return;
    }

    setStatus('processing');
    setResults([]);
    setFailures([]);
    setErrorMsg('');
    setProgressMsg(`Reading ${formatCount(selectedFiles.length)} EPUB ${selectedFiles.length === 1 ? 'file' : 'files'}...`);

    const convertedResults: EpubPdfResult[] = [];
    const failedResults: Array<{fileName: string; message: string}> = [];

    for (const [index, file] of selectedFiles.entries()) {
      try {
        const currentPosition = `${formatCount(index + 1)} of ${formatCount(selectedFiles.length)}`;
        setProgressMsg(`Converting ${currentPosition}: ${file.name}`);

        const converted = await convertEpubToPdf(file, defaultEpubPdfOptions, (message) => {
          setProgressMsg(`${currentPosition}: ${file.name} - ${message}`);
        });
        convertedResults.push(converted);
        setResults([...convertedResults]);
      } catch (err: any) {
        console.error(err);
        failedResults.push({
          fileName: file.name,
          message: err.message || 'Could not convert this EPUB.',
        });
        setFailures([...failedResults]);
      }
    }

    if (convertedResults.length) {
      setStatus('complete');
      if (failedResults.length) {
        setErrorMsg(`${formatCount(failedResults.length)} EPUB ${failedResults.length === 1 ? 'file' : 'files'} could not be converted.`);
      }
    } else {
      setStatus('error');
      setErrorMsg(failedResults[0]?.message || 'Could not convert these EPUB files.');
    }

    setProgressMsg('');
  };

  const downloadPdf = (pdfResult: EpubPdfResult) => {
    if (!pdfResult) return;

    const url = URL.createObjectURL(pdfResult.blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = pdfResult.filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const handleDownloadAllPdfs = () => {
    results.forEach((pdfResult, index) => {
      window.setTimeout(() => downloadPdf(pdfResult), index * 150);
    });
  };

  const reset = () => {
    setSelectedFiles([]);
    setResults([]);
    setFailures([]);
    setStatus('idle');
    setProgressMsg('');
    setErrorMsg('');
  };

  const selectedFileCount = selectedFiles.length;
  const totalSelectedSizeKb = Math.max(1, Math.round(selectedFiles.reduce((total, file) => total + file.size, 0) / 1024));

  return (
    <div className="mx-auto w-full max-w-3xl space-y-8">
      <div className="text-center">
        <div className="mx-auto flex h-12 w-12 flex-col items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
          <BookOpen className="h-6 w-6" />
        </div>
        <h2 className="mt-4 text-4xl font-extrabold tracking-tight text-slate-900">Free Browser EPUB to PDF Converter</h2>
        <p className="mt-2 text-lg text-slate-600">
          Turn EPUB books into PDF files in your browser.
          <br className="max-sm:hidden" />
          No uploads, no accounts, and private.
        </p>
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-xl">
        <div className="space-y-6 p-8">
          <div className="space-y-3">
            <label className="text-sm font-semibold text-slate-700">EPUB files</label>
            <label
              onDrop={handleFileDrop}
              onDragOver={(event) => event.preventDefault()}
              className="flex min-h-72 w-full cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 px-6 py-8 text-center transition-colors hover:bg-slate-100"
            >
              <Upload className="mb-4 h-12 w-12 text-slate-400" />
              <p className="mb-2 text-lg font-medium text-slate-700">
                <span className="font-semibold text-emerald-600">Choose EPUBs</span> or drag and drop
              </p>
              <p className="max-w-sm text-sm text-slate-500">
                {selectedFileCount
                  ? `${formatCount(selectedFileCount)} EPUB ${selectedFileCount === 1 ? 'file' : 'files'} selected`
                  : 'Books, articles, manuals, and other .epub files'}
              </p>
              <input type="file" accept=".epub,application/epub+zip" multiple className="hidden" onChange={handleFileUpload} />
            </label>
          </div>

          <div className="flex flex-col gap-3 border-t border-slate-100 pt-6 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-h-6 text-sm text-slate-500">
              {selectedFileCount > 0 && (
                <div>
                  <span>
                    {formatCount(selectedFileCount)} EPUB {selectedFileCount === 1 ? 'file' : 'files'} - {formatCount(totalSelectedSizeKb)} KB
                  </span>
                  <ul className="mt-3 max-h-40 overflow-y-auto rounded-lg border border-slate-200 bg-white text-left">
                    {selectedFiles.map((file) => (
                      <li
                        key={`${file.name}-${file.size}-${file.lastModified}`}
                        className="flex flex-col gap-1 border-b border-slate-100 px-3 py-2 last:border-b-0 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <span className="break-all font-medium text-slate-700">{file.name}</span>
                        <span className="flex-none text-xs text-slate-500">
                          {formatCount(Math.max(1, Math.round(file.size / 1024)))} KB
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            <div className="flex flex-col gap-2 sm:flex-row">
              {(selectedFileCount > 0 || results.length > 0 || failures.length > 0) && (
                <button
                  type="button"
                  onClick={reset}
                  className="flex h-12 flex-row items-center justify-center gap-2 rounded-lg border border-slate-300 px-5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                >
                  <RefreshCw className="h-4 w-4" />
                  <span>Reset</span>
                </button>
              )}
              <button
                type="button"
                onClick={handleConvert}
                disabled={status === 'processing'}
                className="flex h-12 flex-row items-center justify-center gap-2 rounded-lg bg-emerald-600 px-5 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {status === 'processing' ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}
                <span>{status === 'processing' ? 'Converting...' : 'Convert to PDF'}</span>
              </button>
            </div>
          </div>

          {status === 'processing' && (
            <div className="flex flex-row gap-3 rounded-xl bg-emerald-50 p-4 text-emerald-700">
              <Loader2 className="mt-0.5 h-5 w-5 flex-none animate-spin" />
              <div>
                <p className="font-medium">Building PDF</p>
                <p className="mt-1 text-sm text-emerald-600">{progressMsg || 'Working through the EPUB...'}</p>
              </div>
            </div>
          )}

          {(status === 'error' || failures.length > 0) && (
            <div className="flex flex-row gap-3 rounded-xl bg-red-50 p-4 text-red-700">
              <AlertCircle className="mt-0.5 h-5 w-5 flex-none" />
              <div>
                <p className="font-medium">{failures.length ? 'Some EPUBs could not be converted' : 'Could not convert EPUB'}</p>
                {failures.length ? (
                  <ul className="mt-2 space-y-1 text-sm text-red-600">
                    {failures.map((failure) => (
                      <li key={failure.fileName}>
                        <span className="font-medium">{failure.fileName}:</span> {failure.message}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-1 text-sm text-red-600">{errorMsg}</p>
                )}
              </div>
            </div>
          )}

          {status === 'complete' && results.length > 0 && (
            <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-5">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="flex flex-row items-center gap-2 text-emerald-700">
                    <CheckCircle className="h-5 w-5" />
                    <p className="font-semibold">{results.length === 1 ? 'PDF ready' : `${formatCount(results.length)} PDFs ready`}</p>
                  </div>
                  <div className="mt-3 space-y-3">
                    {results.map((pdfResult) => (
                      <div key={pdfResult.filename} className="rounded-lg border border-emerald-100 bg-white/80 p-3">
                        <p className="text-sm font-semibold text-emerald-700">
                          {pdfResult.title}
                          {pdfResult.author ? ` by ${pdfResult.author}` : ''}
                        </p>
                        <p className="mt-1 text-xs text-emerald-600">
                          {formatCount(pdfResult.pageCount)} pages - {formatCount(pdfResult.chapterCount)} chapters -{' '}
                          {formatCount(pdfResult.wordCount)} words
                        </p>
                        <button
                          type="button"
                          onClick={() => downloadPdf(pdfResult)}
                          className="mt-3 flex h-10 flex-row items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 text-sm font-semibold text-white transition hover:bg-emerald-700"
                        >
                          <Download className="h-4 w-4" />
                          <span>Download PDF</span>
                        </button>
                      </div>
                    ))}
                  </div>
                </div>

                {results.length > 1 && (
                  <button
                    type="button"
                    onClick={handleDownloadAllPdfs}
                    className="flex h-12 flex-row items-center justify-center gap-2 rounded-lg bg-emerald-600 px-5 text-sm font-semibold text-white transition hover:bg-emerald-700"
                  >
                    <Download className="h-4 w-4" />
                    <span>Download all PDFs</span>
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="border-t border-slate-100 bg-slate-50 p-4 text-center">
          <p className="text-xs text-slate-500">Everything runs in this browser tab. EPUB files are not uploaded.</p>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [activePage, setActivePage] = useState<AppPage>('transcriber');

  const navItems: Array<{page: AppPage; label: string; icon: React.ComponentType<{className?: string}>}> = [
    {page: 'transcriber', label: 'Transcriber', icon: FileText},
    {page: 'youtube', label: 'Video Links', icon: Youtube},
    {page: 'epub', label: 'EPUB to PDF', icon: BookOpen},
  ];

  const renderActivePage = () => {
    if (activePage === 'youtube') return <YoutubePage onOpenTranscriber={() => setActivePage('transcriber')} />;
    if (activePage === 'epub') return <EpubToPdfPage />;

    return <TranscriberPage />;
  };

  return (
    <div className="flex min-h-screen flex-col items-center bg-slate-50 px-4 py-8 font-sans sm:px-6 lg:px-8">
      <div className="w-full max-w-4xl space-y-8">
        <nav className="flex justify-center">
          <div className="inline-flex w-full rounded-xl border border-slate-200 bg-white p-1 shadow-sm sm:w-auto">
            {navItems.map(({page, label, icon: Icon}) => {
              const isActive = activePage === page;

              return (
                <button
                  key={page}
                  type="button"
                  onClick={() => setActivePage(page)}
                  aria-pressed={isActive}
                  className={`flex flex-1 flex-row items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition sm:flex-none ${
                    isActive ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  <span className="whitespace-nowrap">{label}</span>
                </button>
              );
            })}
          </div>
        </nav>

        {renderActivePage()}
      </div>
    </div>
  );
}
