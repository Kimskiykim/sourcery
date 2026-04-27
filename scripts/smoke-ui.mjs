import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { chromium } from "playwright";

import { createAppContext, startAppServer } from "../dist/server.js";

const host = process.env.HOST || "127.0.0.1";
const port = Number(process.env.PORT || String(4300 + Math.floor(Math.random() * 1000)));
const baseUrl = `http://${host}:${port}`;
const tempRoot = await mkdtemp(path.join(os.tmpdir(), "sourcery-smoke-"));
const context = createAppContext({
  rootDir: process.cwd(),
  distDir: path.join(process.cwd(), "dist"),
  vaultDir: path.join(tempRoot, "vault"),
  appStateDir: path.join(tempRoot, ".obsidian-lite"),
});

const { server, watcher } = await startAppServer({
  context,
  host,
  port,
  watchVault: true,
});

try {
  const browser = await chromium.launch();
  try {
    await runViewportSmoke(browser, { width: 1280, height: 900 }, "desktop", {
      editAndFlush: true,
    });
    await runViewportSmoke(browser, { width: 820, height: 900 }, "narrow", {
      editAndFlush: false,
    });
  } finally {
    await browser.close();
  }

  console.log(`UI smoke passed at ${baseUrl}`);
} finally {
  watcher?.close();
  context.connectionWatcher?.close();
  await new Promise((resolve) => server.close(resolve));
  await rm(tempRoot, { recursive: true, force: true });
}

async function runViewportSmoke(browser, viewport, label, options) {
  const pageContext = await browser.newContext({ viewport });
  await pageContext.route("https://fonts.googleapis.com/**", (route) =>
    route.fulfill({ status: 200, contentType: "text/css", body: "" })
  );
  await pageContext.route("https://fonts.gstatic.com/**", (route) =>
    route.fulfill({ status: 204, body: "" })
  );
  const page = await pageContext.newPage();
  const consoleErrors = [];
  const pageErrors = [];

  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });
  page.on("pageerror", (error) => {
    pageErrors.push(error.message);
  });

  try {
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await expectVisible(page.getByTestId("note-list"), `${label}: note list`);
    await expectVisible(page.getByTestId("note-search"), `${label}: search`);

    const welcome = page.getByTestId("note-list").getByRole("button", { name: "Welcome" });
    await expectCount(welcome, 1, `${label}: Welcome note`);
    await welcome.click();
    await expectInputValue(page.getByTestId("note-title"), "Welcome", `${label}: Welcome title`);
    await expectVisible(page.getByTestId("note-editor"), `${label}: editor`);
    await expectVisible(page.getByTestId("preview-pane"), `${label}: preview pane`);

    if (options.editAndFlush) {
      const editor = page.getByTestId("note-editor");
      const originalContent = await editor.inputValue();
      const editedContent = `${originalContent.trimEnd()}\n\nSmoke flush marker`;
      await editor.fill(editedContent);
      await expectText(page.getByTestId("save-state"), /unsaved|несохран/i, `${label}: dirty status`);

      const ideas = page.getByTestId("note-list").getByRole("button", { name: "Ideas" });
      await expectCount(ideas, 1, `${label}: Ideas note`);
      await ideas.click();
      await expectInputValue(page.getByTestId("note-title"), "Ideas", `${label}: switched title`);

      await welcome.click();
      await expectInputValue(page.getByTestId("note-title"), "Welcome", `${label}: returned title`);
      await expectInputValue(editor, editedContent, `${label}: flushed editor content`);
    }

    await page.getByTestId("note-search").fill("Welcome");
    await expectVisible(welcome, `${label}: searched Welcome note`);
    await page.getByTestId("note-search").fill("");

    await page.getByTestId("activity-graph").click();
    await expectVisible(page.getByTestId("graph-pane"), `${label}: graph pane`);
    await expectText(page.locator("#graph-stats"), /граф|graph|замет|note/i, `${label}: graph stats`);

    await page.getByTestId("activity-memory").click();
    await expectVisible(page.getByTestId("memory-layout"), `${label}: memory layout`);
    await expectText(page.getByTestId("memory-layout"), /memory|память/i, `${label}: memory content`);

    if (consoleErrors.length > 0 || pageErrors.length > 0) {
      throw new Error([
        `${label}: browser errors detected`,
        ...consoleErrors.map((item) => `console: ${item}`),
        ...pageErrors.map((item) => `page: ${item}`),
      ].join("\n"));
    }
  } finally {
    await pageContext.close();
  }
}

async function expectVisible(locator, label) {
  await locator.waitFor({ state: "visible", timeout: 5_000 }).catch((error) => {
    throw new Error(`${label} was not visible: ${error.message}`);
  });
}

async function expectCount(locator, expected, label) {
  const actual = await locator.count();
  if (actual !== expected) {
    throw new Error(`${label} expected ${expected} match(es), got ${actual}`);
  }
}

async function expectInputValue(locator, expected, label) {
  await expectVisible(locator, label);
  const deadline = Date.now() + 5_000;
  let actual = "";

  while (Date.now() < deadline) {
    actual = await locator.inputValue();
    if (actual === expected) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(`${label} expected value ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

async function expectText(locator, pattern, label) {
  await expectVisible(locator, label);
  const text = await locator.innerText();
  if (!pattern.test(text)) {
    throw new Error(`${label} did not match ${pattern}: ${JSON.stringify(text)}`);
  }
}
