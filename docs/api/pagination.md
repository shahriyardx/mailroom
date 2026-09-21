# Pagination

Every list returns one page and, when there is more, an opaque cursor.

```json
{
  "object": "list",
  "data": [ … ],
  "has_more": true,
  "next_cursor": "1767225845000|thr_9f2c…"
}
```

Pass it back as `cursor`:

```sh
curl "https://mail.yourdomain.com/api/v1/threads?cursor=1767225845000%7Cthr_9f2c…" \
  -H "Authorization: Bearer mk_live_..."
```

`next_cursor` is **opaque**. It happens to be a sort value and an id joined by
a pipe, which is what keeps paging stable when many rows share a timestamp,
but nothing should parse it — hand it back untouched.

## Size

```
?limit=50
```

At most **100**, and **25** by default.

## A full walk

```sh
cursor=""
while :; do
  page=$(curl -s "https://mail.yourdomain.com/api/v1/threads?limit=100&cursor=$cursor" \
    -H "Authorization: Bearer $KEY")
  echo "$page" | jq -c '.data[]'
  [ "$(echo "$page" | jq -r .has_more)" = "true" ] || break
  cursor=$(echo "$page" | jq -r .next_cursor)
done
```

The [SDK](/sdk/reading#paging) does this as an `for await` loop.

## Which lists page

| Pages | One shot |
| --- | --- |
| `/emails` | `/mailboxes` |
| `/threads` | `/domains` |
| `/messages` | `/labels` |
| `/contacts` | `/webhooks` |
| `/suppressions` | |
| `/webhook-deliveries` | |

The one-shot lists cannot grow without bound, so paging them would be
ceremony for nothing.

## Ordering

Newest first, by the field that matters for the thing being listed:

| List | Sorted by |
| --- | --- |
| `/emails` | `created_at` |
| `/threads` | `last_message_at` |
| `/messages` | `received_at` |
| `/contacts` | `last_seen_at`, or `message_count` with `?order=frequent` |
| `/suppressions` | `created_at` |
| `/webhook-deliveries` | `created_at` |

## Rows that move

Paging is a snapshot taken row by row, not a transaction. A thread that gets a
new message while you are half way through a walk moves to the front and you
may see it twice; one that is deleted disappears. For anything that has to be
exact, filter on a fixed window with `since` and `until` rather than walking
an open-ended list.
