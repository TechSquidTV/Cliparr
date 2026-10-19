export function normalizedText(value: string | null | undefined) {
  const trimmed = value?.trim().toLowerCase();
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- Empty or whitespace-only text is missing.
  return trimmed || undefined;
}
