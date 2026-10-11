// In-process pub/sub for live UI updates (served to the browser over SSE).
import { EventEmitter } from "node:events";

export type DirectorEvent =
  | { type: "feed"; entry: { at: string; role: string; text: string; tool?: string; ok?: boolean } }
  | { type: "agent"; state: "thinking" | "idle" | "error"; detail?: string }
  | { type: "plan"; version: number }
  | { type: "assets" }
  | { type: "thumbs"; version: number }
  | { type: "render"; id: string; status: string; progress: number; message: string; file?: string };

export class EventBus {
  private readonly emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(200);
  }

  publish(projectId: string, event: DirectorEvent): void {
    this.emitter.emit(projectId, event);
  }

  subscribe(projectId: string, fn: (e: DirectorEvent) => void): () => void {
    this.emitter.on(projectId, fn);
    return () => this.emitter.off(projectId, fn);
  }
}
