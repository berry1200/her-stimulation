// The director agent: a manual tool-use loop on the Claude API.
// History is append-only and stored with the project, so thinking blocks stay valid
// across turns and a conversation survives restarts.
import Anthropic from "@anthropic-ai/sdk";
import type { Config } from "../config.ts";
import { screenRequest } from "../policy.ts";
import type { Studio } from "../studio.ts";
import { DIRECTOR_SYSTEM } from "./prompts.ts";
import { runTool, toolDefinitions } from "./tools.ts";

type Message = Anthropic.Beta.BetaMessageParam;

export class DirectorBusyError extends Error {}

export class Director {
  private client: Anthropic | null = null;
  private readonly running = new Set<string>();
  private readonly tools = toolDefinitions();

  constructor(
    private readonly studio: Studio,
    private readonly config: Config,
  ) {}

  isRunning(projectId: string): boolean {
    return this.running.has(projectId);
  }

  private getClient(): Anthropic {
    // Resolves ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN / an `ant auth login` profile.
    this.client ??= new Anthropic();
    return this.client;
  }

  /** Start a director turn in the background. Throws DirectorBusyError if one is already running. */
  start(projectId: string, userText: string): Promise<void> {
    if (this.running.has(projectId)) throw new DirectorBusyError("the director is still working on the previous message");
    this.running.add(projectId);
    const done = this.turn(projectId, userText).finally(() => {
      this.running.delete(projectId);
      this.studio.bus.publish(projectId, { type: "agent", state: "idle" });
    });
    return done;
  }

  private async turn(projectId: string, userText: string): Promise<void> {
    const studio = this.studio;
    await studio.feed(projectId, { role: "user", text: userText });
    const screen = screenRequest(userText);
    if (!screen.allowed) {
      await studio.feed(projectId, { role: "director", text: screen.reason ?? "I can't help with that." });
      return;
    }
    studio.bus.publish(projectId, { type: "agent", state: "thinking" });

    let client: Anthropic;
    try {
      client = this.getClient();
    } catch (err) {
      await studio.feed(projectId, { role: "system", text: `The director needs Claude API access: ${(err as Error).message}`, ok: false });
      return;
    }

    const history: Message[] = await studio.store.loadChat(projectId);
    const state = JSON.stringify(await studio.snapshotState(projectId));
    history.push({
      role: "user",
      content: [
        { type: "text", text: `<project_state>${state}</project_state>` },
        { type: "text", text: userText },
      ],
    });
    await studio.store.saveChat(projectId, history);

    let inputTokens = 0;
    let outputTokens = 0;
    for (let step = 0; step < this.config.maxAgentSteps; step++) {
      let response: Anthropic.Beta.BetaMessage;
      try {
        response = await client.beta.messages.create({
          model: this.config.model,
          max_tokens: 16000,
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
          output_config: { effort: this.config.effort },
          system: [{ type: "text", text: DIRECTOR_SYSTEM, cache_control: { type: "ephemeral" } }],
          tools: this.tools,
          messages: history,
        });
      } catch (err) {
        await studio.feed(projectId, { role: "system", text: describeApiError(err), ok: false });
        studio.bus.publish(projectId, { type: "agent", state: "error", detail: describeApiError(err) });
        return;
      }
      inputTokens += (response.usage.input_tokens ?? 0) + (response.usage.cache_read_input_tokens ?? 0) + (response.usage.cache_creation_input_tokens ?? 0);
      outputTokens += response.usage.output_tokens ?? 0;

      // Keep the assistant turn exactly as returned (thinking and fallback blocks included).
      history.push({ role: "assistant", content: response.content as Anthropic.Beta.BetaContentBlockParam[] });
      await studio.store.saveChat(projectId, history);

      for (const block of response.content) {
        if (block.type === "text" && block.text.trim()) await studio.feed(projectId, { role: "director", text: block.text.trim() });
        if (block.type === "fallback") await studio.feed(projectId, { role: "system", text: `Continued on ${block.to.model} after ${block.from.model} declined part of the request.` });
      }

      if (response.stop_reason === "refusal") {
        const why = response.stop_details?.explanation;
        await studio.feed(projectId, { role: "director", text: `I can't help with that request.${why ? ` (${why})` : ""} Try asking for something else.` });
        break;
      }
      if (response.stop_reason === "pause_turn") continue;

      const toolUses = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
      if (response.stop_reason === "max_tokens") {
        // A tool call cut off by max_tokens may hold truncated input: never run it.
        await studio.feed(projectId, { role: "system", text: "The director's reply was cut off. Ask it to continue, or to make the change in smaller steps.", ok: false });
        if (toolUses.length) {
          history.push({ role: "user", content: toolUses.map((t) => ({ type: "tool_result" as const, tool_use_id: t.id, is_error: true, content: "Not run: your output hit max_tokens and this input may be truncated. Retry with a smaller call." })) });
          await studio.store.saveChat(projectId, history);
        }
        break;
      }
      if (!toolUses.length) break;

      const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
      for (const use of toolUses) {
        const outcome = await runTool(studio, projectId, use.name, use.input);
        results.push({ type: "tool_result", tool_use_id: use.id, content: outcome.content, ...(outcome.isError ? { is_error: true } : {}) });
        await studio.feed(projectId, { role: "tool", tool: use.name, text: outcome.summary, ok: !outcome.isError });
      }
      history.push({ role: "user", content: results });
      await studio.store.saveChat(projectId, history);

      if (step === this.config.maxAgentSteps - 1) {
        await studio.feed(projectId, { role: "system", text: `Stopped after ${this.config.maxAgentSteps} steps. Send a message to let the director continue.`, ok: false });
      }
    }
    await studio.feed(projectId, { role: "system", text: `Claude usage this turn: ${inputTokens.toLocaleString("en-US")} input and ${outputTokens.toLocaleString("en-US")} output tokens.` });
  }
}

function describeApiError(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return "Claude API authentication failed. Set ANTHROPIC_API_KEY (or run `ant auth login`) and restart the studio.";
  if (err instanceof Anthropic.PermissionDeniedError) return "The Claude API key does not have access to this model.";
  if (err instanceof Anthropic.RateLimitError) return "Claude API rate limit reached. Wait a moment and send the message again.";
  if (err instanceof Anthropic.BadRequestError) return `Claude API rejected the request: ${err.message}`;
  if (err instanceof Anthropic.APIConnectionError) return "Could not reach the Claude API. Check the network connection.";
  if (err instanceof Anthropic.APIError) return `Claude API error ${err.status ?? ""}: ${err.message}`;
  return `Director error: ${(err as Error).message}`;
}
