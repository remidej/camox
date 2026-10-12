/** Signal a missing derived page; other loader failures remain server errors. */
export function notFound() {
  return Object.assign(new Error("Page not found"), { status: 404, code: "NOT_FOUND" });
}
