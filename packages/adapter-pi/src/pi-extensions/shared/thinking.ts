export const PI_THINKING_LEVEL_NAMES: readonly string[] = ["off", "minimal", "low", "medium", "high", "xhigh"];

export function isThinkingLevel(value: string): boolean {
  return PI_THINKING_LEVEL_NAMES.includes(value);
}
