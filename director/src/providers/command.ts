// Run a user-configured command template without a shell.
// Placeholders such as {text} or {out} are substituted inside individual
// arguments, so model-written text can never inject shell syntax.
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

/** Split a command template into argv, honouring single and double quotes. */
export function splitTemplate(template: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quote: '"' | "'" | null = null;
  let has = false;
  for (const ch of template.trim()) {
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      has = true;
    } else if (/\s/.test(ch)) {
      if (cur || has) out.push(cur);
      cur = "";
      has = false;
    } else {
      cur += ch;
    }
  }
  if (quote) throw new Error("unbalanced quote in command template");
  if (cur || has) out.push(cur);
  return out;
}

export async function runTemplate(template: string, values: Record<string, string>, timeoutMs: number): Promise<void> {
  const argv = splitTemplate(template).map((arg) => arg.replace(/\{(\w+)\}/g, (m, key: string) => (key in values ? values[key]! : m)));
  const [cmd, ...args] = argv;
  if (!cmd) throw new Error("empty command template");
  await run(cmd, args, { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 });
}
