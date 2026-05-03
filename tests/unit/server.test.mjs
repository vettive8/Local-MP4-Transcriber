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

test('MP4 conversion uses the validated YouTube info before extra player lookups', async () => {
  let basicInfoCalls = 0;
  let fallbackDownloadCalls = 0;
  const infoDownloadOptions = [];
  const makeStream = () =>
    new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]));
        controller.close();
      },
    });
  const fakeInfo = {
    basic_info: {
      title: 'Cached MP4',
      duration: 12,
    },
    download: async (options) => {
      infoDownloadOptions.push(options);
      return makeStream();
    },
  };
  const fakeYoutube = {
    getBasicInfo: async (videoId, options) => {
      basicInfoCalls += 1;
      assert.equal(videoId, 'dQw4w9WgXcQ');
      assert.equal(options.client, 'ANDROID');
      return fakeInfo;
    },
    download: async () => {
      fallbackDownloadCalls += 1;
      throw new Error('The fallback client loop should not run.');
    },
  };
  const app = createApp({youtubeClientFactory: async () => fakeYoutube});
  const server = app.listen(0);

  try {
    const {port} = server.address();
    const response = await fetch(
      `http://127.0.0.1:${port}/api/youtube/convert?format=mp4&url=${encodeURIComponent('https://youtu.be/dQw4w9WgXcQ')}`,
    );

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'video/mp4');
    assert.equal(response.headers.get('content-disposition'), 'attachment; filename="Cached MP4.mp4"');
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), new Uint8Array([1, 2, 3]));
    assert.equal(basicInfoCalls, 1);
    assert.equal(fallbackDownloadCalls, 0);
    assert.deepEqual(infoDownloadOptions, [
      {
        type: 'video+audio',
        quality: 'best',
        format: 'mp4',
      },
    ]);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
