<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/f9687355-65a2-46f2-ac25-33ceeb50e5cc

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

## Publish from GitHub to Cloud Run

This app can be worked on locally, pushed to the private GitHub repository, and published from GitHub to Cloud Run.

See [docs/cloud-run-workflow.md](docs/cloud-run-workflow.md) for the local Git workflow, Cloud Run setup, and cleanup steps.
