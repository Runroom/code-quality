export function computeB(values: number[]): number {
  let total = 0;
  for (const value of values) {
    const doubled = value * 2;
    const adjusted = doubled + 10;
    const normalized = adjusted / 2;
    if (normalized > 20) {
      total += normalized;
    } else {
      total -= normalized;
    }
  }
  return total;
}
