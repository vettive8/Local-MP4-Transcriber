---
name: project-live-browser-qa
description: Run and extend this repository's Playwright browser tests, including headed live-browser sessions, UI smoke tests, screenshots, and test-fix-retest loops. Use when Codex changes the frontend, Transcriber, YouTube converter, EPUB to PDF flow, local dev server behavior, or needs visible browser QA for this app.
---

# Project Live Browser QA

## Overview

Use this workflow to verify the app as a user would: load the Vite UI, click the main tools, confirm expensive work does not start early, and capture Playwright artifacts when something breaks.

## Commands

Run normal browser smoke tests:

```powershell
npm run test:e2e
```

Run a visible headed pass:

```powershell
npm run test:e2e:headed
```

Run the repo helper with a specific URL and slow motion:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/run-live-browser-tests.ps1 -BaseUrl http://127.0.0.1:3000 -SlowMoMs 500
```

Debug step-by-step:

```powershell
npm run test:live
```

## Coverage Targets

- Transcriber: opening the app must show `Load Whisper model`; `Loading AI Model` must not appear until the user asks to load the model.
- YouTube: the tab is named `YouTube`; it exposes MP3, WAV, and MP4 formats.
- EPUB to PDF: the flow stays simple, with no visible PDF settings panel and a clear `Convert to PDF` action.
- Navigation: all primary tabs should be reachable through accessible buttons.
- Layout: add screenshot assertions or manual screenshots when changing responsive UI, dense tool panels, or generated PDF previews.

## Test-Fix Loop

1. Add or update the Playwright test for the desired user-visible behavior.
2. Run the smallest test first, then fix the implementation.
3. Rerun `npm run test:e2e`.
4. Run headed mode when the failure involves clickability, focus, layout, downloads, or perceived loading behavior.
5. Check `test-results/` and `playwright-report/` for traces and screenshots after failures. These are generated artifacts and should not be committed.

## App Notes

- `playwright.config.ts` starts the dev server with `npm run dev -- --host=127.0.0.1` and reuses an existing server on `http://127.0.0.1:3000`.
- Prefer semantic locators such as `getByRole` and `getByText`; use exact names for repeated controls.
- Keep tests independent: each test should start from `page.goto('/')` and navigate to its own tab.
