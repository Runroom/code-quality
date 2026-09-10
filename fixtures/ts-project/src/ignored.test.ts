export const ignored = "ignored";

export function ignoredComplexity(
  first: number,
  second: number,
  third: number,
  fourth: number,
  fifth: number,
): number {
  let result = first + second + third + fourth + fifth;
  if (first > 0) result += 1;
  if (second > 0) result += 1;
  if (third > 0) result += 1;
  if (fourth > 0) result += 1;
  if (fifth > 0) result += 1;
  if (first > second) result += 1;
  if (second > third) result += 1;
  if (third > fourth) result += 1;
  if (fourth > fifth) result += 1;
  if (fifth > first) result += 1;
  if (result > 0) result += 1;
  if (first === fifth) result += 1;
  return result;
}

export function computeA(values: number[]): number {
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
