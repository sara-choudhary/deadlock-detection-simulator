// Show a vector as text, for example [0, 1, 0].
export function formatVector(values: number[]): string {
  return `[${values.join(", ")}]`;
}