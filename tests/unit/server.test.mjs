import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
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

test('MP4 conversion muxes validated YouTube video and audio streams', async () => {
  let basicInfoCalls = 0;
  let fallbackDownloadCalls = 0;
  const infoDownloadOptions = [];
  const makeStream = (bytes) =>
    new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(bytes));
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
      return makeStream(options.type === 'video' ? [1, 2, 3] : [4, 5, 6]);
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
  const spawnCalls = [];
  const fakeSpawn = (command, args, options) => {
    spawnCalls.push({command, args, options});

    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.stdio = [null, child.stdout, child.stderr, new PassThrough(), new PassThrough()];
    child.kill = () => {
      child.killed = true;
    };

    let closedInputs = 0;
    const closeIfMuxed = () => {
      closedInputs += 1;

      if (closedInputs === 2) {
        child.stdout.end(Buffer.from([7, 8, 9]));
        setImmediate(() => child.emit('close', 0));
      }
    };

    child.stdio[3].on('finish', closeIfMuxed);
    child.stdio[4].on('finish', closeIfMuxed);
    return child;
  };
  const app = createApp({
    youtubeClientFactory: async () => fakeYoutube,
    ffmpegPathOverride: 'fake-ffmpeg',
    spawnProcess: fakeSpawn,
  });
  const server = app.listen(0);

  try {
    const {port} = server.address();
    const response = await fetch(
      `http://127.0.0.1:${port}/api/youtube/convert?format=mp4&url=${encodeURIComponent('https://youtu.be/dQw4w9WgXcQ')}`,
    );

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'video/mp4');
    assert.equal(response.headers.get('content-disposition'), 'attachment; filename="Cached MP4.mp4"');
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), new Uint8Array([7, 8, 9]));
    assert.equal(basicInfoCalls, 1);
    assert.equal(fallbackDownloadCalls, 0);
    assert.deepEqual(infoDownloadOptions, [
      {
        type: 'video',
        quality: 'best',
        format: 'mp4',
      },
      {
        type: 'audio',
        quality: 'best',
        format: 'any',
      },
    ]);
    assert.equal(spawnCalls.length, 1);
    assert.equal(spawnCalls[0].command, 'fake-ffmpeg');
    assert.deepEqual(spawnCalls[0].options.stdio, ['ignore', 'pipe', 'pipe', 'pipe', 'pipe']);
    assert.deepEqual(spawnCalls[0].args, [
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
    ]);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
