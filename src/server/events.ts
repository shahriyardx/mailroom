import "server-only";

import { env } from "@/lib/env";
import {
  CreateConfigurationSetCommand,
  CreateConfigurationSetEventDestinationCommand,
  GetConfigurationSetEventDestinationsCommand,
  SESv2Client,
  UpdateConfigurationSetEventDestinationCommand,
} from "@aws-sdk/client-sesv2";
import type { EventType } from "@aws-sdk/client-sesv2";
import {
  CreateTopicCommand,
  GetSubscriptionAttributesCommand,
  GetTopicAttributesCommand,
  ListSubscriptionsByTopicCommand,
  SNSClient,
  SetTopicAttributesCommand,
  SubscribeCommand,
} from "@aws-sdk/client-sns";

/** Everything SES can tell us about a message after it leaves. */
const EVENT_TYPES: EventType[] = [
  "SEND",
  "DELIVERY",
  "BOUNCE",
  "COMPLAINT",
  "REJECT",
  "DELIVERY_DELAY",
  "RENDERING_FAILURE",
];

const DESTINATION = "sns-events";

function clients() {
  const region = env.aws.region;
  const credentials = {
    accessKeyId: env.aws.accessKeyId,
    secretAccessKey: env.aws.secretAccessKey,
  };
  return {
    ses: new SESv2Client({ region, credentials }),
    sns: new SNSClient({ region, credentials }),
  };
}

export interface EventsStatus {
  /** The name the configuration set and the SNS topic share. */
  name: string;
  endpoint: string;
  configurationSet: boolean;
  destination: { present: boolean; eventTypes: number };
  topicArn: string | null;
  subscription: "confirmed" | "pending" | "missing";
  /** Set when SES or SNS could not be reached at all. */
  error?: string;
}

/**
 * What delivery reporting looks like right now. Read-only: nothing here
 * changes anything, so the panel can show the state before you act on it.
 */
export async function eventsStatus(): Promise<EventsStatus> {
  const name = env.aws.configurationSet || "mail-events";
  const endpoint = `${env.appUrl.replace(/\/+$/, "")}/api/ses/events`;
  const base: EventsStatus = {
    name,
    endpoint,
    configurationSet: false,
    destination: { present: false, eventTypes: 0 },
    topicArn: process.env.SES_SNS_TOPIC_ARN || null,
    subscription: "missing",
  };

  try {
    const { ses, sns } = clients();

    try {
      const found = await ses.send(
        new GetConfigurationSetEventDestinationsCommand({ ConfigurationSetName: name }),
      );
      base.configurationSet = true;
      const destination = (found.EventDestinations ?? []).find((item) => item.Name === DESTINATION);
      if (destination) {
        base.destination = {
          present: destination.Enabled === true,
          eventTypes: destination.MatchingEventTypes?.length ?? 0,
        };
        base.topicArn = destination.SnsDestination?.TopicArn ?? base.topicArn;
      }
    } catch {
      // No configuration set yet, which the panel reports as "not set up".
    }

    if (base.topicArn) {
      const subs = await sns.send(new ListSubscriptionsByTopicCommand({ TopicArn: base.topicArn }));
      const mine = (subs.Subscriptions ?? []).find((item) => item.Endpoint === endpoint);
      if (mine?.SubscriptionArn?.startsWith("arn")) {
        // The topic's own counters lag, so ask the subscription itself.
        const attributes = await sns.send(
          new GetSubscriptionAttributesCommand({ SubscriptionArn: mine.SubscriptionArn }),
        );
        base.subscription =
          attributes.Attributes?.PendingConfirmation === "true" ? "pending" : "confirmed";
      } else if (mine) {
        base.subscription = "pending";
      }
    }

    return base;
  } catch (error) {
    return {
      ...base,
      error: error instanceof Error ? error.message : "AWS could not be reached",
    };
  }
}

/**
 * Creates the pipeline SES needs to report what happened to a message:
 * an SNS topic, a policy letting SES publish to it, a configuration set, an
 * event destination, and an HTTPS subscription back to this app.
 *
 * Safe to run again: each piece is created only if missing, and the topic
 * policy is appended to rather than replaced.
 */
export async function setUpEvents(): Promise<EventsStatus> {
  const name = env.aws.configurationSet || "mail-events";
  const endpoint = `${env.appUrl.replace(/\/+$/, "")}/api/ses/events`;

  if (endpoint.includes("localhost")) {
    throw new Error(
      "NEXT_PUBLIC_APP_URL still points at localhost. AWS has to be able to reach this app.",
    );
  }

  const { ses, sns } = clients();

  // CreateTopic returns the existing topic when the name is taken.
  const topic = await sns.send(new CreateTopicCommand({ Name: name }));
  const topicArn = topic.TopicArn!;
  const accountId = topicArn.split(":")[4]!;

  // Let SES publish, without dropping whatever else the policy allows.
  const attributes = await sns.send(new GetTopicAttributesCommand({ TopicArn: topicArn }));
  const policy = JSON.parse(
    attributes.Attributes?.Policy ?? '{"Version":"2012-10-17","Statement":[]}',
  );
  const statements: { Sid?: string }[] = policy.Statement ?? [];
  if (!statements.some((item) => item.Sid === "AllowSESPublish")) {
    statements.push({
      Sid: "AllowSESPublish",
      Effect: "Allow",
      Principal: { Service: "ses.amazonaws.com" },
      Action: "sns:Publish",
      Resource: topicArn,
      Condition: { StringEquals: { "AWS:SourceAccount": accountId } },
    } as { Sid: string });
    policy.Statement = statements;
    await sns.send(
      new SetTopicAttributesCommand({
        TopicArn: topicArn,
        AttributeName: "Policy",
        AttributeValue: JSON.stringify(policy),
      }),
    );
  }

  try {
    await ses.send(new CreateConfigurationSetCommand({ ConfigurationSetName: name }));
  } catch (error) {
    if ((error as { name?: string }).name !== "AlreadyExistsException") throw error;
  }

  const destination = {
    Enabled: true,
    MatchingEventTypes: EVENT_TYPES,
    SnsDestination: { TopicArn: topicArn },
  };

  const existing = await ses.send(
    new GetConfigurationSetEventDestinationsCommand({ ConfigurationSetName: name }),
  );
  const already = (existing.EventDestinations ?? []).some((item) => item.Name === DESTINATION);

  if (already) {
    await ses.send(
      new UpdateConfigurationSetEventDestinationCommand({
        ConfigurationSetName: name,
        EventDestinationName: DESTINATION,
        EventDestination: destination,
      }),
    );
  } else {
    await ses.send(
      new CreateConfigurationSetEventDestinationCommand({
        ConfigurationSetName: name,
        EventDestinationName: DESTINATION,
        EventDestination: destination,
      }),
    );
  }

  const subs = await sns.send(new ListSubscriptionsByTopicCommand({ TopicArn: topicArn }));
  const found = (subs.Subscriptions ?? []).find((item) => item.Endpoint === endpoint);
  if (!found) {
    // AWS calls the endpoint straight away; /api/ses/events confirms it.
    await sns.send(
      new SubscribeCommand({ TopicArn: topicArn, Protocol: "https", Endpoint: endpoint }),
    );
  }

  return eventsStatus();
}
