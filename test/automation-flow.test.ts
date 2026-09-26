import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type FlowNode,
  NODE_WIDTH,
  TRIGGER_ID,
  branchLabels,
  describeTrigger,
  flowWarnings,
  humanDelay,
  layout,
  summarise,
} from "@/lib/automation-flow";
import { describeWindow, inWindow, nextOpening } from "@/lib/send-window";

/**
 * Where the boxes go.
 *
 * Nothing about a canvas is stored, so this is the only thing standing
 * between a flow and a picture nobody can read. The three that matter: a
 * parent sits between its children, no two boxes overlap, and a graph that
 * somehow points back at itself does not hang the tab.
 */

function node(id: string, over: Partial<FlowNode> = {}): FlowNode {
  return {
    id,
    kind: "email",
    subject: id,
    delayMinutes: 0,
    waitUntil: null,
    config: {},
    next: null,
    nextElse: null,
    ...over,
  };
}

function at(plan: ReturnType<typeof layout>, id: string) {
  return plan.nodes.find((spot) => spot.id === id);
}

describe("laying a flow out", () => {
  it("draws a trigger even when there is nothing under it", () => {
    const plan = layout([], null);
    assert.ok(at(plan, TRIGGER_ID));
    // And an arrow going nowhere, because the "+" that starts the flow has to
    // hang off something.
    assert.equal(plan.edges.length, 1);
    assert.equal(plan.edges[0]?.to, null);
  });

  it("stacks a straight run in one column", () => {
    const plan = layout([node("a", { next: "b" }), node("b", { next: "c" }), node("c")], "a");

    const xs = new Set(plan.nodes.map((spot) => spot.x));
    assert.equal(xs.size, 1);

    const ys = plan.nodes.map((spot) => spot.y).sort((left, right) => left - right);
    assert.deepEqual(ys, [...new Set(ys)]);
  });

  it("puts a condition between its two answers", () => {
    const plan = layout(
      [node("q", { kind: "condition", next: "yes", nextElse: "no" }), node("yes"), node("no")],
      "q",
    );

    const question = at(plan, "q");
    const yes = at(plan, "yes");
    const no = at(plan, "no");
    assert.ok(question && yes && no);

    // Centred over the pair, not sitting above one of them.
    assert.equal(question.x, (yes.x + no.x) / 2);
    assert.ok(yes.x < no.x);
    assert.ok(no.x - yes.x >= NODE_WIDTH);
  });

  it("leaves room for a branch that is still empty", () => {
    // A branch you can only find once it is used is a branch nobody finds, so
    // the "no" side gets an arrow and a "+" before anything is on it.
    const plan = layout([node("q", { kind: "condition", next: "yes" }), node("yes")], "q");
    const dangling = plan.edges.filter((edge) => edge.to === null);
    assert.equal(dangling.length, 2);
    assert.ok(dangling.some((edge) => edge.branch === "nextElse"));
  });

  it("never overlaps two boxes", () => {
    const plan = layout(
      [
        node("q", { kind: "condition", next: "y1", nextElse: "n1" }),
        node("y1", { kind: "condition", next: "y2", nextElse: "n2" }),
        node("y2"),
        node("n2"),
        node("n1"),
      ],
      "q",
    );

    for (const one of plan.nodes) {
      for (const other of plan.nodes) {
        if (one === other) continue;
        const sameRow = one.y === other.y;
        if (!sameRow) continue;
        assert.ok(
          Math.abs(one.x - other.x) >= NODE_WIDTH,
          `${one.id} and ${other.id} overlap on row ${one.y}`,
        );
      }
    }
  });

  it("gives each branch its own plus", () => {
    // Both edges leave a condition from the same point. Anchored there, the
    // two buttons land on top of each other and the "Yes" label is hidden
    // underneath the "No".
    const plan = layout(
      [node("q", { kind: "condition", next: "yes", nextElse: "no" }), node("yes"), node("no")],
      "q",
    );
    const [first, second] = plan.edges.filter((edge) => edge.from === "q");
    assert.ok(first && second);
    assert.ok(Math.abs(first.x - second.x) >= NODE_WIDTH);
  });

  it("gives each empty branch its own plus too", () => {
    const plan = layout([node("q", { kind: "condition" })], "q");
    const [first, second] = plan.edges.filter((edge) => edge.from === "q");
    assert.ok(first && second);

    const parent = plan.nodes.find((spot) => spot.id === "q");
    const centre = (parent?.x ?? 0) + NODE_WIDTH / 2;

    // One each side of the condition, far enough apart that neither button
    // nor its Yes/No label can land on the other's.
    assert.ok(first.x < centre);
    assert.ok(second.x > centre);
    assert.ok(Math.abs(first.x - second.x) >= 100);

    // Level with each other: they are two answers to one question, and one
    // sitting lower than the other reads as a mistake rather than as meaning.
    assert.equal(first.y, second.y);
  });

  it("gives a dead end no way out", () => {
    // Taking somebody off the list ends their journey. An arrow under it
    // would offer a "+" and invite a box that could never be reached.
    const plan = layout([node("bye", { kind: "unsubscribe" })], "bye");
    assert.equal(plan.edges.filter((edge) => edge.from === "bye").length, 0);
  });

  it("does not hang on a flow that points back at itself", () => {
    // The editor cannot build one. A half-applied edit under an open page in
    // principle could, and walking it forever would freeze the tab.
    const plan = layout([node("a", { next: "b" }), node("b", { next: "a" })], "a");
    assert.equal(plan.nodes.length, 3);
  });
});

describe("what a box says about itself", () => {
  it("names the email by its subject", () => {
    assert.equal(summarise(node("a", { subject: "Welcome aboard" })).title, "Welcome aboard");
  });

  it("says when an email has nothing in it, and nothing when it has", () => {
    // The second line is only there when it adds something: a card reading
    // "WAIT / 1 day / 1 day" has spent three lines saying one thing.
    assert.equal(summarise(node("a", { subject: "  ", empty: true })).note, "Nothing written yet");
    assert.equal(summarise(node("a", { subject: "Hello" })).note, undefined);
  });

  it("reads a condition out in words", () => {
    assert.equal(
      summarise(node("a", { kind: "condition", config: { test: "clicked" } })).title,
      "Clicked the last email?",
    );
    assert.equal(
      summarise(
        node("a", {
          kind: "condition",
          config: { test: "field", field: "plan", op: "is_not", value: "free" },
        }),
      ).title,
      "plan is not free",
    );
  });

  it("says a wait of nothing is a wait of nothing", () => {
    const said = summarise(node("a", { kind: "wait", delayMinutes: 0 }));
    assert.equal(said.title, "No pause");
    assert.equal(said.note, "Straight on to the next box");
  });

  it("uses the unit somebody would have said it in", () => {
    assert.equal(humanDelay(30), "30 min");
    assert.equal(humanDelay(120), "2 hours");
    assert.equal(humanDelay(4320), "3 days");
  });
});

describe("what the trigger card says", () => {
  it("names the list somebody joins", () => {
    const said = describeTrigger("subscribed", "Newsletter", null);
    assert.equal(said.title, "Somebody joins");
    assert.equal(said.note, "Newsletter");
    assert.ok(!said.warn);
  });

  it("asks for the half that is missing rather than looking finished", () => {
    // A card reading "Event received" with nothing under it is how somebody
    // finds out at switch-on time that they never picked the event.
    assert.ok(describeTrigger("event", "Newsletter", null).warn);
    assert.ok(describeTrigger(null, "Newsletter", null).warn);
  });

  it("reads no list as any list, not as something missing", () => {
    const joins = describeTrigger("subscribed", null, null);
    assert.ok(!joins.warn);
    assert.equal(joins.note, "Any list");
    assert.ok(!describeTrigger("event", null, "trial.ended").warn);
  });

  it("says who posts it once both halves are answered", () => {
    const said = describeTrigger("event", "Customers", "trial.ended");
    assert.equal(said.title, "trial.ended");
    assert.match(said.note ?? "", /Customers/);
    assert.ok(!said.warn);
  });
});

describe("boxes with two ways out", () => {
  it("lays a split out like a condition, one way each side", () => {
    const plan = layout(
      [
        node("split", { kind: "split", config: { percent: 30 }, next: "a", nextElse: "b" }),
        node("a"),
        node("b"),
      ],
      "split",
    );
    const top = at(plan, "split");
    const left = at(plan, "a");
    const right = at(plan, "b");
    assert.ok(top && left && right);
    assert.ok(left.x < top.x && top.x < right.x, "the split sits between its two ways");
  });

  it("names the ways by what they mean", () => {
    assert.deepEqual(branchLabels(node("s", { kind: "split", config: { percent: 30 } })), [
      "A · 30%",
      "B · 70%",
    ]);
    assert.deepEqual(branchLabels(node("w", { kind: "await" })), ["Arrived", "Timed out"]);
    assert.deepEqual(branchLabels(node("c", { kind: "condition" })), ["Yes", "No"]);
  });

  it("says what a wait for an event is waiting for", () => {
    const said = summarise(
      node("w", { kind: "await", delayMinutes: 4320, config: { event: "order.placed" } }),
    );
    assert.equal(said.title, "Wait for order.placed");
    assert.equal(said.note, "Up to 3 days");
  });
});

describe("warning about a flow before it runs", () => {
  it("flags an open question asked with no time to open anything", () => {
    const warnings = flowWarnings([
      node("mail", { next: "ask" }),
      node("ask", { kind: "condition", config: { test: "opened" } }),
    ]);
    assert.match(warnings.ask ?? "", /Wait/);
  });

  it("is quiet once there is a wait in between", () => {
    const warnings = flowWarnings([
      node("mail", { next: "pause" }),
      node("pause", { kind: "wait", delayMinutes: 1440, next: "ask" }),
      node("ask", { kind: "condition", config: { test: "clicked" } }),
    ]);
    assert.equal(warnings.ask, undefined);
  });

  it("flags an open question with no email above it at all", () => {
    const warnings = flowWarnings([
      node("pause", { kind: "wait", delayMinutes: 60, next: "ask" }),
      node("ask", { kind: "condition", config: { test: "opened" } }),
    ]);
    assert.match(warnings.ask ?? "", /always no/);
  });

  it("leaves questions about fields alone", () => {
    const warnings = flowWarnings([
      node("mail", { next: "ask" }),
      node("ask", { kind: "condition", config: { test: "field", field: "plan" } }),
    ]);
    assert.equal(warnings.ask, undefined);
  });

  it("flags the boxes that are missing their one setting", () => {
    const warnings = flowWarnings([
      node("hook", { kind: "webhook", next: "wait" }),
      node("wait", { kind: "await" }),
    ]);
    assert.ok(warnings.hook);
    assert.ok(warnings.wait);
  });
});

describe("the hours an automation may send in", () => {
  const office = { from: 9, to: 17, days: [1, 2, 3, 4, 5], timeZone: "UTC" };

  it("is open inside the hours and shut outside them", () => {
    // Wednesday 1 October 2025.
    assert.equal(inWindow(office, new Date("2025-10-01T10:00:00Z")), true);
    assert.equal(inWindow(office, new Date("2025-10-01T17:00:00Z")), false);
    assert.equal(inWindow(office, new Date("2025-10-01T08:59:00Z")), false);
    // Saturday.
    assert.equal(inWindow(office, new Date("2025-10-04T10:00:00Z")), false);
    assert.equal(inWindow(null, new Date("2025-10-04T03:00:00Z")), true);
  });

  it("reads the hours in the automation's own time zone", () => {
    const tokyo = { ...office, timeZone: "Asia/Tokyo" };
    // 01:00 UTC is 10:00 in Tokyo.
    assert.equal(inWindow(tokyo, new Date("2025-10-01T01:00:00Z")), true);
    assert.equal(inWindow(tokyo, new Date("2025-10-01T10:00:00Z")), false);
  });

  it("finds the next opening, over a weekend", () => {
    // Friday evening waits for Monday morning.
    const next = nextOpening(office, new Date("2025-10-03T18:30:00Z"));
    assert.equal(next.toISOString(), "2025-10-06T09:00:00.000Z");
  });

  it("gives back the same instant when it is already open", () => {
    const now = new Date("2025-10-01T10:07:00Z");
    assert.equal(nextOpening(office, now).getTime(), now.getTime());
  });

  it("runs over midnight when it starts later than it ends", () => {
    const night = { from: 22, to: 6, days: [5], timeZone: "UTC" };
    // Friday 23:00, and the small hours of Saturday that belong to it.
    assert.equal(inWindow(night, new Date("2025-10-03T23:00:00Z")), true);
    assert.equal(inWindow(night, new Date("2025-10-04T02:00:00Z")), true);
    assert.equal(inWindow(night, new Date("2025-10-04T23:00:00Z")), false);
  });

  it("says itself in words", () => {
    assert.equal(describeWindow(office), "09:00 – 17:00, Mon–Fri (UTC)");
    assert.equal(describeWindow(null), "Any time");
  });
});
