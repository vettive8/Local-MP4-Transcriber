param(
  [string]$BaseUrl = "http://127.0.0.1:3000",
  [int]$SlowMoMs = 500
)

$ErrorActionPreference = "Stop"

$env:PLAYWRIGHT_BASE_URL = $BaseUrl
$env:PLAYWRIGHT_SLOW_MO = "$SlowMoMs"

npx playwright test --headed --workers=1 --project=chromium
