#!/usr/bin/env node
/**
 * A minimal MCP server over stdio, with no dependencies.
 *
 * Used by the MCP smoke test to exercise the whole path for real: mcp.json is
 * written, the engine spawns this process, the handshake completes, tools are
 * listed, merged into the agent's registry, and a tool call round-trips.
 *
 * Deliberately raw JSON-RPC rather than the MCP SDK: it proves the engine talks
 * the actual wire protocol, and it keeps the fixture from depending on a package
 * the Desktop app does not ship.
 *
 * Framing is newline-delimited JSON, which is what the SDK's stdio transport uses.
 *
 * Env:
 *   MCP_FIXTURE_TOOLS  number of tools to expose (default 1)
 *   MCP_FIXTURE_DELAY  ms to wait before answering initialize (default 0)
 *   MCP_FIXTURE_FAIL   if set, exit immediately instead of serving
 */
const readline = require("node:readline");

if (process.env.MCP_FIXTURE_FAIL) {
  process.stderr.write("fixture: refusing to start\n");
  process.exit(1);
}

const TOOL_COUNT = Number(process.env.MCP_FIXTURE_TOOLS || 1);
const DELAY = Number(process.env.MCP_FIXTURE_DELAY || 0);

const tools = Array.from({ length: TOOL_COUNT }, (_, i) => ({
  name: i === 0 ? "echo" : `echo_${i}`,
  description: `Echo back the text you pass (fixture tool ${i})`,
  inputSchema: {
    type: "object",
    properties: { text: { type: "string", description: "Text to echo" } },
    required: ["text"],
  },
}));

function send(message) {
  process.stdout.write(JSON.stringify(message) + "\n");
}

const rl = readline.createInterface({ input: process.stdin });

rl.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;

  let request;
  try {
    request = JSON.parse(trimmed);
  } catch {
    return;
  }

  // Notifications carry no id and expect no response.
  if (request.id === undefined) return;

  const reply = (result) => send({ jsonrpc: "2.0", id: request.id, result });

  switch (request.method) {
    case "initialize":
      // Echo the client's protocol version so negotiation always succeeds.
      setTimeout(() => {
        reply({
          protocolVersion: request.params?.protocolVersion ?? "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "ruby-smoke-fixture", version: "0.0.1" },
        });
      }, DELAY);
      return;

    case "tools/list":
      reply({ tools });
      return;

    case "tools/call": {
      const name = request.params?.name;
      const text = request.params?.arguments?.text ?? "";
      if (!tools.some((t) => t.name === name)) {
        send({
          jsonrpc: "2.0",
          id: request.id,
          error: { code: -32602, message: `Unknown tool: ${name}` },
        });
        return;
      }
      // A distinctive marker so the test can prove the value came from here.
      reply({ content: [{ type: "text", text: `fixture:${name}:${text}` }] });
      return;
    }

    default:
      send({
        jsonrpc: "2.0",
        id: request.id,
        error: { code: -32601, message: `Method not found: ${request.method}` },
      });
  }
});

rl.on("close", () => process.exit(0));
