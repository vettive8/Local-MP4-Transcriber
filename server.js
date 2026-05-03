import express from 'express';
import path from 'path';
import {spawn} from 'child_process';
import {fileURLToPath} from 'url';
import {Readable} from 'stream';
import {Innertube} from 'youtubei.js';
import ffmpegPath from 'ffmpeg-static';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const port = process.env.PORT || 8080;
const distDir = path.join(__dirname, 'dist');
export const youtubeFormats = new Set(['mp3', 'wav', 'mp4']);
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

export const getYoutubeVideoId = (value) => {
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

export const sanitizeFilename = (value) => {
  const filename = value
    .normalize('NFKD')
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 90);

  return filename || 'youtube-download';
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
      fallbackInfo ||= {info};

      if (details.title || details.author || details.duration) {
        return {info};
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
    title: details.title || fallback.title || 'YouTube video',
    author: details.author || details.channel?.name || fallback.author_name || '',
    durationSeconds,
    thumbnail,
  };
};

const getYoutubeAudioStream = async (info, youtube, videoId) => {
  const downloadOptions = {
    type: 'audio',
    quality: 'best',
    format: 'any',
  };
  let lastError = null;

  try {
    const webAudioStream = await info.download(downloadOptions);
    return Readable.fromWeb(webAudioStream);
  } catch (err) {
    lastError = err;
    console.warn(`YouTube audio stream failed with validated metadata: ${err.message}`);
  }

  for (const client of youtubeDownloadClients) {
    try {
      const webAudioStream = await youtube.download(videoId, {
        ...downloadOptions,
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

const getYoutubeVideoStream = async (info, youtube, videoId) => {
  const downloadOptions = {
    type: 'video',
    quality: 'best',
    format: 'mp4',
  };
  let lastError = null;

  try {
    const webVideoStream = await info.download(downloadOptions);
    return Readable.fromWeb(webVideoStream);
  } catch (err) {
    lastError = err;
    console.warn(`YouTube MP4 stream failed with validated metadata: ${err.message}`);
  }

  for (const client of youtubeDownloadClients) {
    try {
      const webVideoStream = await youtube.download(videoId, {
        ...downloadOptions,
        client,
      });

      return Readable.fromWeb(webVideoStream);
    } catch (err) {
      lastError = err;
      console.warn(`YouTube MP4 stream failed with ${client}: ${err.message}`);
    }
  }

  throw lastError || new Error('YouTube did not provide a downloadable MP4 stream.');
};

const validateYoutubeRequest = async (url, youtubeClientFactory = getYoutubeClient) => {
  const videoId = getYoutubeVideoId(url);

  if (!/^[\w-]{11}$/.test(videoId)) {
    const error = new Error('Enter a valid YouTube video URL.');
    error.statusCode = 400;
    throw error;
  }

  const youtube = await youtubeClientFactory();
  const {info} = await getYoutubeBasicInfo(youtube, videoId);
  const durationSeconds = Number(info.basic_info.duration || 0);

  if (durationSeconds > maxYoutubeDurationSeconds) {
    const maxMinutes = Math.round(maxYoutubeDurationSeconds / 60);
    const error = new Error(`This video is longer than the ${maxMinutes}-minute conversion limit.`);
    error.statusCode = 413;
    throw error;
  }

  return {info, durationSeconds, videoId, youtube};
};

export const createApp = ({
  youtubeClientFactory = getYoutubeClient,
  ffmpegPathOverride = ffmpegPath,
  spawnProcess = spawn,
} = {}) => {
  const app = express();

  app.get('/api/health', (_req, res) => {
    res.json({status: 'ok'});
  });

  app.get('/api/youtube/info', async (req, res) => {
    const url = getQueryValue(req.query.url);

    try {
      const {info, durationSeconds} = await validateYoutubeRequest(url, youtubeClientFactory);
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

    if (!youtubeFormats.has(format)) {
      sendApiError(res, 400, 'Choose MP3, WAV, or MP4 as the output format.');
      return;
    }

    if (!ffmpegPathOverride) {
      sendApiError(res, 500, 'FFmpeg is not available on this server.');
      return;
    }

    try {
      const {info, videoId, youtube} = await validateYoutubeRequest(url, youtubeClientFactory);
      const metadata = await getYoutubeMetadata(url, info, 0);
      const title = sanitizeFilename(metadata.title || 'youtube-download');
      const filename = `${title}.${format}`;
      const contentTypes = {
        mp3: 'audio/mpeg',
        wav: 'audio/wav',
        mp4: 'video/mp4',
      };
      const contentType = contentTypes[format];

      if (format === 'mp4') {
        const videoStream = await getYoutubeVideoStream(info, youtube, videoId);
        const audioStream = await getYoutubeAudioStream(info, youtube, videoId);
        const ffmpeg = spawnProcess(
          ffmpegPathOverride,
          [
            '-hide_banner',
            '-loglevel',
            'error',
            '-i',
            'pipe:3',
            '-i',
            'pipe:4',
            '-map',
            '0:v:0',
            '-map',
            '1:a:0',
            '-c:v',
            'copy',
            '-c:a',
            'aac',
            '-b:a',
            '192k',
            '-movflags',
            'frag_keyframe+empty_moov',
            '-f',
            'mp4',
            'pipe:1',
          ],
          {
            stdio: ['ignore', 'pipe', 'pipe', 'pipe', 'pipe'],
          },
        );
        let ffmpegError = '';
        let finished = false;
        const videoInput = ffmpeg.stdio[3];
        const audioInput = ffmpeg.stdio[4];

        if (!videoInput || !audioInput) {
          throw new Error('FFmpeg input pipes are unavailable.');
        }

        const abort = (err) => {
          if (finished) return;
          finished = true;
          videoStream.destroy();
          audioStream.destroy();
          videoInput?.destroy();
          audioInput?.destroy();
          ffmpeg.kill('SIGKILL');
          res.destroy(err);
        };

        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Cache-Control', 'no-store');

        videoStream.on('error', abort);
        audioStream.on('error', abort);
        ffmpeg.on('error', abort);
        videoInput?.on('error', () => {});
        audioInput?.on('error', () => {});
        ffmpeg.stderr.on('data', (chunk) => {
          ffmpegError += chunk.toString();
        });
        ffmpeg.on('close', (code) => {
          if (finished) return;
          finished = true;

          if (code !== 0 && !res.writableEnded) {
            res.destroy(new Error(ffmpegError.trim() || 'FFmpeg failed to mux the MP4.'));
          }
        });
        res.on('close', () => {
          if (!finished) {
            videoStream.destroy();
            audioStream.destroy();
            ffmpeg.kill('SIGKILL');
          }
        });

        videoStream.pipe(videoInput);
        audioStream.pipe(audioInput);
        ffmpeg.stdout.pipe(res);
        return;
      }

      const ffmpegArgs =
        format === 'mp3'
          ? ['-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', '-vn', '-codec:a', 'libmp3lame', '-b:a', '192k', '-f', 'mp3', 'pipe:1']
          : ['-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', '-vn', '-codec:a', 'pcm_s16le', '-ar', '44100', '-f', 'wav', 'pipe:1'];

      const audioStream = await getYoutubeAudioStream(info, youtube, videoId);
      const ffmpeg = spawnProcess(ffmpegPathOverride, ffmpegArgs, {
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
      index: false,
      maxAge: '1y',
    }),
  );

  app.get('*', (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.sendFile(path.join(distDir, 'index.html'));
  });

  return app;
};

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  createApp().listen(port, () => {
    console.log(`Listening on port ${port}`);
  });
}
