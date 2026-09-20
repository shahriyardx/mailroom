// Read-only look at the SES account: identities, config sets and SNS topics.
import { readFileSync } from "node:fs";
import {
  GetAccountCommand,
  GetEmailIdentityCommand,
  ListConfigurationSetsCommand,
  ListEmailIdentitiesCommand,
  SESv2Client,
} from "@aws-sdk/client-sesv2";
import { ListTopicsCommand, SNSClient } from "@aws-sdk/client-sns";

const env = Object.fromEntries(
  readFileSync(".env", "utf8")
    .split("\n")
    .filter((line) => line.includes("="))
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

const credentials = {
  accessKeyId: env.AWS_ACCESS_KEY_ID,
  secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
};
const region = env.AWS_REGION || "us-east-1";
const ses = new SESv2Client({ region, credentials });
const sns = new SNSClient({ region, credentials });

console.log(`region: ${region}\n`);

const account = await ses.send(new GetAccountCommand({}));
console.log("ACCOUNT");
console.log(`  production access : ${account.ProductionAccessEnabled}`);
console.log(`  enforcement       : ${account.EnforcementStatus}`);
console.log(
  `  quota             : ${account.SendQuota?.SentLast24Hours}/${account.SendQuota?.Max24HourSend} per 24h, ${account.SendQuota?.MaxSendRate}/sec\n`,
);

const identities = await ses.send(new ListEmailIdentitiesCommand({ PageSize: 100 }));
console.log("IDENTITIES");
for (const item of identities.EmailIdentities ?? []) {
  const detail = await ses.send(new GetEmailIdentityCommand({ EmailIdentity: item.IdentityName }));
  console.log(
    `  ${item.IdentityName}  [${item.IdentityType}]  verified=${item.VerificationStatus}  sending=${item.SendingEnabled}  dkim=${detail.DkimAttributes?.Status}  mailFrom=${detail.MailFromAttributes?.MailFromDomain ?? "-"} (${detail.MailFromAttributes?.MailFromDomainStatus ?? "-"})`,
  );
}
if ((identities.EmailIdentities ?? []).length === 0) console.log("  (none)");

const sets = await ses.send(new ListConfigurationSetsCommand({ PageSize: 100 }));
console.log(`\nCONFIGURATION SETS\n  ${(sets.ConfigurationSets ?? []).join(", ") || "(none)"}`);

const topics = await sns.send(new ListTopicsCommand({}));
console.log("\nSNS TOPICS");
for (const topic of topics.Topics ?? []) console.log(`  ${topic.TopicArn}`);
if ((topics.Topics ?? []).length === 0) console.log("  (none)");
