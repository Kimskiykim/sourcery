import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { chromium } from "playwright";

import { createAppContext, startAppServer } from "../dist/server.js";

const host = process.env.HOST || "127.0.0.1";
const port = Number(process.env.PORT || String(4300 + Math.floor(Math.random() * 1000)));
const baseUrl = `http://${host}:${port}`;
const tempRoot = await mkdtemp(path.join(os.tmpdir(), "sourcery-smoke-"));
const vaultDir = path.join(tempRoot, "vault");
await seedSmokeVault(vaultDir);
const context = createAppContext({
  rootDir: process.cwd(),
  distDir: path.join(process.cwd(), "dist"),
  vaultDir,
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
    await expectLargeGraphCanvas(page, `${label}: large graph canvas`);
    await setGraphLens(page, "orphans", `${label}: orphans lens`);
    await expectGraphLensMetrics(page, `${label}: orphans lens`, {
      minNodes: 100,
      maxEdges: 0,
      maxLabelsRatio: 0.25,
    });
    await setGraphLens(page, "agent-context", `${label}: agent context lens`);
    await expectGraphLensMetrics(page, `${label}: agent context lens`, {
      minNodes: 5,
      maxNodes: 12,
      maxEdges: 2,
    });

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

async function seedSmokeVault(vaultDir) {
  await mkdir(path.join(vaultDir, "archive"), { recursive: true });
  await mkdir(path.join(vaultDir, "projects"), { recursive: true });
  await mkdir(path.join(vaultDir, "hybrid", "context"), { recursive: true });
  await mkdir(path.join(vaultDir, "hybrid", "tasks"), { recursive: true });
  await writeFile(
    path.join(vaultDir, "Welcome.md"),
    "# Welcome\n\nSee [[Ideas]] and [[projects/Linked 01]].\n",
    "utf8"
  );
  await writeFile(
    path.join(vaultDir, "Ideas.md"),
    "# Ideas\n\nBack to [[Welcome]].\n",
    "utf8"
  );
  await writeFile(path.join(vaultDir, "AGENTS.md"), "# AGENTS\n\nGraph lens smoke.", "utf8");
  await writeFile(path.join(vaultDir, "README.md"), "# README\n\nProject context.", "utf8");
  await writeFile(path.join(vaultDir, "CLAUDE.md"), "# CLAUDE\n\nAssistant context.", "utf8");
  await writeFile(path.join(vaultDir, "hybrid", "README.md"), "# Hybrid\n\nHybrid context.", "utf8");
  await writeFile(
    path.join(vaultDir, "hybrid", "context", "DECISIONS.md"),
    "# Decisions\n\nArchitecture decisions live here.\n",
    "utf8"
  );
  await writeFile(
    path.join(vaultDir, "hybrid", "tasks", "T-001-lens-smoke.md"),
    "# T-001 Lens Smoke\n\nTask context.\n",
    "utf8"
  );

  const writes = [];
  for (let index = 1; index <= 14; index += 1) {
    const padded = String(index).padStart(2, "0");
    writes.push(writeFile(
      path.join(vaultDir, "projects", `Linked ${padded}.md`),
      `# Linked ${padded}\n\nSee [[Welcome]].\n`,
      "utf8"
    ));
  }

  for (let index = 1; index <= 112; index += 1) {
    const padded = String(index).padStart(3, "0");
    writes.push(writeFile(
      path.join(vaultDir, "archive", `Orphan ${padded}.md`),
      `# Orphan ${padded}\n\nStandalone smoke note.\n`,
      "utf8"
    ));
  }

  await Promise.all(writes);
}

async function expectLargeGraphCanvas(page, label) {
  await waitForGraphCanvasMetrics(page, { minNodes: 100, dense: true }, label);
  const metrics = await getGraphCanvasMetrics(page);

  if (!metrics.dense || metrics.nodeCount < 100) {
    throw new Error(`${label} expected dense graph with at least 100 nodes, got ${JSON.stringify(metrics)}`);
  }

  if (
    !metrics.contentBounds
    || metrics.contentBounds.minX < -80
    || metrics.contentBounds.maxX > 1080
    || metrics.contentBounds.minY < -80
    || metrics.contentBounds.maxY > 760
  ) {
    throw new Error(`${label} expected dense graph content to fit the graph viewBox, got ${JSON.stringify(metrics)}`);
  }

  if (metrics.labelCount >= metrics.nodeCount * 0.55) {
    throw new Error(`${label} expected dense graph labels to be reduced, got ${JSON.stringify(metrics)}`);
  }
}

async function setGraphLens(page, lens, label) {
  const pane = page.getByTestId("graph-pane");
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const current = await pane.evaluate((element) => element.dataset.lens ?? "all");
    if (current === lens) {
      return;
    }

    await page.getByTestId("graph-lens-button").click();
    await page.waitForTimeout(120);
  }

  const current = await pane.evaluate((element) => element.dataset.lens ?? "all");
  throw new Error(`${label} expected lens ${lens}, got ${current}`);
}

async function expectGraphLensMetrics(page, label, expected) {
  await waitForGraphCanvasMetrics(page, { minNodes: expected.minNodes }, label);
  const metrics = await getGraphCanvasMetrics(page);
  if (metrics.nodeCount < expected.minNodes) {
    throw new Error(`${label} expected at least ${expected.minNodes} nodes, got ${JSON.stringify(metrics)}`);
  }

  if (expected.maxNodes !== undefined && metrics.nodeCount > expected.maxNodes) {
    throw new Error(`${label} expected at most ${expected.maxNodes} nodes, got ${JSON.stringify(metrics)}`);
  }

  if (expected.maxEdges !== undefined && metrics.edgeCount > expected.maxEdges) {
    throw new Error(`${label} expected at most ${expected.maxEdges} edges, got ${JSON.stringify(metrics)}`);
  }

  if (expected.maxLabelsRatio !== undefined && metrics.labelCount >= metrics.nodeCount * expected.maxLabelsRatio) {
    throw new Error(`${label} expected fewer labels, got ${JSON.stringify(metrics)}`);
  }
}

async function getGraphCanvasMetrics(page) {
  return page.evaluate(() => {
    const canvas = document.querySelector("#graph-canvas");
    const metrics = window.__sourceryGraphMetrics ?? {
      dense: canvas?.classList.contains("is-dense") === true,
      nodeCount: 0,
      edgeCount: 0,
      labelCount: 0,
      contentBounds: null,
    };

    return {
      ...metrics,
      hasPaintedPixels: canvas instanceof HTMLCanvasElement
        ? (() => {
          const context = canvas.getContext("2d");
          if (!context || canvas.width === 0 || canvas.height === 0) {
            return false;
          }

          const sampleWidth = Math.min(canvas.width, 256);
          const sampleHeight = Math.min(canvas.height, 256);
          const image = context.getImageData(0, 0, sampleWidth, sampleHeight).data;
          for (let index = 3; index < image.length; index += 4) {
            if (image[index] > 0) {
              return true;
            }
          }

          return false;
        })()
        : false,
    };
  });
}

async function waitForGraphCanvasMetrics(page, expected, label) {
  await page.waitForFunction((waitExpected) => {
    const metrics = window.__sourceryGraphMetrics;
    if (!metrics) {
      return false;
    }

    if (waitExpected.dense !== undefined && metrics.dense !== waitExpected.dense) {
      return false;
    }

    return metrics.nodeCount >= waitExpected.minNodes;
  }, expected, { timeout: 5_000 }).catch(async (error) => {
    const metrics = await getGraphCanvasMetrics(page).catch(() => null);
    throw new Error(`${label} expected graph canvas metrics, got ${JSON.stringify(metrics)}: ${error.message}`);
  });
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
