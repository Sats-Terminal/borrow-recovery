"use client";

export type ActionToast = {
  id: number;
  title: string;
  description?: string;
  tone?: "error" | "info";
};

export function ActionToastViewport(props: {
  toasts: ActionToast[];
  onDismiss: (id: number) => void;
}) {
  const { toasts, onDismiss } = props;

  if (toasts.length === 0) return null;

  return (
    <div
      aria-atomic="true"
      aria-live="polite"
      className="pointer-events-none fixed right-4 top-4 z-50 flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2"
    >
      {toasts.map((toast) => {
        const isError = toast.tone !== "info";
        return (
          <div
            key={toast.id}
            role="status"
            className={`pointer-events-auto rounded-2xl border px-4 py-3 shadow-[0_16px_40px_rgba(15,15,15,0.14)] backdrop-blur ${
              isError
                ? "border-red-200 bg-white/95 text-zinc-900"
                : "border-[var(--line)] bg-white/95 text-zinc-900"
            }`}
          >
            <div className="flex items-start gap-3">
              <div
                className={`mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full ${
                  isError ? "bg-red-500" : "bg-zinc-900"
                }`}
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">{toast.title}</p>
                {toast.description ? (
                  <p className="mt-1 text-sm leading-5 text-[var(--muted)]">{toast.description}</p>
                ) : null}
              </div>
              <button
                type="button"
                className="shrink-0 text-xs font-medium text-[var(--muted)] hover:text-zinc-900"
                onClick={() => onDismiss(toast.id)}
              >
                Dismiss
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
