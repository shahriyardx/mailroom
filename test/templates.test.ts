import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { sesCalls, sesReset } from "./fakes/ses";
import { type Scratch, type Seeded, makeScratchDatabase, seedAccount } from "./helpers/db";

let scratch: Scratch;
let account: Seeded;

before(async () => {
  scratch = makeScratchDatabase("tpl");
  account = await seedAccount();
});

after(async () => {
  const { rawSql } = await import("@/db");
  await rawSql().end({ timeout: 1 });
  scratch.drop();
});

beforeEach(async () => {
  sesReset();
  const { db } = await import("@/db");
  const { message, sendJob, template } = await import("@/db/schema");
  await db.delete(sendJob);
  await db.delete(message);
  await db.delete(template);
});

function caller() {
  return {
    keyId: "key_test",
    keyName: "test",
    orgId: account.orgId,
    reach: { mailboxIds: [], domainIds: [], unrestricted: true },
    scopes: new Set(["*"]),
    rawScopes: ["*"],
    rateLimit: 300,
    testMode: false,
  };
}

/* -------------------------------------------------------------------------- */

describe("filling a template in", () => {
  it("substitutes, including into nested values", async () => {
    const { renderTemplate } = await import("@/lib/template");
    assert.equal(
      renderTemplate("Hello {{ name }}, from {{ company.name }}", {
        name: "Ada",
        company: { name: "Acme" },
      }),
      "Hello Ada, from Acme",
    );
  });

  it("escapes what it puts into HTML", async () => {
    const { renderTemplate } = await import("@/lib/template");
    const out = renderTemplate("<p>Hi {{ name }}</p>", { name: '<script>alert("x")</script>' });
    assert.equal(out, "<p>Hi &lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;</p>");
  });

  it("leaves the triple form alone, for markup that is meant to be markup", async () => {
    const { renderTemplate } = await import("@/lib/template");
    assert.equal(renderTemplate("{{{ body }}}", { body: "<b>bold</b>" }), "<b>bold</b>");
  });

  it("refuses rather than sending a hole", async () => {
    const { TemplateError, renderTemplate } = await import("@/lib/template");
    assert.throws(
      () => renderTemplate("Hi {{ name }} of {{ company }}", {}),
      (error: unknown) => {
        assert.ok(error instanceof TemplateError);
        assert.deepEqual((error as InstanceType<typeof TemplateError>).missing, [
          "name",
          "company",
        ]);
        return true;
      },
    );
  });

  it("does not treat an object's own machinery as data", async () => {
    const { renderTemplate } = await import("@/lib/template");
    assert.throws(() => renderTemplate("{{ constructor }}", {}));
    assert.throws(() => renderTemplate("{{ a.__proto__ }}", { a: {} }));
  });

  it("lists what a template asks for", async () => {
    const { templateVariables } = await import("@/lib/template");
    assert.deepEqual(
      templateVariables("Hi {{ name }}", "<p>{{ name }} owes {{ amount }}</p>", "{{{ footer }}}"),
      ["name", "amount", "footer"],
    );
  });

  it("makes a usable slug out of a name", async () => {
    const { slugify } = await import("@/lib/template");
    assert.equal(slugify("Welcome Email!"), "welcome-email");
    assert.equal(slugify("  Order — shipped  "), "order-shipped");
  });
});

/* -------------------------------------------------------------------------- */

describe("keeping templates", () => {
  it("saves one and finds it by id or by slug", async () => {
    const { createTemplate, findTemplate } = await import("@/server/templates");
    const row = await createTemplate(account.orgId, {
      name: "Welcome Email",
      subject: "Welcome, {{ name }}",
      html: "<p>Hello {{ name }}</p>",
    });

    assert.equal(row.slug, "welcome-email");
    assert.equal((await findTemplate(account.orgId, row.id))?.id, row.id);
    assert.equal((await findTemplate(account.orgId, "welcome-email"))?.id, row.id);
    assert.equal(await findTemplate("org_elsewhere", row.id), null);
  });

  it("refuses a name another template already has", async () => {
    const { TemplateConflict, createTemplate } = await import("@/server/templates");
    await createTemplate(account.orgId, { name: "Receipt" });
    await assert.rejects(
      createTemplate(account.orgId, { name: "Receipt" }),
      (error: unknown) => error instanceof TemplateConflict,
    );
  });

  it("refuses a slug that is not one", async () => {
    const { TemplateInvalid, createTemplate } = await import("@/server/templates");
    await assert.rejects(
      createTemplate(account.orgId, { name: "Bad", slug: "Not A Slug" }),
      (error: unknown) => error instanceof TemplateInvalid,
    );
  });

  it("changes only what it is given", async () => {
    const { createTemplate, updateTemplate } = await import("@/server/templates");
    const row = await createTemplate(account.orgId, {
      name: "Receipt",
      subject: "Your receipt",
      html: "<p>Thanks</p>",
    });

    const updated = await updateTemplate(account.orgId, row.id, { subject: "Your invoice" });
    assert.equal(updated.subject, "Your invoice");
    assert.equal(updated.html, "<p>Thanks</p>", "the body was left alone");
    assert.equal(updated.slug, "receipt");
  });

  it("copies one under a name nothing else is using", async () => {
    const { createTemplate, duplicateTemplate } = await import("@/server/templates");
    const row = await createTemplate(account.orgId, {
      name: "Welcome",
      subject: "Hello",
      html: "<p>Hello</p>",
    });

    const copy = await duplicateTemplate(account.orgId, row.id);
    assert.notEqual(copy.id, row.id, "a copy is a second template, not the same row");
    assert.equal(copy.name, "Welcome (copy)");
    assert.equal(copy.slug, "welcome-copy");
    assert.equal(copy.html, "<p>Hello</p>", "the body came with it");

    // Copying the copy counts rather than failing on the name.
    const again = await duplicateTemplate(account.orgId, row.id);
    assert.equal(again.slug, "welcome-copy-2");
  });

  it("will not copy a template belonging to somebody else", async () => {
    const { TemplateNotFound, createTemplate, duplicateTemplate } = await import(
      "@/server/templates"
    );
    const row = await createTemplate(account.orgId, { name: "Private" });
    await assert.rejects(
      duplicateTemplate("org_elsewhere", row.id),
      (error: unknown) => error instanceof TemplateNotFound,
    );
  });
});

/* -------------------------------------------------------------------------- */

describe("sending one", () => {
  async function saveWelcome() {
    const { createTemplate } = await import("@/server/templates");
    return createTemplate(account.orgId, {
      name: "Welcome",
      subject: "Welcome, {{ name }}",
      html: "<p>Hello {{ name }}, you owe {{ amount }}.</p>",
      text: "Hello {{ name }}, you owe {{ amount }}.",
    });
  }

  it("uses the saved wording, filled in", async () => {
    await saveWelcome();
    const { sendOne } = await import("@/server/api-send");

    const result = await sendOne(caller(), {
      from: account.address,
      to: "someone@example.com",
      subject: "",
      template: "welcome",
      data: { name: "Ada", amount: "£10" },
    });

    assert.equal(result.subject, "Welcome, Ada");

    const { db } = await import("@/db");
    const { message } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    const [row] = await db.select().from(message).where(eq(message.id, result.id));

    assert.equal(row?.subject, "Welcome, Ada");
    assert.ok(row?.htmlBody?.includes("you owe £10"));
    assert.ok(row?.textBody?.includes("Hello Ada"));
    assert.equal(sesCalls.length, 1);
  });

  it("lets the request override the saved subject", async () => {
    await saveWelcome();
    const { sendOne } = await import("@/server/api-send");

    const result = await sendOne(caller(), {
      from: account.address,
      to: "someone@example.com",
      subject: "A different line",
      template: "welcome",
      data: { name: "Ada", amount: "£10" },
    });

    assert.equal(result.subject, "A different line");
  });

  it("says which value is missing rather than sending a hole", async () => {
    await saveWelcome();
    const { sendOne } = await import("@/server/api-send");
    const { SendError } = await import("@/server/send");

    await assert.rejects(
      sendOne(caller(), {
        from: account.address,
        to: "someone@example.com",
        subject: "",
        template: "welcome",
        data: { name: "Ada" },
      }),
      (error: unknown) => {
        assert.ok(error instanceof SendError);
        assert.equal((error as InstanceType<typeof SendError>).status, 422);
        assert.match((error as Error).message, /amount/);
        return true;
      },
    );

    assert.equal(sesCalls.length, 0, "nothing went out");
  });

  it("says so when there is no such template", async () => {
    const { sendOne } = await import("@/server/api-send");
    const { SendError } = await import("@/server/send");

    await assert.rejects(
      sendOne(caller(), {
        from: account.address,
        to: "someone@example.com",
        subject: "",
        template: "nothing-like-this",
      }),
      (error: unknown) => {
        assert.equal((error as InstanceType<typeof SendError>).status, 404);
        return true;
      },
    );
  });

  it("will not reach a template in another account", async () => {
    const { db } = await import("@/db");
    const { organization } = await import("@/db/schema");
    const { newId } = await import("@/lib/utils");
    const { createTemplate } = await import("@/server/templates");
    const { sendOne } = await import("@/server/api-send");
    const { SendError } = await import("@/server/send");

    const otherOrg = newId("org");
    await db
      .insert(organization)
      .values({ id: otherOrg, name: "Someone Else", slug: `other-${otherOrg}` });
    const theirs = await createTemplate(otherOrg, { name: "Theirs", subject: "Private" });

    await assert.rejects(
      sendOne(caller(), {
        from: account.address,
        to: "someone@example.com",
        subject: "",
        template_id: theirs.id,
      }),
      (error: unknown) => {
        assert.ok(error instanceof SendError);
        assert.equal((error as InstanceType<typeof SendError>).status, 404);
        return true;
      },
    );

    assert.equal(sesCalls.length, 0);
  });

  it("can be scheduled like any other send", async () => {
    await saveWelcome();
    const { sendOne } = await import("@/server/api-send");

    const result = await sendOne(caller(), {
      from: account.address,
      to: "someone@example.com",
      subject: "",
      template: "welcome",
      data: { name: "Ada", amount: "£10" },
      scheduled_at: "in 2 hours",
    });

    assert.equal(result.status, "scheduled");
    assert.ok(result.scheduled_at);
    assert.equal(sesCalls.length, 0);
  });
});

/* -------------------------------------------------------------------------- */

describe("template scopes", () => {
  it("writing implies reading", async () => {
    const { expandScopes, hasScope } = await import("@/lib/api-scopes");
    const granted = expandScopes(["templates:write"]);
    assert.equal(hasScope(granted, "templates:read"), true);
  });

  it("a send-only key can still read templates", async () => {
    const { PRESETS, expandScopes, hasScope } = await import("@/lib/api-scopes");
    const preset = PRESETS.find((entry) => entry.id === "send");
    assert.ok(preset);
    assert.equal(hasScope(expandScopes(preset.scopes), "templates:read"), true);
    assert.equal(hasScope(expandScopes(preset.scopes), "templates:write"), false);
  });
});
