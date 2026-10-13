// A scripted stand-in for the Claude Messages API, used to test the director loop
// end to end without a key. It also records what the client sent so tests can
// check request shape and append-only history (thinking blocks echoed unchanged).
import http from "node:http";
import type { AddressInfo } from "node:net";

export interface Recorded {
  path: string;
  headers: http.IncomingHttpHeaders;
  body: {
    model: string;
    max_tokens: number;
    fallbacks?: unknown;
    output_config?: { effort?: string };
    system?: Array<{ type: string; text: string; cache_control?: unknown }>;
    tools?: Array<{ name: string }>;
    messages: Array<{ role: string; content: unknown }>;
  };
}

/** `script` receives the request number (0-based) and the request body, and returns the assistant content + stop reason. */
export type Script = (turn: number, body: Recorded["body"]) => { content: unknown[]; stop_reason: string };

export async function startMockAnthropic(script: Script): Promise<{ url: string; requests: Recorded[]; close: () => Promise<void> }> {
  const requests: Recorded[] = [];
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c: Buffer) => (raw += c.toString()));
    req.on("end", () => {
      const body = JSON.parse(raw) as Recorded["body"];
      requests.push({ path: req.url ?? "", headers: req.headers, body });
      const { content, stop_reason } = script(requests.length - 1, body);
      const msg = {
        id: `msg_${requests.length}`,
        type: "message",
        role: "assistant",
        model: body.model,
        content,
        stop_reason,
        stop_sequence: null,
        usage: { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      };
      res.writeHead(200, { "content-type": "application/json", "request-id": `req_${requests.length}` });
      res.end(JSON.stringify(msg));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, requests, close: () => new Promise((r) => server.close(() => r())) };
}
