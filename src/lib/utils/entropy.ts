/**
 * Calculate Shannon entropy of a string (bits per character).
 * Used to distinguish real secrets from low-entropy placeholders.
 */
export function shannonEntropy(value: string): number {
  if (value.length === 0) return 0;

  const frequencies = new Map<string, number>();
  for (const char of value) {
    frequencies.set(char, (frequencies.get(char) ?? 0) + 1);
  }

  let entropy = 0;
  for (const count of frequencies.values()) {
    const probability = count / value.length;
    entropy -= probability * Math.log2(probability);
  }

  return entropy;
}
