# Product help browser E2E

`productHelp.mjs` sends actual chat and task requests through the UI, waits for stored messages through the public API, and checks that the answer remains visible after a full reload. It covers Korean/English web-search help and ambiguous app questions (six cases). It does not mock requests, Kafka, the model, or persistence.

Use a dedicated account and **empty workspace** on a test stack running the coordinated AI, document, and frontend changes. The account must be able to create chat sessions; each case gets its own empty session so earlier product-help answers cannot resolve the ambiguous-app cases. The product allows at most 10 chat sessions per workspace. The script leaves its sessions and screenshots available for inspection.

Install the test-only runner without changing package manifests, from `web/`:

```sh
npm install --no-save --package-lock=false playwright
npx playwright install chromium
```

Set `E2E_BASE_URL`, `E2E_EMAIL`, `E2E_PASSWORD`, and `E2E_WORKSPACE_ID` in your shell, then run:

```sh
node e2e/productHelp.mjs
```

`E2E_OUTPUT_DIR` defaults to `/tmp/product-help-e2e`. An existing Chromium binary can be selected with `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`. The script writes answer records and before/reload screenshots, never authentication tokens or browser storage.

The browser uses the account's selected model; the recorded run used OpenAI GPT-6 Luna. Running this script makes real model calls.
