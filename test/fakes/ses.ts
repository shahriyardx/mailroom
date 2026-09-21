/**
 * Stands in for `@/lib/ses` while the tests run.
 *
 * Only what the send path touches is here. Everything else in the real module
 * talks to SES about identities, which no test has any business doing.
 */

export interface SentCall {
  from: string;
  to: string[];
  raw: Uint8Array;
  configurationSet?: string;
}

export const sesCalls: SentCall[] = [];

type Behaviour = () => void;

let behaviour: Behaviour | null = null;
let counter = 0;

/** Every call from here on throws whatever this returns. */
export function sesFailWith(makeError: () => unknown) {
  behaviour = () => {
    throw makeError();
  };
}

/** Fails the next `times` calls, then goes back to succeeding. */
export function sesFailTimes(times: number, makeError: () => unknown) {
  let left = times;
  behaviour = () => {
    if (left > 0) {
      left -= 1;
      throw makeError();
    }
  };
}

export function sesSucceed() {
  behaviour = null;
}

export function sesReset() {
  sesCalls.length = 0;
  behaviour = null;
  counter = 0;
}

export async function sendRawEmail(options: {
  raw: Uint8Array;
  from: string;
  to: string[];
  configurationSet?: string;
}) {
  sesCalls.push({
    from: options.from,
    to: options.to,
    raw: options.raw,
    configurationSet: options.configurationSet,
  });
  behaviour?.();
  counter += 1;
  return { messageId: `ses-fake-${counter}` };
}

/** An AWS-shaped error, so the classifier sees what it would see in life. */
export function awsError(name: string, extra: Record<string, unknown> = {}) {
  const error = new Error(`${name} from the fake`) as Error & Record<string, unknown>;
  error.name = name;
  Object.assign(error, extra);
  return error;
}
