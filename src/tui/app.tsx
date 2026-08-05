import type { InputRenderable, ScrollBoxRenderable, SelectOption, TextareaRenderable } from "@opentui/core";
import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildPerformancePrompt } from "../core/prompt";
import { getWritingStyle } from "../core/styles";
import type {
  PerformanceScript,
  RevisionDensity,
  RhythmProfile,
  SessionSettings,
  SessionStatus,
  ValidationResult,
} from "../core/types";
import { parsePerformanceScript, validatePerformanceScript } from "../core/validate";
import { copyToClipboard } from "./clipboard";
import { EngineClient, type EngineCallbacks } from "./engine";
import { saveFormState, type TuiFormState } from "./state";

// A terminal-native approximation of Apple's layered materials. OpenTUI does
// not expose composited translucency, so depth comes from restrained surfaces,
// soft borders, and a single system-blue interaction color.
const color = {
  bg: "#0d0d0f",
  chrome: "#141416",
  panel: "#1c1c1e",
  panelAlt: "#242426",
  focused: "#163a5f",
  border: "#3a3a3c",
  borderSoft: "#2c2c2e",
  muted: "#a1a1a6",
  subdued: "#636366",
  text: "#f5f5f7",
  accent: "#0a84ff",
  success: "#30d158",
  amber: "#ffd60a",
  error: "#ff453a",
  planning: "#0a84ff",
  drafting: "#0a84ff",
  polishing: "#0a84ff",
} as const;

const idleStatus: SessionStatus = {
  state: "idle",
  phase: null,
  actionIndex: 0,
  actionCount: 0,
  elapsedMs: 0,
  targetDurationMs: 0,
  message: "Paste a performance to begin",
  targetApplication: null,
};

const revisionOptions: SelectOption[] = [
  { name: "light", description: "essential revisions", value: "light" },
  { name: "balanced", description: "visible redrafting", value: "balanced" },
  { name: "deep", description: "dense reconstruction", value: "deep" },
];

const rhythmOptions: SelectOption[] = [
  { name: "steady", description: "controlled pace", value: "steady" },
  { name: "natural", description: "bursts and pauses", value: "natural" },
  { name: "reflective", description: "longer hesitation", value: "reflective" },
];

const booleanOptions: SelectOption[] = [
  { name: "on", description: "type and repair mistakes", value: true },
  { name: "off", description: "no transient mistakes", value: false },
];

const absorbOptions: SelectOption[] = [
  { name: "absorb", description: "swallow your keystrokes while typing", value: true },
  { name: "off", description: "leave your keyboard live", value: false },
];

const fieldCount = 21;

export interface PlaybackEngine {
  start(): Promise<void>;
  validate(script: PerformanceScript): Promise<void>;
  startSession(script: PerformanceScript, settings: SessionSettings): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  stop(): Promise<void>;
  close(): Promise<void>;
}

export interface TypingBotAppProps {
  initialState: TuiFormState;
  connectEngine?: boolean;
  persistState?: boolean;
  engineFactory?: (callbacks: EngineCallbacks) => PlaybackEngine;
}

const defaultEngineFactory = (callbacks: EngineCallbacks): PlaybackEngine => new EngineClient(callbacks);

export function TypingBotApp({
  initialState,
  connectEngine = true,
  persistState = true,
  engineFactory = defaultEngineFactory,
}: TypingBotAppProps) {
  const renderer = useRenderer();
  const { width, height } = useTerminalDimensions();
  const wide = width >= 104;
  const compact = height < 32;
  const [form, setForm] = useState(initialState);
  const [status, setStatus] = useState(idleStatus);
  const [focusIndex, setFocusIndex] = useState(0);
  const [engineReady, setEngineReady] = useState(!connectEngine);
  const [shortcutReady, setShortcutReady] = useState(false);
  const [notice, setNotice] = useState("offline · nothing leaves this computer");
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [busy, setBusy] = useState(false);
  const styleRef = useRef<InputRenderable>(null);
  const assignmentRef = useRef<TextareaRenderable>(null);
  const performanceRef = useRef<TextareaRenderable>(null);
  const workspaceRef = useRef<ScrollBoxRenderable>(null);
  const timingRef = useRef<ScrollBoxRenderable>(null);

  const engine = useMemo(() => engineFactory({
    onReady: (event) => {
      setEngineReady(true);
      setShortcutReady(event.globalShortcut);
      setNotice(event.warning || "native playback engine ready");
    },
    onStatus: setStatus,
    onControl: (state) => setStatus((current) => ({
      ...current,
      state,
      message: controlMessage(state),
    })),
    onError: setNotice,
    onExit: () => {
      setEngineReady(false);
      setNotice("playback engine stopped");
    },
  }), [engineFactory]);

  useEffect(() => {
    if (!connectEngine) return;
    void engine.start().catch((error) => setNotice(errorMessage(error)));
    return () => { void engine.close(); };
  }, [connectEngine, engine]);

  useEffect(() => {
    if (!persistState) return;
    const timeout = setTimeout(() => {
      void saveFormState(form).catch((error) => setNotice(`Could not save settings: ${errorMessage(error)}`));
    }, 350);
    return () => clearTimeout(timeout);
  }, [form, persistState]);

  const setSettings = useCallback((patch: Partial<SessionSettings>) => {
    setForm((current) => ({ ...current, settings: { ...current.settings, ...patch } }));
    setValidation(null);
  }, []);

  const copyPrompt = useCallback(async () => {
    const request = form.assignment.trim() || "[Paste your writing request here before sending.]";
    try {
      const prompt = buildPerformancePrompt(request, form.promptPreferences, form.settings);
      await copyToClipboard(prompt);
      setNotice("complete model prompt copied to the system clipboard");
    } catch (error) {
      setNotice(errorMessage(error));
    }
  }, [form.assignment, form.promptPreferences, form.settings]);

  const validate = useCallback(async (play: boolean) => {
    setBusy(true);
    try {
      if (form.promptPreferences.writingStyle === null) {
        setNotice("Choose a writing style from 1 to 30 before validating or playing");
        return;
      }
      const script = parsePerformanceScript(form.performance);
      const result = validatePerformanceScript(script, form.settings);
      setValidation(result);
      if (!result.valid) {
        setNotice(result.errors.slice(0, 2).join(" · "));
        return;
      }
      await engine.validate(script);
      setNotice(`${result.stats.actions} edits verified · exact final text confirmed`);
      if (play) {
        await engine.startSession(script, form.settings);
        setStatus({
          ...idleStatus,
          state: "countdown",
          actionCount: result.stats.actions,
          targetDurationMs: form.settings.durationMinutes * 60_000,
          message: `Switch to the destination textbox within ${form.settings.countdownSeconds} seconds`,
        });
      }
    } catch (error) {
      setValidation(null);
      setNotice(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }, [engine, form.performance, form.promptPreferences.writingStyle, form.settings]);

  const togglePause = useCallback(async () => {
    try {
      if (status.state === "paused") {
        await engine.resume();
        setStatus((current) => ({ ...current, state: "running", message: "Playback resumed" }));
      } else if (status.state === "running" || status.state === "countdown") {
        await engine.pause();
        setStatus((current) => ({ ...current, state: "paused", message: "Playback paused" }));
      }
    } catch (error) {
      setNotice(errorMessage(error));
    }
  }, [engine, status.state]);

  const stop = useCallback(async () => {
    try {
      await engine.stop();
      setStatus((current) => ({ ...current, state: "stopped", message: "Session stopped by user" }));
    } catch (error) {
      setNotice(errorMessage(error));
    }
  }, [engine]);

  const quit = useCallback(() => {
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      renderer.destroy();
      process.exit(0);
    };
    const timeout = setTimeout(finish, 600);
    void engine.close().finally(() => {
      clearTimeout(timeout);
      finish();
    });
  }, [engine, renderer]);

  useKeyboard((key) => {
    if (key.ctrl && key.name === "c") {
      key.preventDefault();
      quit();
      return;
    }
    if (key.name === "tab") {
      key.preventDefault();
      setFocusIndex((current) => (current + (key.shift ? -1 : 1) + fieldCount) % fieldCount);
      return;
    }
    if (key.ctrl && key.name === "g") {
      key.preventDefault();
      void copyPrompt();
    }
    if (key.ctrl && key.name === "return") {
      key.preventDefault();
      void validate(true);
    }
    if (key.ctrl && key.name === "v") {
      key.preventDefault();
      void validate(false);
    }
    if (key.ctrl && key.name === "space") {
      key.preventDefault();
      void togglePause();
    }
    if (key.ctrl && key.name === "x") {
      key.preventDefault();
      void stop();
    }
    if (key.ctrl && (key.name === "down" || key.name === "up")) {
      key.preventDefault();
      const target = wide ? timingRef.current : workspaceRef.current;
      target?.scrollBy(key.name === "down" ? 6 : -6);
    }
  });

  const active = status.state === "running" || status.state === "paused" || status.state === "countdown";
  const progress = status.targetDurationMs > 0
    ? Math.min(100, Math.round(status.elapsedMs / status.targetDurationMs * 100))
    : status.state === "completed" ? 100 : 0;
  const phaseTotal = form.settings.planningPercent + form.settings.draftingPercent + form.settings.polishingPercent;
  const selectedStyle = form.promptPreferences.writingStyle === null
    ? null
    : getWritingStyle(form.promptPreferences.writingStyle);
  const headerHeight = wide ? 4 : 3;
  const footerHeight = wide ? 2 : 3;
  const bodyHeight = Math.max(12, height - headerHeight - footerHeight - 3);
  const workflowState = selectedStyle === null
    ? "Choose a writing style"
    : !form.assignment.trim()
      ? "Add a writing request"
      : !form.performance.trim()
        ? "Copy the prompt, then paste the performance"
        : validation?.valid
          ? "Ready to play"
          : "Verify the performance";
  const statusDetail = active ? status.message : `${workflowState}  ${notice}`;

  return (
    <box width="100%" height="100%" flexDirection="column" backgroundColor={color.bg}>
      <box
        height={headerHeight}
        flexShrink={0}
        paddingLeft={2}
        paddingRight={2}
        flexDirection="row"
        justifyContent="space-between"
        alignItems="center"
        backgroundColor={color.chrome}
        border={["bottom"]}
        borderColor={color.borderSoft}
      >
        <box flexDirection="column">
          <text fg={color.text}><strong>TypingBot</strong></text>
          {wide ? <text fg={color.muted}>Local writing playback</text> : null}
        </box>
        <box flexDirection="row" gap={1} alignItems="center">
          <StatusChip
            label={engineReady ? (wide ? "Engine ready" : "Ready") : (wide ? "Engine offline" : "Offline")}
            tone={engineReady ? color.success : color.amber}
          />
          <StatusChip
            label={selectedStyle ? `Style ${String(selectedStyle.id).padStart(2, "0")}` : "Style required"}
            tone={selectedStyle ? color.accent : color.amber}
          />
          {wide ? <text fg={color.muted}>{shortcutReady ? "Global controls" : "Terminal controls"}</text> : null}
        </box>
      </box>

      <box height={3} flexShrink={0} paddingLeft={2} paddingRight={2} flexDirection="column" border={["bottom"]} borderColor={color.borderSoft}>
        <box flexDirection="row" justifyContent="space-between">
          <text fg={statusColor(status.state)}>
            <strong>{statusLabel(status)}</strong>
            <span fg={color.muted}>  {statusDetail}</span>
          </text>
          <text fg={color.text}>{formatDuration(status.elapsedMs)}  <span fg={color.muted}>{progress}%{busy ? "  Working" : ""}</span></text>
        </box>
        <text fg={status.phase ? phaseColor(status.phase) : color.borderSoft}>{progressRail(progress, Math.max(18, width - 4))}</text>
      </box>

      <WorkspaceFrame wide={wide} bodyHeight={bodyHeight} scrollRef={workspaceRef}>
        <box
          width={wide ? "62%" : "100%"}
          height={wide ? "100%" : Math.max(14, bodyHeight * 2)}
          border
          borderStyle="rounded"
          borderColor={color.borderSoft}
          title=" Workflow "
          backgroundColor={color.panel}
          padding={1}
          flexDirection="column"
        >
          <box
            height={5}
            flexShrink={0}
            border
            borderStyle="rounded"
            borderColor={selectedStyle ? color.accent : color.border}
            backgroundColor={color.chrome}
            title=" Writing style "
            paddingLeft={1}
            paddingRight={1}
            flexDirection="column"
          >
            <box height={1} flexDirection="row" justifyContent="space-between" alignItems="center">
              <text fg={selectedStyle ? color.success : color.amber}>
                <strong>{selectedStyle ? "Selected" : "Required"}</strong>
              </text>
              <box flexDirection="row" alignItems="center">
              <input
                ref={styleRef}
                focused={focusIndex === 0}
                value={selectedStyle ? String(selectedStyle.id) : ""}
                placeholder="1-30"
                width={5}
                maxLength={2}
                textColor={color.text}
                focusedTextColor={color.text}
                backgroundColor={color.panelAlt}
                focusedBackgroundColor={color.focused}
                cursorColor={color.accent}
                onInput={(raw) => {
                  const value = Number(raw);
                  const writingStyle = raw.trim() && Number.isInteger(value) && value >= 1 && value <= 30
                    ? value
                    : null;
                  setForm((current) => ({
                    ...current,
                    promptPreferences: { ...current.promptPreferences, writingStyle },
                  }));
                  setValidation(null);
                }}
              />
                <text fg={color.muted}> of 30</text>
              </box>
            </box>
            <text fg={selectedStyle ? color.text : color.muted}>
              <strong>{selectedStyle?.name ?? "Choose a number before creating or playing"}</strong>
            </text>
            <text fg={color.muted}>{selectedStyle?.summary ?? "Each number changes the complete writing process."}</text>
          </box>
          <box height={1} flexDirection="row" justifyContent="space-between">
            <text fg={color.text}><strong>Writing request</strong></text>
            <text fg={selectedStyle ? color.accent : color.amber}>Ctrl+G Copy prompt</text>
          </box>
          <textarea
            ref={assignmentRef}
            initialValue={form.assignment}
            focused={focusIndex === 1}
            height={3}
            wrapMode="word"
            placeholder="Paste the assignment, brief, or writing request"
            backgroundColor={color.panelAlt}
            focusedBackgroundColor={color.focused}
            textColor={color.text}
            focusedTextColor={color.text}
            cursorColor={color.accent}
            onContentChange={() => setForm((current) => ({
              ...current,
              assignment: assignmentRef.current?.plainText ?? current.assignment,
            }))}
          />
          <text fg={color.muted}>Revision depth</text>
          <select
            focused={focusIndex === 2}
            height={3}
            options={revisionOptions}
            selectedIndex={revisionOptions.findIndex((option) => option.value === form.promptPreferences.revisionDensity)}
            showDescription={false}
            wrapSelection
            backgroundColor={color.chrome}
            selectedBackgroundColor={color.focused}
            selectedTextColor={color.accent}
            onChange={(_, option) => option && setForm((current) => ({
              ...current,
              promptPreferences: { ...current.promptPreferences, revisionDensity: option.value as RevisionDensity },
            }))}
          />
          <box height={1} marginTop={1} flexDirection="row" justifyContent="space-between">
            <text fg={color.text}><strong>Performance JSON</strong></text>
            <text fg={validation?.valid ? color.accent : validation ? color.error : color.muted}>
              {validation?.valid ? "Verified" : validation ? "Needs attention" : `${form.performance.length} characters`}
            </text>
          </box>
          <textarea
            ref={performanceRef}
            initialValue={form.performance}
            focused={focusIndex === 3}
            height={wide ? undefined : compact ? 7 : 9}
            minHeight={wide ? 5 : undefined}
            flexGrow={wide ? 1 : 0}
            wrapMode="char"
            placeholder={'{ "version": "1.0", "finalText": "..." }'}
            backgroundColor={color.panelAlt}
            focusedBackgroundColor={color.focused}
            textColor={color.text}
            focusedTextColor={color.text}
            cursorColor={color.accent}
            onContentChange={() => {
              setValidation(null);
              setForm((current) => ({
                ...current,
                performance: performanceRef.current?.plainText ?? current.performance,
              }));
            }}
          />
        </box>

        <box
          width={wide ? "38%" : "100%"}
          height={wide ? "100%" : Math.max(30, bodyHeight * 2)}
          border
          borderStyle="rounded"
          borderColor={color.borderSoft}
          title=" Session "
          backgroundColor={color.panel}
          padding={1}
          flexDirection="column"
        >
          <scrollbox ref={timingRef} flexGrow={1} flexDirection="column">
          <SettingsHeader title="Timing" detail="Runtime and cadence" />
          <NumberField index={4} focusIndex={focusIndex} label="Total time" suffix="min" value={form.settings.durationMinutes} onValue={(value) => setSettings({ durationMinutes: clamp(value, 1, 480) })} />
          <NumberField index={5} focusIndex={focusIndex} label="Base speed" suffix="wpm" value={form.settings.wpm} onValue={(value) => setSettings({ wpm: clamp(value, 20, 220) })} />
          <NumberField index={6} focusIndex={focusIndex} label="Focus window" suffix="sec" value={form.settings.countdownSeconds} onValue={(value) => setSettings({ countdownSeconds: clamp(value, 3, 30) })} />

          <box height={1} marginTop={1} flexDirection="row" justifyContent="space-between">
            <text fg={color.text}><strong>Process</strong><span fg={color.muted}>  Phase allocation</span></text>
            <text fg={phaseTotal === 100 ? color.accent : color.error}>{phaseTotal}%</text>
          </box>
          <NumberField index={7} focusIndex={focusIndex} label="Planning" suffix="%" value={form.settings.planningPercent} tint={color.planning} onValue={(value) => setSettings({ planningPercent: clamp(value, 0, 100) })} />
          <NumberField index={8} focusIndex={focusIndex} label="Drafting" suffix="%" value={form.settings.draftingPercent} tint={color.drafting} onValue={(value) => setSettings({ draftingPercent: clamp(value, 0, 100) })} />
          <NumberField index={9} focusIndex={focusIndex} label="Polishing" suffix="%" value={form.settings.polishingPercent} tint={color.polishing} onValue={(value) => setSettings({ polishingPercent: clamp(value, 0, 100) })} />

          <SettingsHeader title="Typing behavior" detail="Rhythm and corrections" />
          <text fg={color.muted}>Cadence profile</text>
          <select
            focused={focusIndex === 10}
            height={3}
            options={rhythmOptions}
            selectedIndex={rhythmOptions.findIndex((option) => option.value === form.settings.rhythmProfile)}
            showDescription={false}
            wrapSelection
            backgroundColor={color.chrome}
            selectedBackgroundColor={color.focused}
            selectedTextColor={color.accent}
            onChange={(_, option) => option && setSettings({ rhythmProfile: option.value as RhythmProfile })}
          />
          <box height={2} flexDirection="row" justifyContent="space-between" alignItems="center">
            <text fg={color.muted}>Repair mistakes</text>
            <select
              focused={focusIndex === 11}
              width={14}
              height={2}
              options={booleanOptions}
              selectedIndex={form.settings.correctedTypos ? 0 : 1}
              showDescription={false}
              wrapSelection
              backgroundColor={color.chrome}
              selectedBackgroundColor={color.focused}
              selectedTextColor={color.accent}
              onChange={(_, option) => option && setSettings({ correctedTypos: Boolean(option.value) })}
            />
          </box>
          <NumberField index={12} focusIndex={focusIndex} label="Speed variation" suffix="%" value={form.settings.variationPercent} onValue={(value) => setSettings({ variationPercent: clamp(value, 0, 100) })} />
          <NumberField index={13} focusIndex={focusIndex} label="Hesitation" suffix="%" value={form.settings.hesitationPercent} onValue={(value) => setSettings({ hesitationPercent: clamp(value, 0, 100) })} />
          <NumberField index={14} focusIndex={focusIndex} label="Corrected typos" suffix="/1k" value={form.settings.typosPerThousand} onValue={(value) => setSettings({ typosPerThousand: clamp(value, 0, 50) })} />
          <NumberField index={15} focusIndex={focusIndex} label="Correction delay" suffix="ms" value={form.settings.correctionDelayMs} onValue={(value) => setSettings({ correctionDelayMs: clamp(value, 40, 1200) })} />
          <NumberField index={16} focusIndex={focusIndex} label="Pause before edits" suffix="ms" value={form.settings.editPauseMs} onValue={(value) => setSettings({ editPauseMs: clamp(value, 0, 3000) })} />
          <NumberField index={17} focusIndex={focusIndex} label="Thinking depth" suffix="%" value={form.settings.thinkingIntensity} tint={color.planning} onValue={(value) => setSettings({ thinkingIntensity: clamp(value, 0, 100) })} />
          <NumberField index={18} focusIndex={focusIndex} label="Correction travel" suffix="ms" value={form.settings.correctionNavMs} onValue={(value) => setSettings({ correctionNavMs: clamp(value, 4, 200) })} />

          <SettingsHeader title="Keyboard" detail="Input during playback" />
          <box height={2} flexDirection="row" justifyContent="space-between" alignItems="center">
            <text fg={color.muted}>Keystroke handling</text>
            <select
              focused={focusIndex === 19}
              width={14}
              height={2}
              options={absorbOptions}
              selectedIndex={form.settings.absorbKeystrokes ? 0 : 1}
              showDescription={false}
              wrapSelection
              backgroundColor={color.chrome}
              selectedBackgroundColor={color.focused}
              selectedTextColor={color.accent}
              onChange={(_, option) => option && setSettings({ absorbKeystrokes: Boolean(option.value) })}
            />
          </box>
          <text fg={color.subdued}>Command shortcuts stay live. Esc pauses. Ctrl+X stops.</text>
          <input focused={focusIndex === 20} value="" width={1} maxLength={0} textColor={color.panel} cursorColor={color.panel} />
          </scrollbox>
        </box>
      </WorkspaceFrame>

      <box
        height={footerHeight}
        flexShrink={0}
        paddingLeft={2}
        paddingRight={2}
        flexDirection={wide ? "row" : "column"}
        justifyContent={wide ? "space-between" : "flex-start"}
        alignItems={wide ? "center" : "flex-start"}
        backgroundColor={color.chrome}
        border={["top"]}
        borderColor={color.borderSoft}
      >
        {wide ? (
          <>
            <text fg={color.muted}>
              <span fg={color.text}>Tab</span> Navigate  <span fg={color.text}>Ctrl+G</span> Prompt  <span fg={color.text}>Ctrl+V</span> Verify  <span fg={color.accent}><strong>Ctrl+Enter Play</strong></span>
            </text>
            <text fg={active ? color.amber : color.muted}>
              <span fg={color.text}>Ctrl+Space</span> {status.state === "paused" ? "Resume" : "Pause"}  <span fg={color.error}>Ctrl+X Stop</span>  <span fg={color.text}>Ctrl+C Quit</span>
            </text>
          </>
        ) : (
          <>
            <text fg={color.muted}><span fg={color.text}>Tab</span> Navigate  <span fg={color.text}>Ctrl+↑/↓</span> Scroll  <span fg={color.text}>Ctrl+G</span> Prompt  <span fg={color.text}>Ctrl+V</span> Verify</text>
            <text fg={color.muted}><span fg={color.accent}><strong>Ctrl+Enter Play</strong></span>  <span fg={color.text}>Ctrl+Space</span> {status.state === "paused" ? "Resume" : "Pause"}  <span fg={color.error}>Ctrl+X Stop</span>  <span fg={color.text}>Ctrl+C Quit</span></text>
          </>
        )}
      </box>
    </box>
  );
}

function WorkspaceFrame({
  wide,
  bodyHeight,
  scrollRef,
  children,
}: {
  wide: boolean;
  bodyHeight: number;
  scrollRef: React.RefObject<ScrollBoxRenderable | null>;
  children: React.ReactNode;
}) {
  const layout = {
    height: bodyHeight,
    flexGrow: 1,
    flexDirection: wide ? "row" as const : "column" as const,
    gap: 1,
    padding: 1,
  };
  return wide ? <box {...layout}>{children}</box> : <scrollbox ref={scrollRef} {...layout}>{children}</scrollbox>;
}

function StatusChip({ label, tone }: { label: string; tone: string }) {
  return (
    <box height={1} paddingLeft={1} paddingRight={1} backgroundColor={color.panelAlt}>
      <text fg={tone}>● <span fg={color.text}>{label}</span></text>
    </box>
  );
}

function SettingsHeader({ title, detail }: { title: string; detail: string }) {
  return (
    <box height={1} marginTop={1} flexDirection="row">
      <text fg={color.text}><strong>{title}</strong><span fg={color.muted}>  {detail}</span></text>
    </box>
  );
}

function NumberField({
  index,
  focusIndex,
  label,
  suffix,
  value,
  tint = color.muted,
  onValue,
}: {
  index: number;
  focusIndex: number;
  label: string;
  suffix: string;
  value: number;
  tint?: string;
  onValue: (value: number) => void;
}) {
  const ref = useRef<InputRenderable>(null);
  return (
    <box height={1} flexDirection="row" justifyContent="space-between">
      <text fg={tint}>{label}</text>
      <box width={12} flexDirection="row" justifyContent="flex-end">
        <input
          ref={ref}
          width={7}
          value={String(value)}
          focused={focusIndex === index}
          textColor={color.text}
          focusedTextColor={color.text}
          backgroundColor={color.panelAlt}
          focusedBackgroundColor={color.focused}
          cursorColor={color.accent}
          onInput={(raw) => {
            const parsed = Number(raw);
            if (raw.trim() && Number.isFinite(parsed)) onValue(parsed);
          }}
        />
        <text width={5} fg={color.muted}> {suffix}</text>
      </box>
    </box>
  );
}

function statusLabel(status: SessionStatus): string {
  if (status.phase) {
    const phase = `${status.phase[0]?.toUpperCase() ?? ""}${status.phase.slice(1)}`;
    return `${phase} ${status.actionIndex + 1}/${Math.max(status.actionCount, 1)}`;
  }
  const labels: Record<SessionStatus["state"], string> = {
    idle: "Ready",
    countdown: "Choose destination",
    running: "Playing",
    paused: "Paused",
    completed: "Complete",
    stopped: "Stopped",
    error: "Attention",
  };
  return labels[status.state];
}

function controlMessage(state: SessionStatus["state"]): string {
  if (state === "paused") return "Paused · press Ctrl+Enter anywhere to resume";
  if (state === "stopped") return "Stopped with the global Ctrl+X shortcut";
  if (state === "running") return "Resumed from the global shortcut";
  return "Playback control updated";
}

function statusColor(state: SessionStatus["state"]): string {
  if (state === "error" || state === "stopped") return color.error;
  if (state === "paused" || state === "countdown") return color.amber;
  if (state === "running" || state === "completed") return color.accent;
  return color.text;
}

function phaseColor(phase: NonNullable<SessionStatus["phase"]>): string {
  return color[phase];
}

function progressRail(percent: number, width: number): string {
  const size = Math.max(8, width);
  const filled = Math.round(size * Math.min(100, Math.max(0, percent)) / 100);
  return `${"━".repeat(filled)}${"─".repeat(size - filled)}`;
}

function formatDuration(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, Math.round(value)));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
