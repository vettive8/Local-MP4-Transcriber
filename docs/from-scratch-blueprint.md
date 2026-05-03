# From-Scratch Blueprint

This app is three tools behind one small shell:

- Transcriber: browser loads Whisper on demand and turns a local video file into text.
- Video Links: server reads YouTube oEmbed metadata for preview only; conversion uses user-provided media files.
- EPUB to PDF: browser reads an EPUB zip and generates a PDF without uploads.

If I were building it from scratch today, I would keep those tools separated from day one. Each tool gets its own state, actions, tests, and boundary with the browser or server.

## Target Shape

```text
src/
  app/
    App.tsx              # tab shell only
    appConfig.ts         # default tool settings
    appHelpers.ts        # shared browser helpers
    appTypes.ts          # shared UI/domain types
  tools/
    transcriber/
      TranscriberPage.tsx
      transcriberWorker.ts
      transcriptFormat.ts
    videoLinks/
      VideoLinksPage.tsx
      videoLinkClient.ts
      videoLinkTypes.ts
    epub/
      EpubToPdfPage.tsx
      epubToPdf.ts
      pdfTextLayout.ts
server/
  app.js                 # Express setup
  video-links/
    routes.js
    oembedClient.js
tests/
  unit/
  e2e/
```

The current codebase is moving toward that shape. `src/appTypes.ts`, `src/appConfig.ts`, and `src/appHelpers.ts` are the first cleanup step; next, each page should move out of `src/App.tsx`.

## Build Order

1. Create the app shell.
- Vite + React + TypeScript.
- One `App` component that only knows the active tab and renders the selected tool.
- Playwright smoke test: every tab opens.

2. Build Transcriber.
- Start with a worker contract: `load`, `progress`, `ready`, `transcribe`, `complete`, `error`.
- Make model loading an explicit button so opening the app does not download Whisper.
- Keep transcript formatting as pure functions with unit tests.

3. Build EPUB to PDF.
- Treat EPUB as a zip: find `META-INF/container.xml`, then the OPF package, then the spine.
- Extract readable blocks: headings, paragraphs, list items, blockquotes, and images.
- Keep PDF layout helpers pure where possible; test line wrapping and filename behavior.
- Browser e2e should upload a generated mini EPUB and verify a PDF download.

4. Build Video Links.
- Keep public YouTube handling preview-only; do not fetch media bytes on the server.
- Split the server into request validation and oEmbed metadata lookup.
- Test invalid URL handling and the disabled conversion endpoint without touching YouTube media streams.

5. Add delivery.
- CI runs typecheck, unit tests, build, and Playwright.
- Cloud Run deploys only after CI passes on `main`.
- Keep `legacy/stable-*` branches as recovery points before large refactors.

## What Every Layer Owns

- UI components own rendering and user interactions.
- Hooks own browser stateful workflows such as workers, downloads, and progress.
- Pure helpers own formatting, parsing, validation, wrapping, and filenames.
- Server routes own HTTP shape only.
- Server services own preview metadata only; media conversion starts from user-provided files.
- Tests describe the behavior users care about before refactors move code around.

## Modernization Plan

Do these as separate commits so each step is easy to understand and revert:

1. Extract shared app helpers and config.
2. Move each page component into `src/tools/<tool>/`.
3. Move the transcription worker into the transcriber tool folder.
4. Split `server.js` into `server/app.js` and `server/video-links/*`.
5. Add unit tests for transcript formatting and video-link preview behavior.
6. Standardize Node 22 locally, in CI, and on Cloud Run.
7. Consider major upgrades separately:
- Express 5: route and middleware behavior can change.
- TypeScript 6: compiler strictness and ecosystem support need a focused pass.
- Lucide 1.x: verify icon exports and bundle output.

## Learning Path

To know the code like you wrote it yourself, read it in this order:

1. `src/main.tsx`: how React starts.
2. `src/App.tsx`: how the shell chooses a tool.
3. `src/appTypes.ts`: the app vocabulary.
4. `src/appHelpers.ts`: shared browser utilities.
5. `src/worker.ts`: how Whisper runs off the main thread.
6. `src/epubToPdf.ts`: how an EPUB becomes structured blocks and then PDF pages.
7. `server.js`: how the backend serves the app and preview routes.
8. `tests/e2e/app-smoke.spec.ts`: the user-visible promises we protect.
