"use client";

import { Input } from "@/components/kit";
import { resolveSendingAddressAction } from "@/server/actions";
import { useState } from "react";
import { toast } from "sonner";

/**
 * The address a campaign goes out from, typed rather than picked.
 *
 * Somebody running the campaigns view does not think in mailboxes and very
 * likely never will: they think "this goes out from hello@ourcompany.com".
 * A dropdown of mailboxes asks them to learn an inbox idea, and on a fresh
 * instance it is an empty dropdown — a control whose only state is "there is
 * nothing here and you cannot fix it from here".
 *
 * So it is a text box. What it needs underneath is made when the address is
 * settled, and only the domain has to have been set up, which is a real
 * requirement rather than a made-up one: SES refuses anything else.
 */
export function AddressField({
  value,
  known,
  onResolved,
  placeholder = "hello@yourdomain.com",
  disabled = false,
}: {
  /** The address currently on the campaign, if it has one. */
  value: string;
  /** Addresses already in use, offered as completions. */
  known: string[];
  onResolved: (chosen: { id: string; address: string }) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [text, setText] = useState(value);
  const [busy, setBusy] = useState(false);

  /*
   * Settled on blur or on Enter, not on every keystroke.
   *
   * Resolving creates the thing behind the address when it does not exist,
   * and doing that per character would leave a trail of addresses somebody
   * typed through on the way to the one they meant.
   */
  async function settle() {
    const wanted = text.trim().toLowerCase();
    if (!wanted || wanted === value.toLowerCase()) return;

    setBusy(true);
    const result = await resolveSendingAddressAction(wanted);
    setBusy(false);

    if (!result.ok) {
      toast.error(result.error);
      // Put back what was working, so the field never shows an address that
      // is not the one this will send from.
      setText(value);
      return;
    }

    setText(result.address);
    onResolved({ id: result.id, address: result.address });
  }

  return (
    <>
      <Input
        value={text}
        list="mailroom-known-addresses"
        inputMode="email"
        autoComplete="off"
        spellCheck={false}
        disabled={disabled || busy}
        placeholder={placeholder}
        onChange={(event) => setText(event.target.value)}
        onBlur={settle}
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          void settle();
        }}
      />
      {/* Completions rather than a list you must choose from: an address that
          has been used before is the likely answer, not the only one. */}
      <datalist id="mailroom-known-addresses">
        {known.map((address) => (
          <option key={address} value={address} />
        ))}
      </datalist>
    </>
  );
}
