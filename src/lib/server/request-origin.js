import "server-only";

// Next dev may normalize request.url to localhost. Preserve the browser's
// authority while accepting only a Host value, never credentials or a URL path.
export function requestOrigin(request) {
  const url = new URL(request.url);
  const authority = request.headers.get("host");
  if (!authority || /[\/\\@?#\s]/.test(authority)) return url.origin;
  try {
    return new URL(`${url.protocol}//${authority}`).origin;
  } catch {
    return url.origin;
  }
}
