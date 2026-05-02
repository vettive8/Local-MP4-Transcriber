import assert from 'node:assert/strict';
import test from 'node:test';

import {createApp, getYoutubeVideoId, sanitizeFilename, youtubeFormats} from '../../server.js';

test('extracts supported YouTube video ids', () => {
  assert.equal(getYoutubeVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(getYoutubeVideoId('https://youtu.be/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(getYoutubeVideoId('https://www.youtube.com/shorts/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(getYoutubeVideoId('https://example.com/watch?v=dQw4w9WgXcQ'), '');
});

test('supports YouTube MP3, WAV, and MP4 formats', () => {
  assert.deepEqual([...youtubeFormats].sort(), ['mp3', 'mp4', 'wav']);
});

test('sanitizes download filenames', () => {
  assert.equal(sanitizeFilename('  Bad:/Name?  '), 'BadName');
  assert.equal(sanitizeFilename(''), 'youtube-download');
});

test('health endpoint returns ok without touching YouTube', async () => {
  const app = createApp();
  const server = app.listen(0);

  try {
    const {port} = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/api/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {status: 'ok'});
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('invalid YouTube format is rejected before network work', async () => {
  const app = createApp();
  const server = app.listen(0);

  try {
    const {port} = server.address();
    const response = await fetch(
      `http://127.0.0.1:${port}/api/youtube/convert?format=bad&url=${encodeURIComponent('https://youtu.be/dQw4w9WgXcQ')}`,
    );
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /MP3, WAV, or MP4/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
