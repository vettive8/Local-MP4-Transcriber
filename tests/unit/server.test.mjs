import assert from 'node:assert/strict';
import test from 'node:test';

import {createApp, getYoutubeVideoId, sanitizeFilename} from '../../server.js';

test('extracts supported YouTube video ids', () => {
  assert.equal(getYoutubeVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(getYoutubeVideoId('https://youtu.be/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(getYoutubeVideoId('https://www.youtube.com/shorts/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(getYoutubeVideoId('https://example.com/watch?v=dQw4w9WgXcQ'), '');
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

test('public YouTube conversion endpoint is disabled', async () => {
  const app = createApp();
  const server = app.listen(0);

  try {
    const {port} = server.address();
    const response = await fetch(
      `http://127.0.0.1:${port}/api/youtube/convert?format=mp4&url=${encodeURIComponent('https://youtu.be/dQw4w9WgXcQ')}`,
    );
    assert.equal(response.status, 410);
    assert.match((await response.json()).error, /Public YouTube downloads are disabled/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('YouTube info endpoint returns oEmbed preview metadata', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url).startsWith('http://127.0.0.1:')) {
      return originalFetch(url, init);
    }

    assert.match(String(url), /youtube\.com\/oembed/);

    return new Response(
      JSON.stringify({
        title: 'Preview Title',
        author_name: 'Preview Author',
        thumbnail_url: 'https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
      }),
      {status: 200, headers: {'Content-Type': 'application/json'}},
    );
  };

  const app = createApp();
  const server = app.listen(0);

  try {
    const {port} = server.address();
    const response = await fetch(
      `http://127.0.0.1:${port}/api/youtube/info?url=${encodeURIComponent('https://youtu.be/dQw4w9WgXcQ')}`,
    );

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      title: 'Preview Title',
      author: 'Preview Author',
      thumbnail: 'https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    globalThis.fetch = originalFetch;
  }
});
