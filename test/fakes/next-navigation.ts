/**
 * `next/navigation` outside Next.
 *
 * Both of these end a request by throwing in the real thing, so throwing is
 * also the honest stand-in: a test that reaches one has gone somewhere it did
 * not mean to, and should fail saying which.
 */
export function redirect(to: string): never {
  throw new Error(`redirected to ${to}`);
}

export function notFound(): never {
  throw new Error("not found");
}
