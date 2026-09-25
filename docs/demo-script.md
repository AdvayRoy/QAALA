# QALAA — 3:00 demo script

Read this over a screen recording. Word counts are set for ~150 wpm.

---

## 0:00–0:32 — The problem

> In early 2024, researchers found malicious AI models sitting on Hugging Face —
> the largest public model hub in the world. Not stolen data. Models that ran
> code on your machine the moment you loaded them. Separately, Hugging Face
> disclosed unauthorized access to secrets inside its Spaces platform — the API
> tokens developers had handed over.
>
> Now picture that inside government. An agency downloads a model to triage an
> incident. That model runs with whatever access the agent was given. And in
> government, agents get given a lot, because emergencies are exactly when
> nobody wants to be the person who said no.

## 0:32–0:58 — Why it happened

> Neither of those was a clever hack. Both were the same failure: standing
> access. A token that was issued once and never expired. Permission that was
> granted for one job and stayed live forever. Nobody could say, afterwards,
> which model touched what, or on whose authority.
>
> That is the gap. Not "is the AI safe?" — but "who said this AI could do that,
> for how long, and can they take it back?"

## 0:58–1:28 — The solution

> QALAA is an authority gate for AI actions between agencies.
>
> An agent gets no standing access. Ever. When Agency A needs something from
> Agency B during an incident, it asks for a narrow, time-boxed grant. Agency A
> signs it. But Agency B — who actually owns the systems — has to accept it
> independently. One signature grants nothing.
>
> Entity B's policy is the ceiling. It trims the request before a human even
> sees it. Destructive actions need a second, one-use human approval. And every
> single attempt leaves a receipt.

## 1:28–1:58 — Competition

> IAM tools like Okta and Entra govern people, and they hand out access that
> sits there. Agent frameworks — LangChain, MCP gateways — put guardrails in the
> agent, which means the thing being governed is enforcing its own limits.
> Audit tooling tells you what went wrong yesterday.
>
> QALAA is different on three counts. Authority is bilateral — the resource
> owner has a veto the requester cannot override. It expires by default, so
> nobody has to remember to switch it off. And enforcement is server-side, at
> the resource, not inside the agent. If our own UI lied, the answer would not
> change.

## 1:58–2:52 — Demo

> Here is Agent 47, an AI at Entity A. It wants Entity B's systems.
>
> [click Read it on telemetry] No grant. Denied. Receipt written.
>
> [click through to the grant] Entity A declares the incident and asks for the
> narrowest grant that covers it. Entity A signs — and notice, still denied.
>
> [open Entity B's desk] Entity B decides. Its policy already cut citizen
> records out of the request entirely. It accepts.
>
> [point at the three rows] Now: telemetry, allowed. Connector, allowed to
> inspect. Citizen records — still never. An emergency did not unlock it.
>
> [click Isolate] And isolating the device? That needs a person at Entity B,
> every time. One approval, one use.
>
> [click Revoke] Revoke — and access closes on the next call.

## 2:52–3:00 — Close

> Bounded, bilateral, expiring, and provable. That is what standing access
> should have been.

---

## Before you record — verify these

- The specific Hugging Face incidents and their dates. Say "researchers found"
  and "Hugging Face disclosed" — do not invent breach numbers or victim names.
- Competitor claims are positioning, not benchmarks. Keep them descriptive.
