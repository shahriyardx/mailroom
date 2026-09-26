import "server-only";

import { db } from "@/db";
import { type Template, template } from "@/db/schema";
import { type EmailDesign, designToText, renderDesign } from "@/lib/email-blocks";
import { env } from "@/lib/env";
import { TemplateError, renderTemplateParts } from "@/lib/template";
import { newId } from "@/lib/utils";
import { and, asc, eq } from "drizzle-orm";

/**
 * Saved subjects and bodies, looked up by id.
 *
 * The id is the only handle a program gets. It never changes, so renaming a
 * template never breaks the code that sends it.
 */

export class TemplateNotFound extends Error {
  constructor(reference: string) {
    super(`No template with the id "${reference}"`);
    this.name = "TemplateNotFound";
  }
}

export async function listTemplates(orgId: string) {
  return db
    .select()
    .from(template)
    .where(eq(template.organizationId, orgId))
    .orderBy(asc(template.name));
}

export async function findTemplate(orgId: string, id: string): Promise<Template | null> {
  const wanted = id.trim();
  if (!wanted) return null;

  const [row] = await db
    .select()
    .from(template)
    .where(and(eq(template.organizationId, orgId), eq(template.id, wanted)))
    .limit(1);
  return row ?? null;
}

export interface TemplateInput {
  name: string;
  description?: string | null;
  subject?: string;
  html?: string | null;
  text?: string | null;
  /** Set by the builder. Whatever it holds decides `html` and `text`. */
  design?: EmailDesign | null;
}

/**
 * A design wins over whatever HTML came with it.
 *
 * The builder cannot send a design and a body that disagree, and neither can
 * anything else: the body is compiled here, once, on the way in. The HTML
 * column stays the thing sending reads, so a template written by hand or by
 * the API carries no design and is unaffected.
 */
function compiled(input: Partial<TemplateInput>) {
  if (!input.design) return { html: input.html, text: input.text };
  return { html: renderDesign(input.design, env.appUrl), text: designToText(input.design) };
}

export class TemplateInvalid extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TemplateInvalid";
  }
}

export async function createTemplate(orgId: string, input: TemplateInput, userId?: string) {
  const name = input.name.trim();
  if (!name) throw new TemplateInvalid("A template needs a name");

  const body = compiled(input);
  const id = newId("tpl");
  const [row] = await db
    .insert(template)
    .values({
      id,
      organizationId: orgId,
      name,
      // Nothing reads the slug any more. The id fills it, because the column
      // must be filled and must be unique in the account.
      slug: id,
      description: input.description?.trim() || null,
      subject: input.subject ?? "",
      html: body.html || null,
      text: body.text || null,
      design: input.design ?? null,
      createdBy: userId ?? null,
    })
    .returning();

  return row!;
}

export async function updateTemplate(orgId: string, id: string, input: Partial<TemplateInput>) {
  const existing = await findTemplate(orgId, id);
  if (!existing) throw new TemplateNotFound(id);

  const body = compiled(input);

  const [row] = await db
    .update(template)
    .set({
      name: input.name?.trim() || existing.name,
      description:
        input.description === undefined ? existing.description : input.description?.trim() || null,
      subject: input.subject === undefined ? existing.subject : input.subject,
      html: body.html === undefined ? existing.html : body.html || null,
      text: body.text === undefined ? existing.text : body.text || null,
      design: input.design === undefined ? existing.design : input.design,
      updatedAt: new Date(),
    })
    .where(eq(template.id, existing.id))
    .returning();

  return row!;
}

/**
 * Copies one, body and all, under a new id.
 *
 * The copy is a real second template rather than a draft of the first: the
 * point of it is to change one thing about a working email without risking
 * the one that is already being sent by id. It keeps the design, so the
 * copy opens in the builder exactly as the original does.
 */
export async function duplicateTemplate(orgId: string, id: string, userId?: string) {
  const existing = await findTemplate(orgId, id);
  if (!existing) throw new TemplateNotFound(id);

  const copyId = newId("tpl");
  const [row] = await db
    .insert(template)
    .values({
      id: copyId,
      organizationId: orgId,
      name: `${existing.name} (copy)`,
      slug: copyId,
      description: existing.description,
      subject: existing.subject,
      html: existing.html,
      text: existing.text,
      design: existing.design,
      createdBy: userId ?? null,
    })
    .returning();

  return row!;
}

export async function deleteTemplate(orgId: string, id: string) {
  const existing = await findTemplate(orgId, id);
  if (!existing) return false;
  await db.delete(template).where(eq(template.id, existing.id));
  return true;
}

/* -------------------------------------------------------------------------- */
/* Using one                                                                  */
/* -------------------------------------------------------------------------- */

export interface RenderedTemplate {
  subject: string;
  html: string | null;
  text: string | null;
  template: Template;
}

/**
 * Looks a template up and fills it in.
 *
 * Throws {@link TemplateNotFound} or {@link TemplateError}, both of which the
 * caller turns into something the sender can act on: the wrong id, or the
 * right id with a value missing.
 */
export async function renderFor(
  orgId: string,
  id: string,
  data: Record<string, unknown>,
): Promise<RenderedTemplate> {
  const row = await findTemplate(orgId, id);
  if (!row) throw new TemplateNotFound(id);

  const rendered = renderTemplateParts(
    { subject: row.subject, html: row.html, text: row.text },
    data,
  );

  return { ...rendered, template: row };
}

export { TemplateError };
