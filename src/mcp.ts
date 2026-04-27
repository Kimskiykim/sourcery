import { createAppContext } from "./server.js";
import { AgentWorkspaceSDK } from "./core/agent/agent-sdk.js";
import { encodeMcpMessage, McpMessageBuffer, SourceryMcpServer, type JsonRpcResponse } from "./core/agent/mcp-server.js";
import { WikiSDK } from "./core/wiki/wiki-sdk.js";

async function main(): Promise<void> {
  const context = createAppContext({
    rootDir: process.env.SOURCERY_ROOT_DIR,
    vaultDir: process.env.SOURCERY_VAULT_DIR,
    appStateDir: process.env.SOURCERY_APP_STATE_DIR,
    agentPolicy: {
      allowNoteWrites: parseBooleanEnv(process.env.SOURCERY_AGENT_ALLOW_NOTE_WRITES),
    },
  });
  await context.workspace.ensureSeeded();
  const server = new SourceryMcpServer(new AgentWorkspaceSDK({
    workspace: context.workspace,
    wiki: new WikiSDK(),
    graph: context.graph,
    connections: context.connections,
    tabsSession: context.tabsSession,
    policy: context.agentPolicy,
  }));
  const messageBuffer = new McpMessageBuffer();

  let queue = Promise.resolve();

  process.stdin.on("data", (chunk: Buffer) => {
    const messages = messageBuffer.push(chunk);
    messages.forEach((message) => {
      queue = queue
        .then(async () => {
          const response = await server.handleMessage(message);
          if (response) {
            writeMessage(response);
          }
        })
        .catch((error) => {
          writeMessage({
            jsonrpc: "2.0",
            id: null,
            error: {
              code: -32603,
              message: error instanceof Error ? error.message : "Internal server error",
            },
          });
        });
    });
  });

  process.stdin.resume();
}

function writeMessage(message: JsonRpcResponse): void {
  process.stdout.write(encodeMcpMessage(message));
}

function parseBooleanEnv(value: string | undefined): boolean {
  return value === "1" || value?.toLowerCase() === "true";
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
