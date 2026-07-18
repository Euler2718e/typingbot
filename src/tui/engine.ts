import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { PerformanceScript, SessionSettings, SessionStatus } from "../core/types";

type EngineCommand =
  | { command: "validate"; id: number; script: PerformanceScript }
  | { command: "start"; id: number; script: PerformanceScript; settings: SessionSettings }
  | { command: "pause" | "resume" | "stop" | "quit"; id: number };

type EngineCommandInput =
  | { command: "validate"; script: PerformanceScript }
  | { command: "start"; script: PerformanceScript; settings: SessionSettings }
  | { command: "pause" | "resume" | "stop" | "quit" };

type EngineEvent =
  | { type: "ready"; protocol: number; globalShortcut: boolean; warning: string | null }
  | { type: "response"; id: number; ok: boolean; error: string | null }
  | { type: "status"; status: SessionStatus }
  | { type: "control"; state: SessionStatus["state"] };

interface PendingRequest {
  resolve: () => void;
  reject: (error: Error) => void;
}

export interface EngineCallbacks {
  onReady?: (event: Extract<EngineEvent, { type: "ready" }>) => void;
  onStatus?: (status: SessionStatus) => void;
  onControl?: (state: SessionStatus["state"]) => void;
  onError?: (message: string) => void;
  onExit?: (code: number | null) => void;
}

export class EngineClient {
  private process: Bun.PipedSubprocess | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, PendingRequest>();

  constructor(private readonly callbacks: EngineCallbacks = {}) {}

  async start(): Promise<void> {
    if (this.process) return;
    const binary = resolveEnginePath();
    this.process = Bun.spawn([binary], { stdin: "pipe", stdout: "pipe", stderr: "pipe" });
    void this.readEvents(this.process.stdout);
    void this.readErrors(this.process.stderr);
    void this.process.exited.then((code) => {
      for (const request of this.pending.values()) request.reject(new Error("Playback engine stopped"));
      this.pending.clear();
      this.process = null;
      this.callbacks.onExit?.(code);
    });
  }

  validate(script: PerformanceScript): Promise<void> {
    return this.send({ command: "validate", script });
  }

  startSession(script: PerformanceScript, settings: SessionSettings): Promise<void> {
    return this.send({ command: "start", script, settings });
  }

  pause(): Promise<void> {
    return this.send({ command: "pause" });
  }

  resume(): Promise<void> {
    return this.send({ command: "resume" });
  }

  stop(): Promise<void> {
    return this.send({ command: "stop" });
  }

  async close(): Promise<void> {
    if (!this.process) return;
    try {
      await this.send({ command: "quit" });
    } catch {
      this.process.kill();
    }
  }

  private send(command: EngineCommandInput): Promise<void> {
    if (!this.process) return Promise.reject(new Error("Playback engine is not running"));
    const id = this.nextId++;
    const payload = { ...command, id } as EngineCommand;
    return new Promise<void>((resolveRequest, rejectRequest) => {
      this.pending.set(id, { resolve: resolveRequest, reject: rejectRequest });
      this.process!.stdin.write(`${JSON.stringify(payload)}\n`);
    });
  }

  private async readEvents(stream: ReadableStream<Uint8Array>): Promise<void> {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffered = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffered += decoder.decode(value, { stream: true });
      const lines = buffered.split("\n");
      buffered = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          this.handleEvent(JSON.parse(line) as EngineEvent);
        } catch (error) {
          this.callbacks.onError?.(`Invalid engine response: ${error instanceof Error ? error.message : error}`);
        }
      }
    }
  }

  private async readErrors(stream: ReadableStream<Uint8Array>): Promise<void> {
    const message = (await new Response(stream).text()).trim();
    if (message) this.callbacks.onError?.(message.split("\n").at(-1) ?? message);
  }

  private handleEvent(event: EngineEvent): void {
    if (event.type === "ready") this.callbacks.onReady?.(event);
    if (event.type === "status") this.callbacks.onStatus?.(event.status);
    if (event.type === "control") this.callbacks.onControl?.(event.state);
    if (event.type === "response") {
      const request = this.pending.get(event.id);
      if (!request) return;
      this.pending.delete(event.id);
      if (event.ok) request.resolve();
      else request.reject(new Error(event.error || "Playback engine rejected the command"));
    }
  }
}

export function resolveEnginePath(): string {
  const executable = process.platform === "win32" ? "typingbot-engine.exe" : "typingbot-engine";
  const candidates = [
    process.env.TYPINGBOT_ENGINE,
    resolve(dirname(process.execPath), executable),
    resolve(dirname(process.execPath), "bin", executable),
    resolve(process.cwd(), "src-tauri", "target", "release", executable),
    resolve(process.cwd(), "src-tauri", "target", "debug", executable),
    resolve(import.meta.dir, "..", "..", "bin", executable),
  ].filter((path): path is string => Boolean(path));
  const found = candidates.find(existsSync);
  if (!found) {
    throw new Error("Playback engine is missing. Run `bun run engine:build` once, then reopen TypingBot.");
  }
  return found;
}
