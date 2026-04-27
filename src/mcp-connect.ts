import { SourceryHttpAgentRuntime, DEFAULT_SOURCERY_URL } from "./core/agent/http-agent-runtime.js";
import { encodeMcpMessage, McpMessageBuffer, SourceryMcpServer, type JsonRpcResponse } from "./core/agent/mcp-server.js";

async function main(): Promise<void> {
  const baseUrl = process.env.SOURCERY_URL?.trim() || DEFAULT_SOURCERY_URL;
  const runtime = await SourceryHttpAgentRuntime.connect({ baseUrl });
  const server = new SourceryMcpServer(runtime);
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
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
