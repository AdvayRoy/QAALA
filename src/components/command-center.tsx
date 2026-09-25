"use client";

import { useState } from "react";
import { Check, Fingerprint, Minus, RotateCcw, ShieldOff, X } from "lucide-react";
import { api } from "./api-client";
import { hhmmss, minutesRemaining } from "./evidence";
import { useCommandCenter } from "./use-command-center";
import { EntityBDesk } from "./entity-b-desk";
import type { Action, DecisionRecord } from "@/lib/domain/types";
import type { Snapshot } from "@/lib/snapshot";

type Verdict = "allow" | "deny" | "hold" | "none";

/** What Agent 47 may do right now, derived only from server state. */
function may(s: Snapshot, action: Action): { verdict: Verdict; line: string; sub?: string } {
  const lease = s.lease;
  const live = lease?.status === "ACTIVE" && new Date(lease.expiresAt) > new Date(s.serverTime);
  const scoped = live && lease!.scopes.some((x) => x.action === action);

  if (action === "READ_CITIZEN_RECORDS") {
    return { verdict: "deny", line: "NEVER", sub: "not delegable" };
  }
  if (!scoped) return { verdict: "deny", line: "DENIED" };
  if (action === "ISOLATE_CONNECTOR") {
    if (s.connector.isolated) return { verdict: "allow", line: "ISOLATED", sub: "approval used" };
    if (s.pending?.status === "APPROVED") return { verdict: "hold", line: "APPROVED ONCE", sub: "agent must retry" };
    if (s.pending?.status === "PENDING") return { verdict: "hold", line: "WAITING ON A PERSON" };
    return { verdict: "hold", line: "NEEDS A PERSON", sub: "at Entity B" };
  }
  return { verdict: "allow", line: "ALLOWED" };
}

export function CommandCenter() {
  const c = useCommandCenter();
  const { snapshot: s, busy, ready, run } = c;
  const [openReceipt, setOpenReceipt] = useState<string | null>(null);

  const lease = s?.lease;
  const now = s?.serverTime ?? "";
  const live = !!lease && lease.status === "ACTIVE" && new Date(lease.expiresAt) > new Date(now);
  const closed = lease?.status === "REVOKED" || lease?.status === "EXPIRED";

  const declare = () => run("declare", "Declare emergency", "ISSUER_COMMANDER", api.declare);
  const propose = () => run("propose", "Request grant", "ISSUER_COMMANDER", api.propose);
  const sign = () => run("sign", "Sign as Entity A", "ISSUER_COMMANDER", api.issuerApprove);
  const revoke = () => run("revoke", "Revoke grant", "RECEIVER_APPROVER", api.revoke);

  // One button drives the story. Its label is always the literal next move.
  let next = { label: "Let Agent 47 try", why: "Agent 47 has no grant from Entity B. Watch what the gate does.", act: () => run("telemetry", "Read security telemetry", "AGENT", api.telemetry) };
  const refused = !!s?.decisions.some((d) => d.decision === "DENY");
  if (refused && s?.mission.status === "DRAFT") next = { label: "Declare the emergency", why: "Entity A opens Incident 024 and states why it needs Entity B's systems.", act: declare };
  else if (s?.mission.status === "DECLARED" && !lease) next = { label: "Request a narrow grant", why: "Draft the smallest grant that covers the incident. Entity B's policy trims it.", act: propose };
  else if (lease?.status === "PROPOSED") next = { label: "Sign as Entity A", why: "Entity A signs. On its own this grants nothing — the owner still has to agree.", act: sign };
  else if (lease?.status === "ISSUER_APPROVED") next = { label: "Open Entity B's desk", why: "Entity B owns these systems. Only Entity B can accept the grant.", act: async () => c.setDeskOpen(true) };
  else if (s?.pending?.status === "PENDING") next = { label: "Open Entity B's desk", why: "Isolating B-17 is destructive. A person at Entity B has to approve this exact action.", act: async () => c.setDeskOpen(true) };
  else if (live) next = { label: "Let Agent 47 try again", why: "Same request, same agent. The only thing that changed is the grant.", act: () => run("telemetry", "Read security telemetry", "AGENT", api.telemetry) };
  else if (closed) next = { label: "Let Agent 47 try again", why: "The grant is gone. Access should close the moment it does.", act: () => run("telemetry", "Read security telemetry", "AGENT", api.telemetry) };

  const grantState = live ? "live" : closed ? "closed" : lease ? "waiting" : "none";
  const grantWord = live ? "LIVE" : lease?.status === "REVOKED" ? "REVOKED" : lease?.status === "EXPIRED" ? "EXPIRED"
    : lease?.status === "ISSUER_APPROVED" ? "AWAITING ENTITY B" : lease?.status === "PROPOSED" ? "DRAFTED" : "NONE";
  const grantNote = live ? `Agent 47 may do exactly what is listed below, until ${hhmmss(lease!.expiresAt)}, and nothing else.`
    : lease?.status === "REVOKED" ? "Entity B took the grant back. Agent 47's access closed at that instant."
    : lease?.status === "EXPIRED" ? "The grant ran out on its own. Nobody had to remember to switch it off."
    : lease?.status === "ISSUER_APPROVED" ? "Entity A has signed. Nothing is granted until Entity B accepts."
    : lease?.status === "PROPOSED" ? "A grant has been drafted. Neither agency has signed it."
    : "Entity B has granted nothing. Every request below is refused.";

  const commander = s?.principals.find((p) => p.role === "ISSUER_COMMANDER");
  const approver = s?.principals.find((p) => p.role === "RECEIVER_APPROVER");

  return <div className="gate">
    <a className="skip-link" href="#stage">Skip to the gate</a>

    <header className="masthead">
      <div className="wordmark"><img src="/brand/logo.svg" alt="" width={26} height={26}/><b>qalaa</b><span>cross-agency authority gate</span></div>
      <span className="synthetic">SYNTHETIC DEMO</span>
      <div className="masthead-end">
        <time className="clock">{s ? hhmmss(s.serverTime) : "—"}</time>
        <button className="btn btn-quiet btn-sm" disabled={!ready} onClick={() => { setOpenReceipt(null); void run("reset", "Reset", null, api.reset); }}><RotateCcw/>Start over</button>
      </div>
    </header>

    {(c.fault || c.connection === "stale") && <div className="notice">
      <span>{c.fault ?? "Lost the server. Showing the last confirmed state."}</span>
      <button className="btn btn-sm" onClick={() => void c.reconnect()}>Reconnect</button>
    </div>}

    <div className="floor">
      <main className="stage" id="stage">
        {!s ? <p className="loading">Connecting to the gate…</p> : <>
          <h1 className="premise">Agent 47 is an AI at Entity A. It wants to act on <em>Entity B&apos;s</em> systems.</h1>

          <section className="grant" data-state={grantState} aria-label="Grant from Entity B">
            <div className="grant-top">
              <span className="grant-label">GRANT</span>
              <span className="grant-state" data-testid="authority-state">{grantWord}</span>
              {live && <span className="grant-meta mono">{lease!.id} · {minutesRemaining(lease!.expiresAt, now)} min left</span>}
            </div>
            <p className="grant-note">{grantNote}</p>
            <div className="signatures">
              <div className="signature" data-signed={!!lease?.issuerApprovedBy}>
                <span className="signature-mark">{lease?.issuerApprovedBy ? <Check size={11} strokeWidth={3.5}/> : <Minus size={10} strokeWidth={3}/>}</span>
                <span className="signature-text">
                  <span className="signature-who">{lease?.issuerApprovedBy ? commander?.name : "Not signed"}</span>
                  <span className="signature-role">Entity A · asks for the grant</span>
                </span>
              </div>
              <div className="signature" data-signed={!!lease?.receiverAcceptedBy && !closed}>
                <span className="signature-mark">{lease?.receiverAcceptedBy && !closed ? <Check size={11} strokeWidth={3.5}/> : <Minus size={10} strokeWidth={3}/>}</span>
                <span className="signature-text">
                  <span className="signature-who">{lease?.receiverAcceptedBy && !closed ? approver?.name : "Not accepted"}</span>
                  <span className="signature-role">Entity B · owns the systems</span>
                </span>
              </div>
            </div>
          </section>

          <section className="asks" aria-label="What Agent 47 may do">
            <div className="asks-head">
              <span>What Agent 47 may do at Entity B</span>
              <span>Every attempt is decided by Entity B&apos;s server, not by the agent.</span>
            </div>
            <Ask s={s} name="Security telemetry" what="Network alerts from Entity B's estate" busy={busy} ready={ready} run={run}
              tries={[{ label: "Read it", key: "telemetry", call: api.telemetry, action: "READ_TELEMETRY" }]}/>
            <Ask s={s} name="Connector B-17" what="The device the attacker moved through" busy={busy} ready={ready} run={run}
              tries={[{ label: "Inspect", key: "inspect", call: api.inspectConnector, action: "INSPECT_CONNECTOR" },
                      { label: "Isolate", key: "isolate", call: api.isolateConnector, action: "ISOLATE_CONNECTOR" }]}/>
            <Ask s={s} name="Citizen records" what="Personal data on members of the public" busy={busy} ready={ready} run={run}
              tries={[{ label: "Read it", key: "citizen", call: api.citizenRecords, action: "READ_CITIZEN_RECORDS" }]}/>
          </section>

          <div className="next">
            <button className="btn btn-primary" disabled={!ready} onClick={next.act}>{busy ? "Working…" : next.label}</button>
            <p className="next-why">{next.why}</p>
            <div className="next-end">
              {live && <button className="btn btn-danger" disabled={!ready} onClick={revoke}><ShieldOff/>Revoke the grant</button>}
              <button className="btn" onClick={() => c.setDeskOpen(true)}>Entity B&apos;s desk</button>
            </div>
          </div>
        </>}
      </main>

      <aside className="ledger" aria-label="Decision receipts">
        <div className="ledger-head"><h2>Every attempt leaves a receipt</h2><span>{s?.decisions.length ?? 0}</span></div>
        {!s?.decisions.length
          ? <p className="ledger-empty">Nothing has been attempted yet. Each request Agent 47 makes is recorded here with the reason it was allowed or refused.</p>
          : <ul className="ledger-list">{[...s.decisions].reverse().map((d) => <li key={d.id}><Receipt d={d} open={openReceipt === d.id} onToggle={() => setOpenReceipt(openReceipt === d.id ? null : d.id)}/></li>)}</ul>}
      </aside>
    </div>

    <EntityBDesk open={c.deskOpen} onOpenChange={c.setDeskOpen} snapshot={s} ready={ready} busy={busy}
      onAccept={() => run("accept", "Entity B accepts", "RECEIVER_APPROVER", api.receiverAccept)}
      onReject={() => run("reject", "Entity B refuses", "RECEIVER_APPROVER", api.receiverReject)}
      onApprove={(id) => run("stepup", "One-use approval", "RECEIVER_APPROVER", (t) => api.approveStepUp(t, id))}/>
  </div>;
}

function Ask({ s, name, what, tries, busy, ready, run }: {
  s: Snapshot; name: string; what: string; busy: string | null; ready: boolean;
  tries: Array<{ label: string; key: string; call: (t: string) => Promise<unknown>; action: Action }>;
  run: ReturnType<typeof useCommandCenter>["run"];
}) {
  const verdicts = tries.map((t) => ({ ...t, ...may(s, t.action) }));
  const never = tries.some((t) => t.action === "READ_CITIZEN_RECORDS");
  return <div className="ask" data-verdict={never ? "never" : verdicts[0].verdict}>
    <div><div className="ask-name">{name}</div><div className="ask-what">{what}</div></div>
    <div className="verdicts">{verdicts.map((v) => <div className="verdict" key={v.key} data-v={v.verdict}>
      {tries.length > 1 && <span className="verdict-for">{v.label}</span>}
      {v.line}{v.sub && <span className="verdict-sub">{v.sub}</span>}
    </div>)}</div>
    <div className="tries">{verdicts.map((t) => <button key={t.key} className="btn btn-sm" disabled={!ready}
      onClick={() => run(t.key, t.label, "AGENT", t.call as never)}>{busy === t.key ? "\u2026" : t.label}</button>)}</div>
  </div>;
}

function Receipt({ d, open, onToggle }: { d: DecisionRecord; open: boolean; onToggle: () => void }) {
  const v = d.decision === "ALLOW" ? "allow" : d.decision === "HUMAN_APPROVAL_REQUIRED" ? "hold" : "deny";
    return <>
    <button className="receipt" aria-expanded={open} onClick={onToggle}>
      <span className="receipt-top">
        <span className="receipt-code" data-v={v}>{d.httpStatus}</span>
        <span className="receipt-what">{ACTION_WORDS[d.action]}</span>
        <time className="receipt-at">{hhmmss(d.decidedAt)}</time>
      </span>
      <span className="receipt-why">{d.reason}</span>
    </button>
    {open && <div className="proof">
      {d.authorityPath.map((x, i) => <div className="proof-row" key={i} data-ok={x.passed}>
        {x.passed ? <Check strokeWidth={2.5}/> : v === "hold" ? <Fingerprint/> : <X strokeWidth={2.5}/>}<span>{x.check}</span>
      </div>)}
      <div className="proof-id mono">{d.id} · {d.policyId} v{d.policyVersion}</div>
    </div>}
  </>;
}

const ACTION_WORDS: Record<Action, string> = {
  READ_TELEMETRY: "Read security telemetry",
  READ_CITIZEN_RECORDS: "Read citizen records",
  INSPECT_CONNECTOR: "Inspect connector B-17",
  ISOLATE_CONNECTOR: "Isolate connector B-17",
};
