export function normalizedText(value: string | null | undefined) {
  const trimmed = value?.trim().toLowerCase();
  return trimmed || undefined;
}
