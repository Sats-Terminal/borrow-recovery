"use client";

type PendingButtonLabels = {
  preparing: string;
  waitingForWallet: string;
  submitting: string;
  confirming: string;
  refreshing: string;
};

export function ButtonSpinner() {
  return (
    <span
      aria-hidden="true"
      className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white"
    />
  );
}

export function getPendingButtonLabel(
  status: string | null,
  labels: PendingButtonLabels,
): string {
  const normalized = status?.trim().toLowerCase() ?? "";

  if (!normalized) return labels.preparing;

  if (normalized.includes("refreshing")) return labels.refreshing;

  if (
    normalized.includes("signing") ||
    normalized.includes("wallet popup") ||
    normalized.includes("confirm the second wallet popup")
  ) {
    return labels.waitingForWallet;
  }

  if (
    normalized.includes("waiting for confirmation") ||
    normalized.includes("waiting for ") ||
    normalized.includes("confirmed")
  ) {
    return labels.confirming;
  }

  if (
    normalized.includes("sending") ||
    normalized.includes("submitted") ||
    normalized.includes("retrying with higher gas price")
  ) {
    return labels.submitting;
  }

  return labels.preparing;
}
