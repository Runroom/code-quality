export function first(a: number) { return a; }
export class Foo {
  bar() { if (true) { for (;;) { break; } } return 1; }
  baz() { return [1, 2].map(() => 1).map(() => 2); }
}
export const named = (x: number) => x;
export const obj = { key: function () { return 0; } };
