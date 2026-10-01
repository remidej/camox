/** Workerd SSR does not use Node's checkout DNS resolver. */
export function apiTransportUrl(publicUrl: string, localServer: boolean): string {
  if (!localServer) return publicUrl;
  const url = new URL(publicUrl);
  if (!url.hostname.endsWith(".localhost")) return publicUrl;
  url.hostname = "127.0.0.1";
  return url.href.replace(/\/$/, "");
}
