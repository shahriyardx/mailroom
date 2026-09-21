import "server-only";

import { db } from "@/db";
import { type Template, template } from "@/db/schema";
import { SLUG_PATTERN, TemplateError, renderTemplateParts, slugify } from "@/lib/template";
import { newId } from "@/lib/utils";
import { and, asc, eq, ne } from "drizzle-orm";

/**
 * Saved subjects and bodies, looked up by a name a program can hold onto.
 *
 * Both an id and a slug find one, because both are useful: an id is what the
 * API hands back, and a slug is what somebody types into a config file.
 */

export class TemplateNotFound extends Error {
  constructor(reference: string) {
    super(`No template called "${reference}"`);
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

export async function findTemplate(orgId: string, reference: string): Promise<Template | null> {
  const wanted = reference.trim();
  if (!wanted) return null;

  const [byId] = await db
    .select()
    .from(template)
    .where(and(eq(template.organizationId, orgId), eq(template.id, wanted)))
    .limit(1);
  if (byId) return byId;

  const [bySlug] = await db
    .select()
    .from(template)
    .where(and(eq(template.organizationId, orgId), eq(template.slug, wanted.toLowerCase())))
    .limit(1);
  return bySlug ?? null;
}

export interface TemplateInput {
  name: string;
  slug?: string | null;
  description?: string | null;
  subject?: string;
  html?: string | null;
  text?: string | null;
}

export class TemplateConflict extends Error {
  constructor(slug: string) {
    super(`Another template already uses the name "${slug}"`);
    this.name = "TemplateConflict";
  }
}

export class TemplateInvalid extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TemplateInvalid";
  }
}

function checkSlug(value: string) {
  if (!value) throw new TemplateInvalid("A template needs a name");
  if (!SLUG_PATTERN.test(value)) {
    throw new TemplateInvalid(
      "slug can only contain lowercase letters, numbers and single hyphens",
    );
  }
  return value;
}

export async function createTemplate(orgId: string, input: TemplateInput, userId?: string) {
  const name = input.name.trim();
  if (!name) throw new TemplateInvalid("A template needs a name");

  const slug = checkSlug(input.slug?.trim().toLowerCase() || slugify(name));

  const clash = await findTemplate(orgId, slug);
  if (clash) throw new TemplateConflict(slug);

  const id = newId("tpl");
  const [row] = await db
    .insert(template)
    .values({
      id,
      organizationId: orgId,
      name,
      slug,
      description: input.description?.trim() || null,
      subject: input.subject ?? "",
      html: input.html || null,
      text: input.text || null,
      createdBy: userId ?? null,
    })
    .returning();

  return row!;
}

export async function updateTemplate(orgId: string, id: string, input: Partial<TemplateInput>) {
  const existing = await findTemplate(orgId, id);
  if (!existing) throw new TemplateNotFound(id);

  const slug =
    input.slug === undefined || input.slug === null
      ? existing.slug
      : checkSlug(input.slug.trim().toLowerCase());

  if (slug !== existing.slug) {
    const [clash] = await db
      .select({ id: template.id })
      .from(template)
      .where(
        and(
          eq(template.organizationId, orgId),
          eq(template.slug, slug),
          ne(template.id, existing.id),
        ),
      )
      .limit(1);
    if (clash) throw new TemplateConflict(slug);
  }

  const [row] = await db
    .update(template)
    .set({
      name: input.name?.trim() || existing.name,
      slug,
      description:
        input.description === undefined ? existing.description : input.description?.trim() || null,
      subject: input.subject === undefined ? existing.subject : input.subject,
      html: input.html === undefined ? existing.html : input.html || null,
      text: input.text === undefined ? existing.text : input.text || null,
      updatedAt: new Date(),
    })
    .where(eq(template.id, existing.id))
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
 * caller turns into something the sender can act on: the wrong name, or the
 * right name with a value missing.
 */
export async function renderFor(
  orgId: string,
  reference: string,
  data: Record<string, unknown>,
): Promise<RenderedTemplate> {
  const row = await findTemplate(orgId, reference);
  if (!row) throw new TemplateNotFound(reference);

  const rendered = renderTemplateParts(
    { subject: row.subject, html: row.html, text: row.text },
    data,
  );

  return { ...rendered, template: row };
}

export { TemplateError };
