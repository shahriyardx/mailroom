/**
 * `next/headers` outside a request.
 *
 * Nothing under test reads a cookie or a header — the modules that do are
 * only on the path because a server module imports the one that imports them
 * — so this exists to be importable and to say nothing.
 */
export async function cookies() {
  return {
    get: () => undefined,
    getAll: () => [],
    has: () => false,
  };
}

export async function headers() {
  return new Headers();
}
