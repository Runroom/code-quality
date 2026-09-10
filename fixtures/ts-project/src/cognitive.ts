export function nested(value: number): number {
  if (value > 0) {
    if (value > 1) {
      if (value > 2) {
        if (value > 3) {
          if (value > 4) {
            if (value > 5) return value;
          }
        }
      }
    }
  }
  return 0;
}
