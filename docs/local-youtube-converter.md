# Local YouTube to MP4 Guide

The public Cloud Run app does not download YouTube media. Run the project on your own computer when you need to paste a YouTube link and export MP4, MP3, or WAV.

## Prerequisites

- Node.js 22
- Git

## Run Locally

```powershell
git clone https://github.com/vettive8/Local-MP4-Transcriber.git
cd .\Local-MP4-Transcriber
npm ci
npm run local:youtube
```

Open:

```text
http://localhost:8080
```

Then:

1. Open the `YouTube` tab.
2. Paste a YouTube link.
3. Click `Check link`.
4. Choose `MP4`.
5. Click `Download MP4`.

Use this only for videos you own, public-domain media, or content you have permission to download.

## Troubleshooting

If port `8080` is busy:

```powershell
npm run build
$env:PORT='8081'
npm start
```

Then open:

```text
http://localhost:8081
```

If YouTube blocks the request, try again later from your local machine. The public Cloud Run deployment intentionally keeps this feature disabled.
