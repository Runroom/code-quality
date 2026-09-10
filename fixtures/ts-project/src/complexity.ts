export function busy(a: number, b: number, c: number, d: number, e: number): number {
  let result = a + b + c + d + e;
  if (a > 0) result += 1;
  if (b > 0) result += 1;
  if (c > 0) result += 1;
  if (d > 0) result += 1;
  if (e > 0) result += 1;
  if (a > b) result += 1;
  if (b > c) result += 1;
  if (c > d) result += 1;
  if (d > e) result += 1;
  if (e > a) result += 1;
  if (result > 0) result += 1;
  if (a > 0) {
    if (b > 0) {
      if (c > 0) {
        if (d > 0) result += 1;
      }
    }
  }
  setTimeout(() => {
    setTimeout(() => {
      setTimeout(() => {
        setTimeout(() => { result += 1; }, 0);
      }, 0);
    }, 0);
  }, 0);
  result += 1;
  result += 1;
  result += 1;
  result += 1;
  result += 1;
  result += 1;
  result += 1;
  result += 1;
  result += 1;
  result += 1;
  result += 1;
  result += 1;
  result += 1;
  result += 1;
  result += 1;
  result += 1;
  result += 1;
  result += 1;
  result += 1;
  result += 1;
  result += 1;
  result += 1;
  result += 1;
  result += 1;
  result += 1;
  result += 1;
  result += 1;
  result += 1;
  result += 1;
  result += 1;
  result += 1;
  result += 1;
  result += 1;
  result += 1;
  result += 1;
  result += 1;
  result += 1;
  result += 1;
  result += 1;
  result += 1;
  result += 1;
  result += 1;
  result += 1;
  result += 1;
  result += 1;
  result += 1;
  result += 1;
  result += 1;
  result += 1;
  result += 1;
  result += 1;
  result += 1;
  result += 1;
  result += 1;
  result += 1;
  result += 1;
  result += 1;
  result += 1;
  result += 1;
  result += 1;
  return result;
}
