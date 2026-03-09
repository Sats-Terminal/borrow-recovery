"use client";

type NotifyFn = (toast: {
  title: string;
  description?: string;
  tone?: "error" | "info";
}) => void;

function pushMessage(messages: string[], value: unknown) {
  if (typeof value !== "string") return;
  const trimmed = value.trim();
  if (!trimmed) return;
  if (!messages.includes(trimmed)) messages.push(trimmed);
}

function collectMessages(value: unknown, messages: string[], seen: WeakSet<object>) {
  if (typeof value === "string") {
    pushMessage(messages, value);
    return;
  }

  if (!value || typeof value !== "object") return;
  if (seen.has(value)) return;
  seen.add(value);

  if (value instanceof Error) {
    pushMessage(messages, value.message);
  }

  const record = value as Record<string, unknown>;
  pushMessage(messages, record.shortMessage);
  pushMessage(messages, record.message);
  pushMessage(messages, record.details);
  pushMessage(messages, record.reason);

  collectMessages(record.cause, messages, seen);
  collectMessages(record.error, messages, seen);
  collectMessages(record.data, messages, seen);
}

export function describeActionError(error: unknown, fallbackMessage: string): string {
  const messages: string[] = [];
  collectMessages(error, messages, new WeakSet<object>());
  return messages.join(" — ") || fallbackMessage;
}

export function reportActionError(parameters: {
  context: string;
  error: unknown;
  fallbackMessage: string;
  toastTitle: string;
  notify: NotifyFn;
}): string {
  const { context, error, fallbackMessage, toastTitle, notify } = parameters;
  const message = describeActionError(error, fallbackMessage);

  console.error(`[${context}]`, error);
  notify({
    title: toastTitle,
    description: message,
    tone: "error",
  });

  return message;
}
