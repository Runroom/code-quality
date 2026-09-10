export function Component({ x }: { x: () => void }) {
  return <div onClick={() => x()} />;
}
