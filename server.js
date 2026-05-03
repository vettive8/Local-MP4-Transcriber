import express from 'express';
import path from 'path';
import {fileURLToPath} from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const port = process.env.PORT || 8080;
const distDir = path.join(__dirname, 'dist');

const getQueryValue = (value) => (typeof value === 'string' ? value.trim() : '');

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

const getYoutubeOEmbed = async (url) => {
  try {
    const response = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`);

    if (!response.ok) {
      throw new Error(`oEmbed returned ${response.status}`);
    }

    return response.json();
  } catch (err) {
    console.warn(`YouTube oEmbed lookup failed: ${err.message}`);
    const error = new Error('Could not preview that YouTube link.');
    error.statusCode = 502;
    throw error;
  }
};

const getYoutubeMetadata = async (url) => {
  const metadata = await getYoutubeOEmbed(url);

  return {
    title: metadata.title || 'YouTube video',
    author: metadata.author_name || '',
    thumbnail: metadata.thumbnail_url || '',
  };
};

const validateYoutubeUrl = (url) => {
  const videoId = getYoutubeVideoId(url);

  if (!/^[\w-]{11}$/.test(videoId)) {
    const error = new Error('Enter a valid YouTube video URL.');
    error.statusCode = 400;
    throw error;
  }

  return videoId;
};

export const createApp = () => {
  const app = express();

  app.get('/api/health', (_req, res) => {
    res.json({status: 'ok'});
  });

  app.get('/api/youtube/info', async (req, res) => {
    const url = getQueryValue(req.query.url);

    try {
      validateYoutubeUrl(url);
      res.json(await getYoutubeMetadata(url));
    } catch (err) {
      console.error(`YouTube info failed: ${err.message}`);
      const status = err.statusCode || 502;
      sendApiError(res, status, err.message || 'Could not read the YouTube video.');
    }
  });

  app.get('/api/youtube/convert', (_req, res) => {
    sendApiError(
      res,
      410,
      'Public YouTube downloads are disabled. Upload media files you own or use a direct download source with explicit permission.',
    );
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
