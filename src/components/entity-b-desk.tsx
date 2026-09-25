"use client";

import { Check, Fingerprint, X } from "lucide-react";
import type { Snapshot } from "@/lib/snapshot";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "./ui/sheet";
import { hhmmss } from "./evidence";

export function EntityBDesk({ open, onOpenChange, snapshot: s, ready, busy, onAccept, onReject, onApprove }: {
  open: boolean; onOpenChange: (open: boolean) => void; snapshot: Snapshot | null; ready: boolean; busy: string | null;
  onAccept: () => void; onReject: () => void; onApprove: (id: string) => void;
}) {
  const lease = s?.lease;
  const proposal = s?.proposal;
  const pending = s?.pending;
  const reviewing = lease?.status === "ISSUER_APPROVED" && !!proposal;
  const stepup = pending?.status === "PENDING" && lease?.status === "ACTIVE";
  const approver = s?.principals.find((p) => p.role === "RECEIVER_APPROVER");

  return <Sheet open={open} onOpenChange={onOpenChange}>
    <SheetContent className="desk">
      <SheetHeader>
        <p className="desk-who">{approver?.name ?? "Entity B"} · Entity B, owner of these systems</p>
        <SheetTitle render={<h2/>}>{stepup ? "Approve one exact action" : reviewing ? "Entity A is asking for access" : "Entity B's desk"}</SheetTitle>
        <SheetDescription className="desk-lede">
          {stepup ? "Isolating B-17 takes a device offline. Agent 47 cannot do this on its own."
            : reviewing ? "You decide what an outside agent may touch. Your policy is the ceiling — anything above it was already cut."
            : "Requests from Entity A land here. Nothing reaches your systems until you accept it."}
        </SheetDescription>
      </SheetHeader>

      <div className="desk-inner">
        {reviewing && lease && proposal && <>
          <div className="terms">
            {proposal.terms.map((t, i) => {
              const v = !t.accepted ? "deny" : t.gate === "HUMAN_GATED" ? "hold" : "allow";
              return <div className="term" key={i} data-v={v}>
                {v === "deny" ? <X/> : v === "hold" ? <Fingerprint/> : <Check/>}
                <div>
                  <b>{TERM_WORDS[t.scope.action] ?? t.scope.action}</b>
                  <p>{!t.accepted ? t.rejectionReason : t.gate === "HUMAN_GATED" ? "Allowed, but only after you approve each time" : "Allowed for the length of this grant"}</p>
                </div>
                <span className="term-clause mono">{t.policyClause}</span>
              </div>;
            })}
            {proposal.exclusions.map((x) => <div className="term" key={x.resourceClass} data-v="deny">
              <X/><div><b>Citizen records</b><p>Cut from the request. Personal data is never handed to an outside agent.</p></div>
              <span className="term-clause mono">{x.policyClause}</span>
            </div>)}
          </div>

          <dl className="desk-facts">
            <div><dt>Asked for</dt><dd>{proposal.requestedMinutes} minutes</dd></div>
            <div><dt>You allow</dt><dd>{proposal.grantedMinutes} minutes, ending {hhmmss(lease.expiresAt)}</dd></div>
            <div><dt>Grant</dt><dd className="mono">{lease.id} v{lease.version}</dd></div>
            <div><dt>Drafted by</dt><dd>{proposal.source === "MODEL" ? "A model, then checked against your policy" : "Policy rules"}</dd></div>
          </dl>

          <div className="desk-actions">
            <button className="btn btn-primary" onClick={onAccept} disabled={!ready}>{busy === "accept" ? "Accepting…" : "Accept this grant"}</button>
            <button className="btn btn-danger" onClick={onReject} disabled={!ready}>Refuse</button>
          </div>
        </>}

        {stepup && pending && <>
          <dl className="desk-facts">
            <div><dt>Action</dt><dd>Isolate connector B-17</dd></div>
            <div><dt>Asked by</dt><dd>Agent 47</dd></div>
            <div><dt>Under grant</dt><dd className="mono">{pending.leaseId} v{pending.leaseVersion}</dd></div>
            <div><dt>Requested</dt><dd>{hhmmss(pending.requestedAt)}</dd></div>
          </dl>
          <p className="desk-fine">Your approval covers this one action, on this one device, by this one agent, under this version of the grant. It lasts ten minutes and is used up the moment it works.</p>
          <button className="btn btn-primary" onClick={() => onApprove(pending.id)} disabled={!ready}>
            <Fingerprint/>{busy === "stepup" ? "Approving…" : "Approve this once"}
          </button>
        </>}

        {!reviewing && !stepup && <p className="desk-idle">
          {pending?.status === "APPROVED" ? "You approved the isolation. Agent 47 has to run it itself, and the approval is used up when it does."
            : lease?.status === "ACTIVE" ? "The grant is running. Every single request is still checked against your policy."
            : lease?.status === "PROPOSED" ? "Entity A has to sign its own request before it reaches you."
            : lease?.status === "REVOKED" || lease?.status === "EXPIRED" ? "There is no grant. Agent 47 can reach nothing of yours."
            : "Nothing is waiting for you."}
        </p>}
      </div>
    </SheetContent>
  </Sheet>;
}

const TERM_WORDS: Record<string, string> = {
  READ_TELEMETRY: "Read security telemetry",
  INSPECT_CONNECTOR: "Inspect connector B-17",
  ISOLATE_CONNECTOR: "Isolate connector B-17",
  READ_CITIZEN_RECORDS: "Read citizen records",
};
