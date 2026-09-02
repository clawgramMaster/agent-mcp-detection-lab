export interface IframeInputMessage {
  source: "iframe-input-lab";
  challengeId: string;
  event: string;
  key: string;
  inputType: string;
  isTrusted: boolean;
  controlledValue: string;
  complete: boolean;
  timestamp: number;
}

export interface HoverShadowMessage {
  source: "hover-shadow-lab";
  challengeId: string;
  event: "open" | "select";
  selectedOption: string;
  isTrusted: boolean;
  timestamp: number;
}

interface IframeMessageLike {
  data: unknown;
  origin: string;
  source: MessageEventSource | null;
}

interface ExpectedIframeMessage {
  challengeId: string;
  origin: string;
  source: MessageEventSource | null;
}

interface ExpectedHoverShadowMessage extends ExpectedIframeMessage {
  options: readonly string[];
}

const ALLOWED_EVENTS = new Set(["focus", "keydown", "beforeinput", "input", "keyup", "change", "blur", "click"]);

export function normalizeIframeOrigin(value: string | null | undefined): string | null {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:" ? url.origin : null;
  } catch {
    return null;
  }
}

export function parseIframeInputMessage(
  message: IframeMessageLike,
  expected: ExpectedIframeMessage,
): IframeInputMessage | null {
  if (!expected.source || message.source !== expected.source || message.origin !== expected.origin) {
    return null;
  }
  if (!message.data || typeof message.data !== "object") return null;

  const data = message.data as Partial<IframeInputMessage>;
  if (
    data.source !== "iframe-input-lab" ||
    data.challengeId !== expected.challengeId ||
    typeof data.event !== "string" ||
    !ALLOWED_EVENTS.has(data.event) ||
    typeof data.key !== "string" ||
    typeof data.inputType !== "string" ||
    typeof data.isTrusted !== "boolean" ||
    typeof data.controlledValue !== "string" ||
    typeof data.complete !== "boolean" ||
    typeof data.timestamp !== "number" ||
    !Number.isFinite(data.timestamp) ||
    data.timestamp < 0
  ) {
    return null;
  }
  return data as IframeInputMessage;
}

export function parseHoverShadowMessage(
  message: IframeMessageLike,
  expected: ExpectedHoverShadowMessage,
): HoverShadowMessage | null {
  if (!expected.source || message.source !== expected.source || message.origin !== expected.origin) return null;
  if (!message.data || typeof message.data !== "object") return null;

  const data = message.data as Partial<HoverShadowMessage>;
  const validSelection =
    data.event === "open" ? data.selectedOption === "" : expected.options.includes(data.selectedOption ?? "");
  if (
    data.source !== "hover-shadow-lab" ||
    data.challengeId !== expected.challengeId ||
    (data.event !== "open" && data.event !== "select") ||
    typeof data.selectedOption !== "string" ||
    !validSelection ||
    typeof data.isTrusted !== "boolean" ||
    typeof data.timestamp !== "number" ||
    !Number.isFinite(data.timestamp) ||
    data.timestamp < 0
  ) {
    return null;
  }
  return data as HoverShadowMessage;
}
