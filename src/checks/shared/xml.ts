function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function xml(
  tag: string,
  attrs: Record<string, string>,
  children: string[] = [],
): string {
  const attributes = Object.entries(attrs)
    .map(([name, value]) => ` ${name}="${escapeXml(value)}"`)
    .join("");
  if (children.length === 0) return `<${tag}${attributes}/>`;
  return `<${tag}${attributes}>${children.join("")}</${tag}>`;
}
