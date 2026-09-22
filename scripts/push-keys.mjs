/**
 * Prints a VAPID key pair for desktop notifications.
 *
 * The pair identifies this instance to the browsers' push services: the
 * private half signs every message, the public half is what the browser
 * subscribes against. Generate it once, put both in the environment, and
 * leave them alone — changing them makes every existing subscription
 * unusable, and everybody has to turn notifications on again.
 *
 *   pnpm push:keys
 */
import webpush from "web-push";

const { publicKey, privateKey } = webpush.generateVAPIDKeys();

console.log(`
Add these to your environment, then restart Mailroom.

VAPID_PUBLIC_KEY="${publicKey}"
VAPID_PRIVATE_KEY="${privateKey}"
VAPID_SUBJECT="mailto:you@example.com"

VAPID_SUBJECT is how a push service reaches whoever runs this instance if
something goes wrong. Any address you read is fine.

Keep VAPID_PRIVATE_KEY secret. The public one is meant to be handed out.
`);
