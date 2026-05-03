<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Browser Media Tools

Browser-first tools for transcription, local YouTube downloads, and EPUB to PDF conversion.

No paid APIs or app accounts are required. Transcription and EPUB conversion run in the browser tab. YouTube conversion is available only when you run this project on localhost.

View your app in AI Studio: https://ai.studio/apps/f9687355-65a2-46f2-ac25-33ceeb50e5cc

## Run Locally

**Prerequisites:** Node.js 22

1. Install dependencies:
   `npm install`
2. Run the app:
   `npm run dev`

For local YouTube to MP4/MP3/WAV conversion, run the full local server:

```powershell
npm ci
npm run local:youtube
```

Then open `http://localhost:8080`.

See [docs/local-youtube-converter.md](docs/local-youtube-converter.md) for the step-by-step walkthrough.

## Architecture

- `src/App.tsx` owns the React UI and tool navigation for Transcriber, YouTube, and EPUB to PDF.
- `src/appTypes.ts`, `src/appConfig.ts`, and `src/appHelpers.ts` hold shared UI vocabulary, defaults, and browser helpers.
- `src/epubToPdf.ts` converts EPUB files in the browser with JSZip and jsPDF.
- `src/pdfTextLayout.js` contains testable PDF text wrapping helpers.
- `server.js` serves the production build and exposes `/api/youtube/*` for YouTube metadata and local-only MP3/WAV/MP4 conversion.
- `tests/unit/` covers server helpers and PDF layout logic.
- `tests/e2e/` covers browser flows with Playwright, including a generated EPUB-to-PDF download.
- `.github/workflows/` runs CI and deploys Cloud Run after CI succeeds on `main`.

See [docs/from-scratch-blueprint.md](docs/from-scratch-blueprint.md) for the ground-up rebuild plan and learning path.

## Testing

```powershell
npm run lint
npm run test:unit
npm run build
npm run test:e2e
```

For visible browser QA:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\run-live-browser-tests.ps1
```

## Publish from GitHub to Cloud Run

This app can be worked on locally, pushed to the private GitHub repository, and published from GitHub to Cloud Run.

See [docs/cloud-run-workflow.md](docs/cloud-run-workflow.md) for the local Git workflow, Cloud Run setup, and cleanup steps.
