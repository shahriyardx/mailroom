/**
 * Creates the SES delivery-event pipeline:
 *   configuration set -> event destination -> SNS topic
 *
 * Safe to run more than once: everything is created only if missing, and the
 * SNS topic policy is appended to rather than replaced.
 *
 * Usage: node scripts/ses-setup-events.mjs [--name mail-events] [--endpoint https://host/api/ses/events]
 */
import { readFileSync, writeFileSync } from "node:fs";
import {
  CreateConfigurationSetCommand,
  CreateConfigurationSetEventDestinationCommand,
  GetConfigurationSetEventDestinationsCommand,
  SESv2Client,
  UpdateConfigurationSetEventDestinationCommand,
} from "@aws-sdk/client-sesv2";
import {
  CreateTopicCommand,
  GetTopicAttributesCommand,
  ListSubscriptionsByTopicCommand,
  SNSClient,
  SetTopicAttributesCommand,
  SubscribeCommand,
} from "@aws-sdk/client-sns";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? fallback : args[index + 1];
};

const NAME = flag("name", "mail-events");
const ENDPOINT = flag("endpoint", "");
const DESTINATION = "sns-events";

const EVENTS = [
  "SEND",
  "DELIVERY",
  "BOUNCE",
  "COMPLAINT",
  "REJECT",
  "DELIVERY_DELAY",
  "RENDERING_FAILURE",
];

function readEnv(path = ".env") {
  return Object.fromEntries(
    readFileSync(path, "utf8")
      .split("\n")
      .filter((line) => line.includes("=") && !line.trim().startsWith("#"))
      .map((line) => {
        const i = line.indexOf("=");
        return [
          line.slice(0, i).trim(),
          line
            .slice(i + 1)
            .trim()
            .replace(/^"|"$/g, ""),
        ];
      }),
  );
}

/** Rewrites one key in .env, keeping comments and order intact. */
function setEnv(key, value, path = ".env") {
  const body = readFileSync(path, "utf8");
  const line = `${key}="${value}"`;
  const pattern = new RegExp(`^${key}=.*$`, "m");
  writeFileSync(
    path,
    pattern.test(body) ? body.replace(pattern, line) : `${body.trimEnd()}\n${line}\n`,
  );
}

const env = readEnv();
const region = env.AWS_REGION || "us-east-1";
const credentials = {
  accessKeyId: env.AWS_ACCESS_KEY_ID,
  secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
};

const ses = new SESv2Client({ region, credentials });
const sns = new SNSClient({ region, credentials });

/* 1. SNS topic (CreateTopic returns the existing one if the name is taken) */
const topic = await sns.send(new CreateTopicCommand({ Name: NAME }));
const topicArn = topic.TopicArn;
const accountId = topicArn.split(":")[4];
console.log(`topic        : ${topicArn}`);

/* 2. Let SES publish to it, without dropping the existing policy */
const attributes = await sns.send(new GetTopicAttributesCommand({ TopicArn: topicArn }));
const policy = JSON.parse(
  attributes.Attributes?.Policy ?? '{"Version":"2012-10-17","Statement":[]}',
);
const hasSes = (policy.Statement ?? []).some((item) => item.Sid === "AllowSESPublish");

if (!hasSes) {
  policy.Statement.push({
    Sid: "AllowSESPublish",
    Effect: "Allow",
    Principal: { Service: "ses.amazonaws.com" },
    Action: "sns:Publish",
    Resource: topicArn,
    Condition: { StringEquals: { "AWS:SourceAccount": accountId } },
  });
  await sns.send(
    new SetTopicAttributesCommand({
      TopicArn: topicArn,
      AttributeName: "Policy",
      AttributeValue: JSON.stringify(policy),
    }),
  );
  console.log("topic policy : SES publish allowed");
} else {
  console.log("topic policy : already allows SES");
}

/* 3. Configuration set */
try {
  await ses.send(new CreateConfigurationSetCommand({ ConfigurationSetName: NAME }));
  console.log(`config set   : ${NAME} created`);
} catch (error) {
  if (error.name !== "AlreadyExistsException") throw error;
  console.log(`config set   : ${NAME} already exists`);
}

/* 4. Event destination pointing at the topic */
const destination = {
  Enabled: true,
  MatchingEventTypes: EVENTS,
  SnsDestination: { TopicArn: topicArn },
};

const existing = await ses.send(
  new GetConfigurationSetEventDestinationsCommand({ ConfigurationSetName: NAME }),
);
const already = (existing.EventDestinations ?? []).some((item) => item.Name === DESTINATION);

if (already) {
  await ses.send(
    new UpdateConfigurationSetEventDestinationCommand({
      ConfigurationSetName: NAME,
      EventDestinationName: DESTINATION,
      EventDestination: destination,
    }),
  );
  console.log(`destination  : ${DESTINATION} updated (${EVENTS.length} event types)`);
} else {
  await ses.send(
    new CreateConfigurationSetEventDestinationCommand({
      ConfigurationSetName: NAME,
      EventDestinationName: DESTINATION,
      EventDestination: destination,
    }),
  );
  console.log(`destination  : ${DESTINATION} created (${EVENTS.length} event types)`);
}

/* 5. Optional HTTPS subscription, once the app is publicly reachable */
if (ENDPOINT) {
  const subs = await sns.send(new ListSubscriptionsByTopicCommand({ TopicArn: topicArn }));
  const found = (subs.Subscriptions ?? []).find((item) => item.Endpoint === ENDPOINT);
  if (found) {
    console.log(`subscription : already present (${found.SubscriptionArn})`);
  } else {
    const result = await sns.send(
      new SubscribeCommand({ TopicArn: topicArn, Protocol: "https", Endpoint: ENDPOINT }),
    );
    console.log(`subscription : ${result.SubscriptionArn}`);
    console.log("               AWS is calling that URL now; the app confirms it by itself.");
  }
} else {
  console.log("subscription : skipped — re-run with --endpoint https://host/api/ses/events");
}

/* 6. Record it for the app */
setEnv("SES_CONFIGURATION_SET", NAME);
setEnv("SES_SNS_TOPIC_ARN", topicArn);
console.log("\n.env updated: SES_CONFIGURATION_SET, SES_SNS_TOPIC_ARN");
