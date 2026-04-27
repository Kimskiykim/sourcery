import { createAppContext } from "./server.js";
import { AgentWorkspaceSDK } from "./core/agent/agent-sdk.js";
import { encodeMcpMessage, McpMessageBuffer, SourceryMcpServer, type JsonRpcResponse } from "./core/agent/mcp-server.js";
import { WikiSDK } from "./core/wiki/wiki-sdk.js";

async function main(): Promise<void> {
  const context = createAppContext();
  await context.workspace.ensureSeeded();
  const server = new SourceryMcpServer(new AgentWorkspaceSDK({
    workspace: context.workspace,
    wiki: new WikiSDK(),
    graph: context.graph,
    connections: context.connections,
    tabsSession: context.tabsSession,
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

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
