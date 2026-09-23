# Templates

**Settings → Templates**, or **Templates** in the campaigns view. The same
screen either way.

A template is a subject and a body you save once and send by name. Your code
passes the name and the values that go in the holes; the words, the layout and
the colours stay here, where somebody can change them without a deploy.

## The builder

A template opens on a page of its own: a palette on the left, the email in the
middle, and everything about the selected block on the right.

Click a block in the palette to put it at the end, or drag it to land it
between two others. Drag a block already on the canvas to move it. Headings,
text, quotes and table cells are typed where they sit rather than in the side
panel.

| Block | For |
| --- | --- |
| Heading | Three sizes: title, heading, subheading. |
| Text | Paragraphs, with bold, italic, links and lists. |
| Quote | An indented line with a coloured bar. |
| Code | A monospaced block. |
| Image | From the media library, or any address. |
| YouTube | The video's thumbnail, linked to it. |
| Button | A real one that Outlook draws properly. |
| Columns | Two to four, side by side, stacking on a phone. |
| Table | Bordered, with an optional heading row. |
| Divider, Spacer | Room and lines. |
| Social links | A row of links. |
| Unsubscribe | The footer a broadcast needs. |
| Raw HTML | For whatever none of the above covers. |

Every block carries its own colour, size, line height, letter spacing, weight,
padding, background and border, under **Typography**, **Spacing** and
**Background & border**. The **Page** tab holds the things that apply to the
whole email: the page colour behind the card, the card itself, the width, the
font, and the text and link colours.

`Ctrl`+`Z` takes back the last change and `Ctrl`+`Shift`+`Z` puts it back, or
use the two arrows in the bar. A field you are typing in keeps its own undo, so
the shortcut takes back the sentence rather than the block it is in.

### The preheader

**Page → Inbox** holds the grey line an inbox prints after the subject.

Leave it empty and the client picks the first words of the email instead, which
is how "View this email in your browser" becomes the summary of a newsletter.
Around 80 characters is what most clients show.

### Leaving a block off one screen

**Visibility → Show on**, on any block: *Everything*, *Desktop only*, or
*Phone only*.

A media query does the hiding. Outlook has none, so it shows whatever a desktop
would have seen — which is the right way round, but it does mean a phone-only
block is not a way to keep something out of Outlook. Use it for a wide picture
a phone has no room for, never for anything the message needs to make sense.

### Duplicating one

The copy button on a row in the template list makes a second template with the
same body under a free name — `welcome` becomes `welcome-copy` — and opens it.
The original keeps sending exactly as it did.

## Variables

Anything in double braces is filled in when you send.

```
Hi {{ name }}, your order {{ order.id }} is on its way.
```

`{{ name }}` escapes what it puts in, so a value arriving from a form cannot
write tags into mail going out under your domain. `{{{ name }}}` does not, for
a value that is already markup. A dot reaches into an object.

A missing value is an error rather than an empty string: `Hi ,` going to a
customer is worse than a 422 telling the caller what it forgot.

The **Details** tab lists every variable the template currently asks for.

## Test send

**Test send** in the bar mails the template to one address through the ordinary
send path — the same code a real send uses, so an unverified domain or a
refused address is refused here rather than in front of a list. Variables are
filled with their own names in brackets, so you can see where they land.

The preview beside it is a browser drawing HTML written for mail clients, which
is the one thing it cannot tell you about. Send yourself a copy before a list
gets it.

**Preview** offers three switches:

- **Desktop** and **Phone** change the width. The phone frame is narrow enough
  that the email's own rules for a small screen apply — columns stack, and
  anything set to desktop only disappears.
- **Dark client** shows what a client that forces dark mode does: it inverts
  the colours and leaves the pictures alone. This is where a dark logo on a
  dark background turns up before a customer finds it.

## HTML

The **HTML** tab shows what the builder compiles to. It is read-only and
rewritten on every change, with a button to copy it — an editable copy of
generated output is a promise the builder cannot keep, because the next click
on the canvas overwrites it.

Nothing reads arbitrary email HTML back into blocks, so the two doors between
the builder and hand-written HTML are both one-way and both labelled:

- **Take it over** copies the compiled HTML into an editor and leaves the
  builder behind.
- **Build it instead**, on a hand-written template, starts a fresh canvas and
  replaces the HTML the next time you save.

A template created through the API carries HTML and no blocks, so it opens
hand-written.

## Media

**Settings → Media** holds pictures your mail can point at. Upload a file and
it gets an address anybody can fetch — which is the point: an image in an
email is fetched by whoever opens the message, days later, from a machine that
has never heard of your instance.

The address is unguessable and it is the whole of the secret, the same bargain
every hosted image has. Removing a file takes it out of the library and leaves
the bytes where they are, so mail already sent does not fill up with broken
images.

PNG, JPEG, GIF, WebP and PDF, up to 10 MB each.

## Sending one

```ts
await mailroom.emails.send({
  from: "hello@yourdomain.com",
  to: "customer@example.com",
  template: "order-shipped",
  data: { name: "Sam", order: { id: "A-1183" } },
});
```

The slug is what your code passes. It follows the name until you give it one of
its own, and never again after that — because by then something is holding on
to it.

::: warning Changing a slug breaks the code that used it
Anything still sending by the old name gets a 404. Mail already sent is
unaffected: the body was copied into the message when it went.
:::
