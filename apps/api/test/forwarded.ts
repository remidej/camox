/**
 * `target`'s property `key`, its methods bound to `target`: what a Proxy over a binding passes
 * through for the properties it doesn't wrap.
 */
export function forwarded<T extends object>(target: T, key: PropertyKey) {
  if (!isKeyOf(target, key)) return undefined;
  const value = target[key];
  return typeof value === "function" ? value.bind(target) : value;
}

const isKeyOf = <T extends object>(target: T, key: PropertyKey): key is keyof T => key in target;
