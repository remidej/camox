// The dev launcher's DNS preload maps this name to IPv4 loopback in Node.
// Using the public hostname here lets Vite print the actual selected port and
// keeps HMR, browser opening, and SDK discovery on the same cookie origin.
export function checkoutHostname(hostname: string | undefined) {
  return {
    name: "camox-checkout-hostname",
    config: () => ({
      server: { host: hostname },
    }),
  };
}
