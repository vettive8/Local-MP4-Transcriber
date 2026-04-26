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
const maxYoutubeDurationSeconds = Number(process.env.MAX_YOUTUBE_DURATION_SECONDS || 60 * 60 * 2);
let youtubeClientPromise = null;

const getQueryValue = (value) => (typeof value === 'string' ? value.trim() : '');

const getYoutubeClient = () => {
  youtubeClientPromise ||= Innertube.create();
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

const validateYoutubeRequest = async (url) => {
  const videoId = getYoutubeVideoId(url);

  if (!/^[\w-]{11}$/.test(videoId)) {
    const error = new Error('Enter a valid YouTube video URL.');
    error.statusCode = 400;
    throw error;
  }

  const youtube = await getYoutubeClient();
  const info = await youtube.getBasicInfo(videoId, {client: 'IOS'});
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
    const details = info.basic_info;
    const thumbnail = details.thumbnail?.at(-1)?.url || '';

    res.json({
      title: details.title,
      author: details.author || details.channel?.name || '',
      durationSeconds,
      thumbnail,
    });
  } catch (err) {
    const status = err.statusCode || 502;
    sendApiError(res, status, err.message || 'Could not read the YouTube video.');
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
    const title = sanitizeFilename(info.basic_info.title || 'youtube-audio');
    const filename = `${title}.${format}`;
    const contentType = format === 'mp3' ? 'audio/mpeg' : 'audio/wav';
    const ffmpegArgs =
      format === 'mp3'
        ? ['-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', '-vn', '-codec:a', 'libmp3lame', '-b:a', '192k', '-f', 'mp3', 'pipe:1']
        : ['-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', '-vn', '-codec:a', 'pcm_s16le', '-ar', '44100', '-f', 'wav', 'pipe:1'];

    const webAudioStream = await youtube.download(videoId, {
      type: 'audio',
      quality: 'best',
      format: 'any',
      client: 'IOS',
    });
    const audioStream = Readable.fromWeb(webAudioStream);
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
    const status = err.statusCode || 502;
    sendApiError(res, status, err.message || 'Could not convert the YouTube video.');
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
