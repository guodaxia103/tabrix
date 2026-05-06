export type FallbackRefMap = Array<{ ref: string; selector: string } | null>;

/** Parallel to `elements` (same length): entry or `null` when no selector. */
export function buildFallbackRefMap(elements: any[]): FallbackRefMap {
  return (elements || []).slice(0, 150).map((element: any, index: number) => {
    const selector = typeof element?.selector === 'string' ? element.selector.trim() : '';
    if (!selector) return null;
    return {
      ref: `ref_fallback_${index + 1}`,
      selector,
    };
  });
}

export function formatElementsAsPageContent(elements: any[], refMap: any[]): string {
  const out: string[] = [];
  for (let index = 0; index < (elements || []).length; index += 1) {
    const element = elements[index];
    const elementType =
      typeof element?.type === 'string' && element.type ? element.type : 'element';
    const rawText = typeof element?.text === 'string' ? element.text.trim() : '';
    const text =
      rawText.length > 0
        ? ` "${rawText.replace(/\s+/g, ' ').slice(0, 100).replace(/"/g, '\\"')}"`
        : '';
    const selector =
      typeof element?.selector === 'string' && element.selector
        ? ` selector="${element.selector}"`
        : '';
    const href = typeof element?.href === 'string' && element.href ? ` href="${element.href}"` : '';
    const refLabel = typeof refMap[index]?.ref === 'string' ? ` [ref=${refMap[index].ref}]` : '';
    const coords =
      element?.coordinates &&
      Number.isFinite(element.coordinates.x) &&
      Number.isFinite(element.coordinates.y)
        ? ` (x=${Math.round(element.coordinates.x)},y=${Math.round(element.coordinates.y)})`
        : '';
    out.push(`- ${elementType}${text}${refLabel}${selector}${href}${coords}`);
    if (out.length >= 150) break;
  }
  return out.join('\n');
}
