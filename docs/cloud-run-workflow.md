# Local GitHub and Cloud Run Workflow

This repository is private on GitHub and can be cloned only when you want to work on it locally.

## Daily Development Loop

```powershell
cd C:\Development2\Unplug
git clone https://github.com/vettive8/Local-MP4-Transcriber.git
cd .\Local-MP4-Transcriber
npm ci
npm run dev
```

Use Node.js 22 locally if possible. The Vite React plugin in this project requires Node `20.19+` or `22.12+`.

After making changes:

```powershell
git status
git add .
git commit -m "Describe the change"
git push origin main
```

Before deleting the local folder, make sure `git status` says the working tree is clean and the latest commit has been pushed.

## Cloud Run Publishing

Recommended path: connect the private GitHub repository to Cloud Run continuous deployment.

1. Open Google Cloud Console, then go to Cloud Run.
2. Create or edit the service for this app.
3. Choose continuous deployment from a Git repository.
4. Connect GitHub and grant access to `vettive8/Local-MP4-Transcriber`.
5. Use branch `main`.
6. Use the Node.js buildpack or source deployment from the repository root.
7. Keep the service public only when you are ready for users.

This project now has:

- `npm run build` for the production Vite build.
- `npm start` for Cloud Run to serve the built `dist` folder.
- `.gcloudignore` so local dependencies and secrets are not uploaded.

Manual deploy from a local checkout is also possible:

```powershell
gcloud run deploy local-mp4-transcriber --source . --region REGION --allow-unauthenticated
```

Replace `REGION` with your Cloud Run region, for example `europe-west1` or `us-central1`.

## Environment

No environment variables or API keys are required for local transcription. Transcription runs locally in the browser with transformers.js and Whisper.

The YouTube audio converter runs server-side on Cloud Run. If YouTube requires authentication or attestation for Cloud Run traffic, configure one of these on the Cloud Run service:

- `YOUTUBE_COOKIE`: a YouTube `Cookie` header value from an account that has access to the content.
- `YOUTUBE_VISITOR_DATA` and `YOUTUBE_PO_TOKEN`: a matching visitor data and PO token pair.

Keep these values out of git and rotate them if the account session changes.

The repository still ignores `.env*` files except `.env.example`, so future local experiments do not accidentally get committed.

## Cleanup

After the work is pushed, the local checkout can be removed to save disk space:

```powershell
cd C:\Development2\Unplug
Remove-Item -LiteralPath '.\Local-MP4-Transcriber' -Recurse -Force
```

To work again later, clone the repository again from GitHub.

## References

- Cloud Run continuous deployment from Git: https://cloud.google.com/run/docs/continuous-deployment
- Cloud Run deploy from source: https://cloud.google.com/run/docs/deploying-source-code
- Google Cloud Node.js buildpacks: https://cloud.google.com/docs/buildpacks/nodejs
