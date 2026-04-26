import express from 'express';
import path from 'path';
import {spawn} from 'child_process';
import {fileURLToPath} from 'url';
import {Readable} from 'stream';
import {Innertube} from 'youtubei.js';
import ffmpegPath from 'ffmpeg-static';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const port = process.env.PORT || 8080;
const distDir = path.join(__dirname, 'dist');
const audioFormats = new Set(['mp3', 'wav']);
const youtubeInfoClients = ['ANDROID', 'IOS', 'MWEB', 'WEB', 'WEB_EMBEDDED', 'TV', 'TV_SIMPLY', 'TV_EMBEDDED', 'ANDROID_VR'];
const youtubeDownloadClients = ['ANDROID', 'IOS', 'MWEB', 'WEB', 'WEB_EMBEDDED', 'TV', 'TV_SIMPLY', 'TV_EMBEDDED', 'ANDROID_VR'];
const maxYoutubeDurationSeconds = Number(process.env.MAX_YOUTUBE_DURATION_SECONDS || 60 * 60 * 2);
let youtubeClientPromise = null;

const getQueryValue = (value) => (typeof value === 'string' ? value.trim() : '');
const getEnvValue = (name) => process.env[name]?.trim() || undefined;

const getYoutubeClient = () => {
  youtubeClientPromise ||= Innertube.create({
    cookie: getEnvValue('YOUTUBE_COOKIE'),
    visitor_data: getEnvValue('YOUTUBE_VISITOR_DATA'),
    po_token: getEnvValue('YOUTUBE_PO_TOKEN'),
  });

  return youtubeClientPromise;
};

const getYoutubeVideoId = (value) => {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase().replace(/^www\./, '');
    const pathParts = url.pathname.split('/').filter(Boolean);

    if (hostname === 'youtu.be') {
      return pathParts[0] || '';
    }

    if (hostname.endsWith('youtube.com') || hostname.endsWith('youtube-nocookie.com')) {
      const watchId = url.searchParams.get('v');
      if (watchId) return watchId;

      if (['embed', 'shorts', 'live'].includes(pathParts[0])) {
        return pathParts[1] || '';
      }
    }
  } catch {
    return '';
  }

  return '';
};

const sanitizeFilename = (value) => {
  const filename = value
    .normalize('NFKD')
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 90);

  return filename || 'youtube-audio';
};

const sendApiError = (res, status, message) => {
  res.status(status).json({error: message});
};

const isYoutubeAuthError = (err) => /login|required|sign in|bot/i.test(err?.message || '');

const getYoutubeErrorMessage = (err, fallback) => {
  if (isYoutubeAuthError(err)) {
    return 'YouTube is requiring authentication for this Cloud Run server. Configure YOUTUBE_COOKIE or YOUTUBE_VISITOR_DATA plus YOUTUBE_PO_TOKEN on the service, then redeploy.';
  }

  return err.message || fallback;
};

const getYoutubeBasicInfo = async (youtube, videoId) => {
  let fallbackInfo = null;
  let lastError = null;

  for (const client of youtubeInfoClients) {
    try {
      const info = await youtube.getBasicInfo(videoId, {client});
      const details = info.basic_info || {};
      fallbackInfo ||= info;

      if (details.title || details.author || details.duration) {
        return info;
      }
    } catch (err) {
      lastError = err;
      console.warn(`YouTube metadata lookup failed with ${client}: ${err.message}`);
    }
  }

  if (fallbackInfo) {
    return fallbackInfo;
  }

  throw lastError || new Error('Could not read the YouTube video.');
};

const getYoutubeOEmbed = async (url) => {
  try {
    const response = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`);

    if (!response.ok) {
      return {};
    }

    return response.json();
  } catch (err) {
    console.warn(`YouTube oEmbed lookup failed: ${err.message}`);
    return {};
  }
};

const getYoutubeMetadata = async (url, info, durationSeconds) => {
  const details = info.basic_info || {};
  const needsFallback = !details.title || !details.author || !details.thumbnail?.length;
  const fallback = needsFallback ? await getYoutubeOEmbed(url) : {};
  const thumbnail = details.thumbnail?.at(-1)?.url || fallback.thumbnail_url || '';

  return {
    title: details.title || fallback.title || 'YouTube audio',
    author: details.author || details.channel?.name || fallback.author_name || '',
    durationSeconds,
    thumbnail,
  };
};

const getYoutubeAudioStream = async (youtube, videoId) => {
  let lastError = null;

  for (const client of youtubeDownloadClients) {
    try {
      const webAudioStream = await youtube.download(videoId, {
        type: 'audio',
        quality: 'best',
        format: 'any',
        client,
      });

      return Readable.fromWeb(webAudioStream);
    } catch (err) {
      lastError = err;
      console.warn(`YouTube audio stream failed with ${client}: ${err.message}`);
    }
  }

  throw lastError || new Error('YouTube did not provide a downloadable audio stream.');
};

const validateYoutubeRequest = async (url) => {
  const videoId = getYoutubeVideoId(url);

  if (!/^[\w-]{11}$/.test(videoId)) {
    const error = new Error('Enter a valid YouTube video URL.');
    error.statusCode = 400;
    throw error;
  }

  const youtube = await getYoutubeClient();
  const info = await getYoutubeBasicInfo(youtube, videoId);
  const durationSeconds = Number(info.basic_info.duration || 0);

  if (durationSeconds > maxYoutubeDurationSeconds) {
    const maxMinutes = Math.round(maxYoutubeDurationSeconds / 60);
    const error = new Error(`This video is longer than the ${maxMinutes}-minute conversion limit.`);
    error.statusCode = 413;
    throw error;
  }

  return {info, durationSeconds, videoId, youtube};
};

app.get('/api/youtube/info', async (req, res) => {
  const url = getQueryValue(req.query.url);

  try {
    const {info, durationSeconds} = await validateYoutubeRequest(url);
    res.json(await getYoutubeMetadata(url, info, durationSeconds));
  } catch (err) {
    console.error(`YouTube info failed: ${err.message}`);
    const status = err.statusCode || (isYoutubeAuthError(err) ? 401 : 502);
    sendApiError(res, status, getYoutubeErrorMessage(err, 'Could not read the YouTube video.'));
  }
});

app.get('/api/youtube/convert', async (req, res) => {
  const url = getQueryValue(req.query.url);
  const format = getQueryValue(req.query.format).toLowerCase();

  if (!audioFormats.has(format)) {
    sendApiError(res, 400, 'Choose MP3 or WAV as the output format.');
    return;
  }

  if (!ffmpegPath) {
    sendApiError(res, 500, 'FFmpeg is not available on this server.');
    return;
  }

  try {
    const {info, videoId, youtube} = await validateYoutubeRequest(url);
    const metadata = await getYoutubeMetadata(url, info, 0);
    const title = sanitizeFilename(metadata.title || 'youtube-audio');
    const filename = `${title}.${format}`;
    const contentType = format === 'mp3' ? 'audio/mpeg' : 'audio/wav';
    const ffmpegArgs =
      format === 'mp3'
        ? ['-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', '-vn', '-codec:a', 'libmp3lame', '-b:a', '192k', '-f', 'mp3', 'pipe:1']
        : ['-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', '-vn', '-codec:a', 'pcm_s16le', '-ar', '44100', '-f', 'wav', 'pipe:1'];

    const audioStream = await getYoutubeAudioStream(youtube, videoId);
    const ffmpeg = spawn(ffmpegPath, ffmpegArgs, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let ffmpegError = '';
    let finished = false;

    const abort = (err) => {
      if (finished) return;
      finished = true;
      audioStream.destroy();
      ffmpeg.kill('SIGKILL');
      res.destroy(err);
    };

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-store');

    audioStream.on('error', abort);
    ffmpeg.on('error', abort);
    ffmpeg.stdin.on('error', () => {});
    ffmpeg.stderr.on('data', (chunk) => {
      ffmpegError += chunk.toString();
    });
    ffmpeg.on('close', (code) => {
      if (finished) return;
      finished = true;

      if (code !== 0 && !res.writableEnded) {
        res.destroy(new Error(ffmpegError.trim() || 'FFmpeg failed to convert the audio.'));
      }
    });
    res.on('close', () => {
      if (!finished) {
        audioStream.destroy();
        ffmpeg.kill('SIGKILL');
      }
    });

    audioStream.pipe(ffmpeg.stdin);
    ffmpeg.stdout.pipe(res);
  } catch (err) {
    console.error(`YouTube conversion failed: ${err.message}`);
    const status = err.statusCode || (isYoutubeAuthError(err) ? 401 : 502);
    sendApiError(res, status, getYoutubeErrorMessage(err, 'Could not convert the YouTube video.'));
  }
});

app.use(
  express.static(distDir, {
    immutable: true,
    maxAge: '1y',
  }),
);

app.get('*', (_req, res) => {
  res.sendFile(path.join(distDir, 'index.html'));
});

app.listen(port, () => {
  console.log(`Listening on port ${port}`);
});
