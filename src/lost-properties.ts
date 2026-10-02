/**
 * Warn about object-valued properties that arrived as attributes.
 *
 * React 19 sets a prop as a property only when the element already has it,
 * so on a custom element that is not defined yet it calls
 * `setAttribute(name, String(value))` instead. An object prop such as
 * `adapters={…}` then reaches the element as the attribute
 * `adapters="[object Object]"`, and the object itself is gone. Nothing can
 * recover it, so the element says so instead of loading without it.
 *
 * Pure module — no element imports.
 */

/** Elements already warned about: `connectedCallback` runs on every move. */
const warned = new WeakSet<Element>();

/**
 * `console.warn` once per element for each of `properties` (attribute name →
 * property name) whose attribute holds a stringified object.
 */
export function warnLostProperties(
  el: Element,
  properties: Record<string, string>
): void {
  if (warned.has(el)) return;
  const tag = el.localName;
  for (const [attribute, property] of Object.entries(properties)) {
    const value = el.getAttribute(attribute);
    if (value === null || !value.includes('[object ')) continue;
    warned.add(el);
    console.warn(
      `[${tag}] \`${property}\` was set as the attribute ${attribute}="${value}", so its value was lost. ` +
        `React 19 does this when it renders <${tag}> before the element is defined: ` +
        `import the element before rendering it, or set \`${property}\` from a ref.`
    );
  }
}
