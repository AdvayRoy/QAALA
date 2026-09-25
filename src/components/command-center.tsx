"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Action, AuthorityCheck, Decision, DecisionRecord, DemoRole, GovernanceEvent } from "@/lib/domain/types";
import type { DemoStep, Snapshot } from "@/lib/snapshot";
import { api, type ApiResult, type LifecycleBody, type ProtectedBody } from "./api-client";
import { AuthorityGraphView, type GraphFocus } from "./authority-graph";
import { ACTION_META, actionFromPath, bandState, checkLabel, eventTitle, hhmm, hhmmss, stopPointFor, type Tone } from "./evidence";

type Tokens = Record<DemoRole, string | null>;

interface LiveAction {
  key: string;
  title: string;
  method: "GET" | "POST";
  path: string;
  role: DemoRole | "NONE";
  status: number;
  body: ProtectedBody | LifecycleBody | Record<string, unknown> | null;
  at: string;
}

type Inspect = { kind: "live"; action: LiveAction } | { kind: "event"; event: GovernanceEvent; receipt: DecisionRecord | null };

const ROLE_LABEL: Record<DemoRole | "NONE", string> = {
  AGENT: "Agent 47 · Entity A",
  ISSUER_COMMANDER: "Commander · Entity A",
  RECEIVER_APPROVER: "Approver · Entity B",
  NONE: "console",
};

const SEQUENCE: { id: DemoStep; label: string }[] = [
  { id: "NO_AUTHORITY", label: "No authority" },
  { id: "MISSION_DECLARED", label: "Mission declared" },
  { id: "PROPOSED", label: "Lease proposed" },
  { id: "ISSUER_APPROVED", label: "Entity A approved" },
  { id: "ACTIVE", label: "Entity B accepted" },
  { id: "STEP_UP_PENDING", label: "Human step-up" },
  { id: "STEP_UP_APPROVED", label: "Exact approval" },
  { id: "ISOLATED", label: "B-17 isolated" },
  { id: "REVOKED", label: "Authority revoked" },
];

const STEP_INDEX: Record<DemoStep, number> = {
  NO_AUTHORITY: 0,
  MISSION_DECLARED: 1,
  PROPOSED: 2,
  ISSUER_APPROVED: 3,
  ACTIVE: 4,
  STEP_UP_PENDING: 5,
  STEP_UP_APPROVED: 6,
  ISOLATED: 7,
  REVOKED: 8,
  EXPIRED: 8,
};

const TONE_TEXT: Record<Tone, string> = {
  neutral: "text-[#aeb7c3]",
  allow: "text-[#3ecf8e]",
  deny: "text-[#ef5f6a]",
  stepup: "text-[#e5b43c]",
  info: "text-[#6aa6ff]",
};
const TONE_RULE: Record<Tone, string> = {
  neutral: "bg-[#4b5563]",
  allow: "bg-[#3ecf8e]",
  deny: "bg-[#ef5f6a]",
  stepup: "bg-[#e5b43c]",
  info: "bg-[#6aa6ff]",
};
const TONE_BORDER: Record<Tone, string> = {
  neutral: "border-[#4b5563]",
  allow: "border-[#3ecf8e]",
  deny: "border-[#ef5f6a]",
  stepup: "border-[#e5b43c]",
  info: "border-[#6aa6ff]",
};

function httpTone(status: number): Tone {
  if (status === 200) return "allow";
  if (status === 409) return "stepup";
  if (status >= 400) return "deny";
  return "neutral";
}

function decisionToneOf(d: Decision): Tone {
  return d === "ALLOW" ? "allow" : d === "HUMAN_APPROVAL_REQUIRED" ? "stepup" : "deny";
}

function isProtected(body: LiveAction["body"]): body is ProtectedBody {
  return !!body && typeof body === "object" && "decision" in body && "receiptId" in body;
}

function isLifecycle(body: LiveAction["body"]): body is LifecycleBody {
  return !!body && typeof body === "object" && "ok" in body && "message" in body;
}

export function CommandCenter() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [tokens, setTokens] = useState<Tokens>({ AGENT: null, ISSUER_COMMANDER: null, RECEIVER_APPROVER: null });
  const [inspect, setInspect] = useState<Inspect | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [drawer, setDrawer] = useState(false);
  const [fault, setFault] = useState<string | null>(null);
  const lineageRef = useRef<HTMLOListElement | null>(null);

  const refresh = useCallback(async () => {
    const res = await api.state();
    if (res.status === 200 && res.body) setSnapshot(res.body);
    else setFault(`state fetch failed (${res.status})`);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const roles: DemoRole[] = ["AGENT", "ISSUER_COMMANDER", "RECEIVER_APPROVER"];
      const next: Tokens = { AGENT: null, ISSUER_COMMANDER: null, RECEIVER_APPROVER: null };
      for (const role of roles) {
        const res = await api.session(role);
        if (res.status === 200) next[role] = res.body.token;
      }
      if (!cancelled) setTokens(next);
      await refresh();
    })();
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  useEffect(() => {
    const el = lineageRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [snapshot?.events.length]);

  const run = useCallback(
    async (
      key: string,
      title: string,
      method: "GET" | "POST",
      path: string,
      role: DemoRole | "NONE",
      fn: (token: string | null) => Promise<ApiResult<ProtectedBody | LifecycleBody | Record<string, unknown>>>,
    ) => {
      if (busy) return;
      setBusy(key);
      setFault(null);
      try {
        const token = role === "NONE" ? null : tokens[role];
        const res = await fn(token);
        setInspect({ kind: "live", action: { key, title, method, path, role, status: res.status, body: res.body, at: new Date().toISOString() } });
        await refresh();
        if (isProtected(res.body) && res.body.decision === "HUMAN_APPROVAL_REQUIRED") setDrawer(true);
      } catch (e) {
        setFault(e instanceof Error ? e.message : "request failed");
      } finally {
        setBusy(null);
      }
    },
    [busy, tokens, refresh],
  );

  const step = snapshot?.step ?? "NO_AUTHORITY";
  const stepIdx = STEP_INDEX[step];
  const lease = snapshot?.lease ?? null;
  const pending = snapshot?.pending ?? null;
  const proposal = snapshot?.proposal ?? null;
  const connector = snapshot?.connector ?? null;
  const band = snapshot ? bandState(snapshot) : null;
  const drawerHasWork = lease?.status === "ISSUER_APPROVED" || pending?.status === "PENDING";

  const focus = useMemo<GraphFocus | null>(() => {
    if (!inspect) return null;
    if (inspect.kind === "event") {
      const r = inspect.receipt;
      if (!r) return null;
      return { resourceId: r.resourceId, decision: r.decision, stopAt: stopPointFor(r.code, r.decision) };
    }
    const a = inspect.action;
    if (!isProtected(a.body)) return null;
    const action = actionFromPath(a.path);
    return { resourceId: action ? ACTION_META[action].resourceId : null, decision: a.body.decision, stopAt: stopPointFor(a.body.code, a.body.decision) };
  }, [inspect]);

  const onReset = () =>
    run("reset", "Reset demo state", "POST", "/api/demo/reset", "NONE", async () => {
      const res = await api.reset();
      setDrawer(false);
      return res;
    });

  const ready = !!tokens.AGENT && !!tokens.ISSUER_COMMANDER && !!tokens.RECEIVER_APPROVER && !!snapshot;
  const approverName = snapshot?.principals.find((p) => p.role === "RECEIVER_APPROVER")?.name ?? "Entity B approver";
  const commanderName = snapshot?.principals.find((p) => p.role === "ISSUER_COMMANDER")?.name ?? "Entity A commander";

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-[#0b0e13] text-[13px] text-[#d5dbe5]">
      {/* Header */}
      <header className="flex h-12 shrink-0 items-center gap-5 border-b border-[#1f2630] bg-[#0d1117] px-5">
        <div className="flex items-center gap-3">
          <span className="text-[17px] font-semibold tracking-[0.32em] text-white">QALAA</span>
          <span className="hidden text-[10.5px] uppercase tracking-[0.18em] text-[#7d8896] lg:inline">Cross-agency authority gate</span>
        </div>
        <span className="border border-[#e5b43c]/70 px-2 py-0.5 text-[10px] font-semibold tracking-[0.2em] text-[#e5b43c]">SYNTHETIC DEMO</span>
        <div className="h-5 w-px bg-[#1f2630]" />
        <div className="flex items-center gap-3">
          <span className="text-[10.5px] uppercase tracking-[0.18em] text-[#7d8896]">Mission</span>
          <span className="text-[13.5px] font-semibold text-white">{snapshot?.mission.incidentCode ?? "INC-024"}</span>
          <span className="hidden text-[#aeb7c3] xl:inline">{snapshot?.mission.title ?? ""}</span>
          <span className="border border-[#ef5f6a]/60 px-1.5 py-px text-[10px] font-semibold tracking-[0.18em] text-[#ef5f6a]">HIGH</span>
        </div>
        <div className="ml-auto flex items-center gap-4">
          <span className="font-mono text-[11.5px] text-[#7d8896]">SERVER {snapshot ? hhmmss(snapshot.serverTime) : "—"}</span>
          <button
            type="button"
            onClick={() => setDrawer((d) => !d)}
            className={`relative border px-3 py-1 text-[11px] font-medium uppercase tracking-[0.16em] transition ${
              drawerHasWork ? "border-[#e5b43c] bg-[#e5b43c]/10 text-[#e5b43c]" : "border-[#2a3340] text-[#aeb7c3] hover:bg-white/5"
            }`}
          >
            Entity B desk
            {drawerHasWork && <span className="absolute -right-1 -top-1 h-2.5 w-2.5 animate-pulse rounded-full bg-[#e5b43c]" />}
          </button>
          <button type="button" onClick={onReset} disabled={!!busy} className="border border-[#2a3340] px-3 py-1 text-[11px] font-medium uppercase tracking-[0.16em] text-[#d5dbe5] transition hover:bg-white/10 disabled:opacity-40">
            {busy === "reset" ? "Resetting…" : "Reset"}
          </button>
        </div>
      </header>

      {fault && <div className="border-b border-[#ef5f6a]/40 bg-[#ef5f6a]/10 px-5 py-1 font-mono text-xs text-[#ef5f6a]">{fault}</div>}

      {/* Dominant state band */}
      <section className="shrink-0 border-b border-[#1f2630] bg-[#0d1117]">
        {band ? (
          <div key={band.label} className="qalaa-state-in flex items-stretch">
            <div className={`w-2 shrink-0 ${TONE_RULE[band.tone]}`} />
            <div className="flex min-w-0 flex-1 items-center gap-8 px-6 py-4">
              <div className="min-w-0">
                <div className="text-[10.5px] uppercase tracking-[0.2em] text-[#7d8896]">Operational authority state · server-derived</div>
                <div className={`mt-1 text-[24px] font-semibold leading-[1.05] tracking-[0.06em] xl:text-[30px] ${TONE_TEXT[band.tone]}`}>{band.label}</div>
                <div className="mt-2 max-w-[900px] text-[13px] leading-snug text-[#aeb7c3]">{band.detail}</div>
              </div>
              <div className="ml-auto hidden shrink-0 items-stretch divide-x divide-[#1f2630] border border-[#1f2630] lg:flex">
                <Fact k="Actor" v="Agent 47" sub="Entity A · autonomous" />
                <Fact
                  k="Mandate"
                  v={lease ? lease.status : "NONE"}
                  sub={!lease ? "no lease on Entity B" : lease.status === "REVOKED" ? `closed ${hhmm(lease.revokedAt)} · no path` : lease.status === "EXPIRED" ? `expired ${hhmm(lease.expiresAt)}` : `${lease.scopes.length} scopes · until ${hhmm(lease.expiresAt)}`}
                  tone={lease?.status === "ACTIVE" ? "allow" : lease?.status === "REVOKED" || lease?.status === "EXPIRED" ? "deny" : "neutral"}
                />
                <Fact
                  k="Entity B"
                  v={lease?.status === "REVOKED" ? "REVOKED" : lease?.receiverAcceptedBy ? "ACCEPTED" : lease?.status === "ISSUER_APPROVED" ? "PENDING" : "—"}
                  sub={lease?.status === "REVOKED" ? `by ${approverName}` : lease?.receiverAcceptedBy ? approverName : "no acceptance"}
                  tone={lease?.status === "REVOKED" ? "deny" : lease?.receiverAcceptedBy ? "allow" : lease?.status === "ISSUER_APPROVED" ? "info" : "neutral"}
                />
                <Fact k="Connector B-17" v={connector?.isolated ? "ISOLATED" : "ACTIVE"} sub={connector ? `state v${connector.version}` : ""} tone={connector?.isolated ? "stepup" : "neutral"} />
              </div>
            </div>
          </div>
        ) : (
          <div className="px-6 py-5 text-[#7d8896]">Loading server state…</div>
        )}
      </section>

      {/* Body */}
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_340px] xl:grid-cols-[250px_minmax(0,1fr)_380px]">
        {/* Left: objects */}
        <aside className="hidden min-h-0 flex-col border-r border-[#1f2630] bg-[#0d1117] xl:flex">
          <PanelHeader>Operation sequence</PanelHeader>
          <ol className="px-5 py-3">
            {SEQUENCE.map((s, i) => {
              const state = i < stepIdx ? "done" : i === stepIdx ? "current" : "todo";
              const terminal = s.id === "REVOKED" && (step === "REVOKED" || step === "EXPIRED");
              return (
                <li key={s.id} className="relative flex items-center gap-3 py-[5px]">
                  {i < SEQUENCE.length - 1 && <span className={`absolute left-[5px] top-[19px] h-full w-px ${state === "done" ? "bg-[#3ecf8e]/50" : "bg-[#1f2630]"}`} />}
                  <span className={`h-[11px] w-[11px] shrink-0 border ${terminal ? "border-[#ef5f6a] bg-[#ef5f6a]" : state === "done" ? "border-[#3ecf8e] bg-[#3ecf8e]" : state === "current" ? "border-[#e5b43c] bg-[#e5b43c]/30" : "border-[#3a4452]"}`} />
                  <span className={`text-[12.5px] ${state === "todo" ? "text-[#5c6672]" : state === "current" ? "font-semibold text-white" : "text-[#aeb7c3]"}`}>{s.label}</span>
                </li>
              );
            })}
          </ol>

          <PanelHeader>Mission</PanelHeader>
          <ObjectCard kind="Mission" title="Incident 024" tone={snapshot?.mission.status === "DECLARED" ? "info" : "neutral"}>
            <KV k="Status" v={snapshot?.mission.status ?? "—"} />
            <KV k="Severity" v="HIGH" />
            <KV k="Declared by" v={snapshot?.mission.declaredBy ? commanderName : "—"} />
            <KV k="Valid until" v={hhmm(snapshot?.mission.expiresAt)} mono />
          </ObjectCard>

          <PanelHeader>Authority lease</PanelHeader>
          <ObjectCard kind="Authority lease" title={lease ? "Temporary mandate on Entity B" : "None"} tone={lease?.status === "ACTIVE" ? "allow" : lease?.status === "REVOKED" || lease?.status === "EXPIRED" ? "deny" : lease ? "info" : "neutral"}>
            {lease ? (
              <>
                <KV k="Status" v={lease.status} tone={lease.status === "ACTIVE" ? "allow" : lease.status === "REVOKED" || lease.status === "EXPIRED" ? "deny" : "neutral"} />
                <KV k="Entity A" v={lease.issuerApprovedBy ? "Approved" : "Not approved"} tone={lease.issuerApprovedBy ? "allow" : "neutral"} />
                <KV k="Entity B" v={lease.status === "REVOKED" ? "Revoked" : lease.receiverAcceptedBy ? "Accepted" : "Not accepted"} tone={lease.status === "REVOKED" ? "deny" : lease.receiverAcceptedBy ? "allow" : "neutral"} />
                <KV k="Expires" v={hhmm(lease.expiresAt)} mono />
                <div className="mt-2 flex flex-wrap gap-1">
                  {lease.scopes.map((s) => (
                    <span key={s.action} className={`border px-1.5 py-px font-mono text-[10px] ${s.action === "ISOLATE_CONNECTOR" ? "border-[#e5b43c]/50 text-[#e5b43c]" : "border-[#2a3340] text-[#aeb7c3]"}`}>
                      {s.action}
                    </span>
                  ))}
                  <span className="border border-[#ef5f6a]/50 px-1.5 py-px font-mono text-[10px] text-[#ef5f6a]">CITIZEN_PII excluded</span>
                </div>
                {proposal && <div className="mt-2 text-[11px] text-[#7d8896]">Proposal: {proposal.source === "MODEL" ? "model-drafted" : "rule fallback"} · ceiling {proposal.grantedMinutes}m</div>}
              </>
            ) : (
              <div className="text-[12px] text-[#7d8896]">Entity A cannot grant itself access to Entity B. A lease exists only after proposal, Entity A approval and Entity B acceptance.</div>
            )}
          </ObjectCard>

          <PanelHeader>Protected resource</PanelHeader>
          <ObjectCard kind="Connector" title="Connector B-17" tone={connector?.isolated ? "stepup" : "neutral"}>
            <KV k="State" v={connector?.isolated ? "ISOLATED" : "ACTIVE"} tone={connector?.isolated ? "stepup" : "neutral"} />
            <KV k="Version" v={connector ? `v${connector.version}` : "—"} mono />
            <KV k="Isolation" v="Human-gated · Entity B" />
          </ObjectCard>
        </aside>

        {/* Center: graph hero + operator consoles */}
        <main className="flex min-h-0 flex-col">
          <div className="flex items-center justify-between border-b border-[#1f2630] px-5 py-1.5">
            <span className="text-[10.5px] uppercase tracking-[0.2em] text-[#7d8896]">Authority graph · Entity A → Entity B</span>
            <div className="flex items-center gap-4 text-[10.5px] uppercase tracking-[0.12em] text-[#7d8896]">
              <Legend color="#3ecf8e" label="allowed" />
              <Legend color="#e5b43c" label="human-gated" />
              <Legend color="#ef5f6a" label="denied" />
              <Legend color="#f08a4b" label="isolated" />
            </div>
          </div>
          <div className="min-h-0 flex-1 px-2 pt-1">{snapshot ? <AuthorityGraphView snapshot={snapshot} focus={focus} /> : null}</div>

          <div className="grid shrink-0 grid-cols-3 gap-px border-t border-[#1f2630] bg-[#1f2630]">
            <Console title="Entity A · Command" who={commanderName}>
              <Cmd busy={busy === "declare"} disabled={!ready || !!busy || snapshot?.mission.status === "DECLARED"} onClick={() => run("declare", "Declare Incident 024", "POST", "/api/mission/declare", "ISSUER_COMMANDER", (t) => api.declare(t!))}>
                Declare Incident 024
              </Cmd>
              <Cmd
                busy={busy === "propose"}
                disabled={!ready || !!busy || snapshot?.mission.status !== "DECLARED" || (!!lease && lease.status !== "REVOKED" && lease.status !== "EXPIRED")}
                onClick={() => run("propose", "Generate lease proposal", "POST", "/api/leases/propose", "ISSUER_COMMANDER", (t) => api.propose(t!))}
              >
                Generate lease proposal
              </Cmd>
              <Cmd busy={busy === "issuer"} disabled={!ready || !!busy || lease?.status !== "PROPOSED"} onClick={() => run("issuer", "Approve mission & lease (Entity A)", "POST", "/api/leases/issuer-approve", "ISSUER_COMMANDER", (t) => api.issuerApprove(t!))}>
                Approve mission &amp; lease
              </Cmd>
            </Console>

            <Console title="Agent 47 · Actions on Entity B" who="autonomous agent · Entity A" accent>
              <Cmd busy={busy === "telemetry"} disabled={!ready || !!busy} onClick={() => run("telemetry", ACTION_META.READ_TELEMETRY.title, "GET", ACTION_META.READ_TELEMETRY.path, "AGENT", api.telemetry)}>
                Read security telemetry
              </Cmd>
              <Cmd busy={busy === "citizen"} disabled={!ready || !!busy} onClick={() => run("citizen", ACTION_META.READ_CITIZEN_RECORDS.title, "GET", ACTION_META.READ_CITIZEN_RECORDS.path, "AGENT", api.citizenRecords)}>
                Read citizen records
              </Cmd>
              <Cmd busy={busy === "inspect"} disabled={!ready || !!busy} onClick={() => run("inspect", ACTION_META.INSPECT_CONNECTOR.title, "GET", ACTION_META.INSPECT_CONNECTOR.path, "AGENT", api.inspectConnector)}>
                Inspect connector B-17
              </Cmd>
              <Cmd busy={busy === "isolate"} disabled={!ready || !!busy} danger onClick={() => run("isolate", ACTION_META.ISOLATE_CONNECTOR.title, "POST", ACTION_META.ISOLATE_CONNECTOR.path, "AGENT", api.isolateConnector)}>
                Isolate connector B-17
              </Cmd>
            </Console>

            <Console title="Entity B · Control" who={approverName}>
              <Cmd busy={false} disabled={!ready || !!busy || lease?.status !== "ISSUER_APPROVED"} onClick={() => setDrawer(true)}>
                Review lease proposal
              </Cmd>
              <Cmd busy={false} disabled={!ready || !!busy || pending?.status !== "PENDING"} onClick={() => setDrawer(true)}>
                Review step-up request
              </Cmd>
              <Cmd busy={busy === "revoke"} danger disabled={!ready || !!busy || !lease || lease.status === "REVOKED" || lease.status === "EXPIRED"} onClick={() => run("revoke", "Revoke lease (Entity B)", "POST", "/api/leases/revoke", "RECEIVER_APPROVER", (t) => api.revoke(t!))}>
                Revoke lease
              </Cmd>
            </Console>
          </div>
        </main>

        {/* Right: evidence inspector */}
        <aside className="flex min-h-0 flex-col border-l border-[#1f2630] bg-[#0d1117]">
          <PanelHeader>Decision evidence</PanelHeader>
          {inspect && snapshot ? (
            <Inspector key={inspect.kind === "live" ? `${inspect.action.key}-${inspect.action.at}` : inspect.event.id} inspect={inspect} snapshot={snapshot} onOpenDrawer={() => setDrawer(true)} />
          ) : (
            <div className="px-5 py-6 text-[12.5px] leading-relaxed text-[#7d8896]">
              No action selected. Run an Agent 47 action against Entity B, or select an entry in the decision history. Every protected response is backed by a server-side receipt.
            </div>
          )}
        </aside>
      </div>

      {/* Bottom: decision history */}
      <footer className="h-[168px] shrink-0 border-t border-[#1f2630] bg-[#0d1117]">
        <div className="flex items-center justify-between border-b border-[#1f2630] px-5 py-1.5">
          <span className="text-[10.5px] uppercase tracking-[0.2em] text-[#7d8896]">Decision history · server events · select to open receipt</span>
          <span className="font-mono text-[11px] text-[#7d8896]">
            {snapshot?.events.length ?? 0} events · {snapshot?.decisions.length ?? 0} receipts
          </span>
        </div>
        <ol ref={lineageRef} className="h-[calc(100%-29px)] overflow-y-auto">
          {(snapshot?.events ?? []).map((e) => {
            const receipt = e.receiptId ? snapshot?.decisions.find((d) => d.id === e.receiptId) ?? null : null;
            const t = eventTitle(e, receipt);
            const active = inspect?.kind === "event" && inspect.event.id === e.id;
            return (
              <li key={e.id}>
                <button
                  type="button"
                  onClick={() => setInspect({ kind: "event", event: e, receipt })}
                  className={`grid w-full grid-cols-[84px_260px_minmax(0,1fr)_auto] items-center gap-4 border-b border-[#151b23] px-5 py-[5px] text-left transition hover:bg-white/[0.03] ${active ? "bg-white/[0.05]" : ""}`}
                >
                  <span className="font-mono text-[11.5px] text-[#7d8896]">{hhmmss(e.at)}</span>
                  <span className={`text-[12.5px] font-semibold tracking-[0.08em] ${TONE_TEXT[t.tone]}`}>{t.title}</span>
                  <span className="truncate text-[12px] text-[#aeb7c3]">{e.summary}</span>
                  <span className="font-mono text-[10.5px] text-[#5c6672]">
                    {receipt ? `HTTP ${receipt.httpStatus} · ${receipt.code}` : e.leaseId ? `${e.leaseId} v${e.leaseVersion ?? "?"}` : ""}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </footer>

      {/* Entity B desk: lease acceptance and human step-up */}
      <EntityBDesk
        open={drawer}
        onClose={() => setDrawer(false)}
        snapshot={snapshot}
        busy={busy}
        onAccept={() => run("accept", "Accept constrained lease (Entity B)", "POST", "/api/leases/receiver-accept", "RECEIVER_APPROVER", (t) => api.receiverAccept(t!))}
        onReject={() => run("reject", "Reject lease (Entity B)", "POST", "/api/leases/receiver-reject", "RECEIVER_APPROVER", (t) => api.receiverReject(t!))}
        onApproveStepUp={(id) => run("stepup", "Issue exact isolation approval (Entity B)", "POST", "/api/step-up/approve", "RECEIVER_APPROVER", (t) => api.approveStepUp(t!, id))}
      />
    </div>
  );
}

/* ---------------------------------------------------------------- inspector */

function Inspector({ inspect, snapshot, onOpenDrawer }: { inspect: Inspect; snapshot: Snapshot; onOpenDrawer: () => void }) {
  const [evidence, setEvidence] = useState(false);
  const agentName = snapshot.agents[0]?.name ?? "Agent 47";
  const principalName = (id: string | null) => snapshot.principals.find((p) => p.id === id)?.name ?? id ?? "—";

  if (inspect.kind === "event" && !inspect.receipt) {
    const e = inspect.event;
    const t = eventTitle(e, null);
    return (
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        <Label>Event</Label>
        <div className={`text-[18px] font-semibold tracking-[0.04em] ${TONE_TEXT[t.tone]}`}>{t.title}</div>
        <p className="mt-2 text-[12.5px] leading-relaxed text-[#aeb7c3]">{e.summary}</p>
        <Block title="Record">
          <Mono k="event" v={e.id} />
          <Mono k="at" v={e.at} />
          <Mono k="actor" v={e.actorId ? `${principalName(e.actorId)} · ${e.actorId}` : "—"} />
          {e.leaseId && <Mono k="lease" v={`${e.leaseId} v${e.leaseVersion ?? "?"}`} />}
        </Block>
      </div>
    );
  }

  let action: Action | null;
  let actorLabel: string;
  let decision: Decision | null = null;
  let code = "";
  let reason = "";
  let path: AuthorityCheck[] = [];
  let receiptId: string | null = null;
  let http: number;
  let at: string;
  let method: string;
  let route: string;
  let data: unknown = undefined;
  let lifecycle: LifecycleBody | null = null;
  let title: string;
  let leaseRef: string | null = null;
  let record: DecisionRecord | null = null;

  if (inspect.kind === "event") {
    const r = inspect.receipt!;
    record = r;
    action = r.action;
    actorLabel = `${agentName} · ${r.actorId}`;
    decision = r.decision;
    code = r.code;
    reason = r.reason;
    path = r.authorityPath;
    receiptId = r.id;
    http = r.httpStatus;
    at = r.decidedAt;
    method = ACTION_META[r.action].method;
    route = ACTION_META[r.action].path;
    title = ACTION_META[r.action].title;
    leaseRef = r.leaseId ? `${r.leaseId} v${r.leaseVersion}` : null;
  } else {
    const a = inspect.action;
    action = actionFromPath(a.path);
    actorLabel = ROLE_LABEL[a.role];
    http = a.status;
    at = a.at;
    method = a.method;
    route = a.path;
    title = a.title;
    if (isProtected(a.body)) {
      const body = a.body;
      decision = body.decision;
      code = body.code;
      reason = body.reason;
      path = body.authorityPath;
      receiptId = body.receiptId;
      data = body.data;
      record = snapshot.decisions.find((d) => d.id === body.receiptId) ?? null;
      leaseRef = record?.leaseId ? `${record.leaseId} v${record.leaseVersion}` : null;
    } else if (isLifecycle(a.body)) {
      lifecycle = a.body;
    }
  }

  const tone: Tone = decision ? decisionToneOf(decision) : lifecycle ? (lifecycle.ok ? "info" : "deny") : httpTone(http);
  const targetLabel = action ? ACTION_META[action].target : inspect.kind === "live" ? (inspect.action.path.includes("leases") ? "Authority lease" : inspect.action.path.includes("mission") ? "Incident 024" : inspect.action.path.includes("step-up") ? "Step-up approval" : "Demo state") : "—";
  const isVeto = code === "RESOURCE_CLASS_DENIED";
  const isolationDone = action === "ISOLATE_CONNECTOR" && decision === "ALLOW";
  const pendingId = inspect.kind === "live" && isProtected(inspect.action.body) ? inspect.action.body.pendingRequestId : undefined;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
      <Label>Action</Label>
      <div className="text-[18px] font-semibold leading-tight text-white">{title}</div>
      <div className="mt-1 flex items-center gap-2 font-mono text-[11px] text-[#7d8896]">
        <span className={`border px-1.5 py-px font-semibold ${TONE_BORDER[httpTone(http)]} ${TONE_TEXT[httpTone(http)]}`}>HTTP {http}</span>
        <span>
          {method} {route}
        </span>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 border-y border-[#1f2630] py-3">
        <Field k="Actor" v={actorLabel} />
        <Field k="Mission" v={`Incident 024 · ${snapshot.mission.status === "DECLARED" ? "declared" : "not declared"}`} />
        <Field k="Target" v={targetLabel} />
        {leaseRef && <Field k="Authority" v={leaseRef} mono />}
      </div>

      {decision && (
        <>
          <Label className="mt-4">Authority path</Label>
          <ol className="mt-1 divide-y divide-[#151b23]">
            {path.map((c, i) => (
              <li key={i} className={`py-1.5 ${!c.passed ? "bg-[#ef5f6a]/[0.08] px-2 -mx-2" : ""}`}>
                <div className="flex items-center gap-2.5">
                  <span className={`inline-flex h-4 w-4 shrink-0 items-center justify-center border text-[10px] font-bold ${c.passed ? "border-[#3ecf8e] text-[#3ecf8e]" : "border-[#ef5f6a] bg-[#ef5f6a] text-black"}`}>{c.passed ? "✓" : "✕"}</span>
                  <span className={`text-[12.5px] ${c.passed ? "text-[#d5dbe5]" : "font-semibold text-[#ef5f6a]"}`}>{checkLabel(c.check)}</span>
                  {!c.passed && <span className="ml-auto text-[10px] font-semibold uppercase tracking-[0.14em] text-[#ef5f6a]">failed</span>}
                </div>
                {(evidence || !c.passed) && <div className={`mt-1 pl-[26px] font-mono text-[10.5px] leading-snug ${c.passed ? "text-[#7d8896]" : "text-[#ef5f6a]/90"}`}>{c.check}</div>}
              </li>
            ))}
          </ol>
          <button type="button" onClick={() => setEvidence((v) => !v)} className="mt-2 text-[11px] uppercase tracking-[0.14em] text-[#7d8896] hover:text-[#d5dbe5]">
            {evidence ? "Hide check evidence" : "Show check evidence"}
          </button>

          {isVeto && (
            <div className="mt-4 border border-[#ef5f6a]/60 bg-[#ef5f6a]/[0.06] p-3">
              <div className="text-[10.5px] uppercase tracking-[0.2em] text-[#ef5f6a]">Entity B policy</div>
              <div className="mt-1 font-mono text-[12px] text-[#d5dbe5]">RESOURCE CLASS: CITIZEN_PII</div>
              <div className="font-mono text-[12px] text-[#d5dbe5]">NOT INCLUDED IN DELEGATED MANDATE</div>
              <div className="mt-2 text-[12px] text-[#aeb7c3]">Entity A can authorize the mission. Entity B still controls its resources — the lease never reaches this class.</div>
            </div>
          )}

          <div className={`mt-4 border-l-4 py-2 pl-3 ${TONE_BORDER[tone]}`}>
            <div className="text-[10.5px] uppercase tracking-[0.2em] text-[#7d8896]">Decision</div>
            <div className={`text-[22px] font-semibold tracking-[0.06em] ${TONE_TEXT[tone]}`}>{decision === "HUMAN_APPROVAL_REQUIRED" ? "STEP-UP REQUIRED" : decision}</div>
            {code !== decision && <div className={`font-mono text-[11.5px] ${TONE_TEXT[tone]}`}>{code}</div>}
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-[#aeb7c3]">{reason}</p>
            {pendingId && (
              <button type="button" onClick={onOpenDrawer} className="mt-2 border border-[#e5b43c] bg-[#e5b43c]/10 px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.14em] text-[#e5b43c]">
                Open Entity B desk
              </button>
            )}
          </div>

          {isolationDone && (
            <div className="mt-4 border border-[#f08a4b]/60 bg-[#f08a4b]/[0.06] p-3">
              <div className="text-[10.5px] uppercase tracking-[0.2em] text-[#f08a4b]">Connector state change</div>
              <div className="mt-1 flex items-center gap-3 text-[20px] font-semibold tracking-[0.06em]">
                <span className="text-[#7d8896]">ACTIVE</span>
                <span className="text-[#f08a4b]">→</span>
                <span className="text-[#f08a4b]">ISOLATED</span>
              </div>
              <div className="mt-1 font-mono text-[11px] text-[#aeb7c3]">
                state v{snapshot.connector.version - 1} → v{snapshot.connector.version} · approval consumed · one use
              </div>
            </div>
          )}

          <Block title="Decision receipt · server-side">
            <Mono k="receipt" v={receiptId ?? "—"} tone="text-[#e5b43c]" />
            <Mono k="decided" v={record?.decidedAt ?? at} />
            <Mono k="actor" v={record?.actorId ?? "—"} />
            <Mono k="lease" v={record?.leaseId ? `${record.leaseId} v${record.leaseVersion}` : "none"} />
            <Mono k="policy" v={record ? `${record.policyId} v${record.policyVersion}` : "—"} />
            <Mono k="resource" v={record ? `${record.resourceId} v${record.resourceVersion}` : "—"} />
            <Mono k="action" v={record ? `${record.action} def v${record.actionDefinitionVersion}` : "—"} />
            {record?.approvalId && <Mono k="approval" v={record.approvalId} />}
            <Mono k="request" v={record?.requestId ?? "—"} />
          </Block>

          {data !== undefined && (
            <Block title="Returned data">
              <pre className="max-h-48 overflow-auto bg-black/40 p-2 font-mono text-[10.5px] leading-snug text-[#aeb7c3]">{JSON.stringify(data, null, 2)}</pre>
            </Block>
          )}
        </>
      )}

      {lifecycle && (
        <>
          <div className={`mt-4 border-l-4 py-2 pl-3 ${TONE_BORDER[tone]}`}>
            <div className="text-[10.5px] uppercase tracking-[0.2em] text-[#7d8896]">Result</div>
            <div className={`text-[22px] font-semibold tracking-[0.06em] ${TONE_TEXT[tone]}`}>{lifecycle.ok ? "RECORDED" : "REJECTED"}</div>
            <div className={`font-mono text-[11.5px] ${TONE_TEXT[tone]}`}>{lifecycle.code}</div>
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-[#aeb7c3]">{lifecycle.message}</p>
          </div>
          {lifecycle.data !== undefined && (
            <Block title="Server record">
              <pre className="max-h-72 overflow-auto bg-black/40 p-2 font-mono text-[10.5px] leading-snug text-[#aeb7c3]">{JSON.stringify(lifecycle.data, null, 2)}</pre>
            </Block>
          )}
        </>
      )}

      {!decision && !lifecycle && inspect.kind === "live" && (
        <Block title="Server response">
          <pre className="max-h-72 overflow-auto bg-black/40 p-2 font-mono text-[10.5px] leading-snug text-[#aeb7c3]">{JSON.stringify(inspect.action.body, null, 2)}</pre>
        </Block>
      )}
    </div>
  );
}

/* --------------------------------------------------------------- Entity B desk */

function EntityBDesk({
  open,
  onClose,
  snapshot,
  busy,
  onAccept,
  onReject,
  onApproveStepUp,
}: {
  open: boolean;
  onClose: () => void;
  snapshot: Snapshot | null;
  busy: string | null;
  onAccept: () => void;
  onReject: () => void;
  onApproveStepUp: (pendingId: string) => void;
}) {
  const lease = snapshot?.lease ?? null;
  const proposal = snapshot?.proposal ?? null;
  const pending = snapshot?.pending ?? null;
  const approver = snapshot?.principals.find((p) => p.role === "RECEIVER_APPROVER");
  const stepUp = pending?.status === "PENDING";
  const approval = pending?.approvalId ? snapshot?.approvals.find((a) => a.id === pending.approvalId) : null;
  const hasWork = lease?.status === "ISSUER_APPROVED" || stepUp;

  return (
    <>
      <div className={`fixed inset-y-0 right-0 z-30 flex w-[520px] max-w-full transform flex-col border-l bg-[#0d1117] shadow-2xl transition-transform duration-300 ${stepUp ? "border-[#e5b43c]" : "border-[#2a3340]"} ${open ? "translate-x-0" : "translate-x-full"}`}>
        <div className={`flex items-stretch border-b border-[#1f2630] ${stepUp ? "bg-[#e5b43c]/[0.07]" : ""}`}>
          <div className={`w-2 shrink-0 ${stepUp ? "bg-[#e5b43c]" : lease?.status === "ISSUER_APPROVED" ? "bg-[#6aa6ff]" : "bg-[#2a3340]"}`} />
          <div className="flex-1 px-5 py-4">
            <div className="text-[10.5px] uppercase tracking-[0.2em] text-[#7d8896]">Entity B · {approver?.name ?? "Approver"}</div>
            <div className={`mt-1 text-[22px] font-semibold tracking-[0.05em] ${stepUp ? "text-[#e5b43c]" : lease?.status === "ISSUER_APPROVED" ? "text-[#6aa6ff]" : "text-white"}`}>
              {stepUp ? "HUMAN AUTHORIZATION REQUIRED" : lease?.status === "ISSUER_APPROVED" ? "LEASE AWAITING ACCEPTANCE" : "ENTITY B DESK"}
            </div>
            {stepUp && <div className="mt-1 text-[12.5px] text-[#aeb7c3]">Autonomous authority is held. This action executes only with an exact, one-use approval bound to the request below.</div>}
          </div>
          <button type="button" onClick={onClose} className="self-start px-4 py-4 text-[11px] uppercase tracking-[0.16em] text-[#7d8896] hover:text-white">
            Close
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          {lease?.status === "ISSUER_APPROVED" && proposal && (
            <div className="border border-[#6aa6ff]/50 p-4">
              <div className="text-[10.5px] uppercase tracking-[0.2em] text-[#6aa6ff]">Proposal from Entity A · {proposal.source === "MODEL" ? "model-drafted" : "rule fallback"}</div>
              <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2">
                <Field k="Agent" v="Agent 47" />
                <Field k="Mission" v="Incident 024 · HIGH" />
                <Field k="Issued by" v={`Entity A · ${snapshot?.principals.find((p) => p.id === lease.issuerApprovedBy)?.name ?? lease.issuerApprovedBy}`} />
                <Field k="Duration" v={`${proposal.requestedMinutes}m requested → ${proposal.grantedMinutes}m ceiling (B-4.2)`} />
                <Field k="Lease" v={`${lease.id} v${lease.version}`} mono />
                <Field k="Purpose" v={lease.purpose} mono />
              </div>
              <div className="mt-4 text-[10.5px] uppercase tracking-[0.2em] text-[#7d8896]">Terms against Policy B</div>
              <ul className="mt-2 divide-y divide-[#151b23]">
                {proposal.terms.map((t, i) => (
                  <li key={i} className="flex items-center gap-3 py-1.5">
                    <span className={`w-[92px] shrink-0 border px-1.5 py-px text-center text-[10px] font-semibold tracking-[0.12em] ${!t.accepted ? "border-[#ef5f6a] text-[#ef5f6a]" : t.gate === "HUMAN_GATED" ? "border-[#e5b43c] text-[#e5b43c]" : "border-[#3ecf8e] text-[#3ecf8e]"}`}>
                      {!t.accepted ? "REJECTED" : t.gate === "HUMAN_GATED" ? "HUMAN-GATED" : "ALLOWED"}
                    </span>
                    <span className="text-[12.5px] text-[#d5dbe5]">
                      <span className="font-mono">{t.scope.action}</span> <span className="text-[#7d8896]">on</span> {t.scope.resourceIds.length ? t.scope.resourceIds.join(", ") : t.scope.resourceClass}
                    </span>
                    <span className="ml-auto font-mono text-[10.5px] text-[#7d8896]">{t.policyClause}</span>
                  </li>
                ))}
                {proposal.exclusions.map((x, i) => (
                  <li key={`x-${i}`} className="flex items-center gap-3 py-1.5">
                    <span className="w-[92px] shrink-0 border border-[#ef5f6a] px-1.5 py-px text-center text-[10px] font-semibold tracking-[0.12em] text-[#ef5f6a]">EXCLUDED</span>
                    <span className="text-[12.5px] text-[#d5dbe5]">
                      <span className="font-mono">{x.resourceClass}</span> <span className="text-[#7d8896]">— never delegated</span>
                    </span>
                    <span className="ml-auto font-mono text-[10.5px] text-[#7d8896]">{x.policyClause}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-5 flex gap-2">
                <Cmd busy={busy === "accept"} disabled={!!busy} primary onClick={onAccept}>
                  Accept constrained lease
                </Cmd>
                <Cmd busy={busy === "reject"} disabled={!!busy} danger onClick={onReject}>
                  Reject
                </Cmd>
              </div>
            </div>
          )}

          {pending && stepUp && (
            <div className="border border-[#e5b43c] p-4">
              <div className="text-[10.5px] uppercase tracking-[0.2em] text-[#e5b43c]">Exact action requested</div>
              <div className="mt-2 font-mono text-[20px] font-semibold text-white">{pending.action}</div>
              <div className="font-mono text-[13px] text-[#e5b43c]">on {pending.resourceId} · Connector B-17</div>
              <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2.5">
                <Field k="Agent" v={`Agent 47 · ${pending.actorId}`} />
                <Field k="Mission" v="Incident 024 · HIGH" />
                <Field k="Lease / version" v={`${pending.leaseId} v${pending.leaseVersion}`} mono />
                <Field k="Lease expires" v={hhmmss(pending.leaseExpiresAt)} mono />
                <Field k="Approval expiry" v="10 minutes after issue · one use" />
                <Field k="Approver" v={`${approver?.name ?? "—"} · Entity B`} />
                <Field k="Request" v={pending.id} mono />
                <Field k="Receipt" v={pending.receiptId} mono />
              </div>
              <p className="mt-4 text-[12px] leading-relaxed text-[#aeb7c3]">
                The approval binds exactly this lease version, mission, agent, action and resource. The resolver rechecks everything at execution, consumes the approval and mutates the connector once.
              </p>
              <div className="mt-5">
                <Cmd busy={busy === "stepup"} disabled={!!busy} primary onClick={() => onApproveStepUp(pending.id)}>
                  Issue exact one-use approval
                </Cmd>
              </div>
            </div>
          )}

          {pending && pending.status === "APPROVED" && (
            <div className="border border-[#3ecf8e]/60 p-4">
              <div className="text-[10.5px] uppercase tracking-[0.2em] text-[#3ecf8e]">Exact approval issued · not yet consumed</div>
              <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-2">
                <Field k="Approval" v={pending.approvalId ?? "—"} mono />
                <Field k="Valid until" v={hhmmss(approval?.expiresAt)} mono />
                <Field k="Bound to" v={`${pending.leaseId} v${pending.leaseVersion}`} mono />
                <Field k="Approver" v={approver?.name ?? "—"} />
              </div>
              <p className="mt-3 text-[12px] leading-relaxed text-[#aeb7c3]">Agent 47 must now re-attempt the isolation. Nothing has changed on the connector yet.</p>
            </div>
          )}

          {!hasWork && pending?.status !== "APPROVED" && (
            <div className="border border-[#1f2630] p-4 text-[12.5px] text-[#7d8896]">
              Nothing awaiting Entity B.{" "}
              {lease?.status === "ACTIVE"
                ? "The mandate is active; it can be revoked from the Entity B console."
                : lease?.status === "PROPOSED"
                  ? "Entity A must approve the proposal first."
                  : lease?.status === "REVOKED" || lease?.status === "EXPIRED"
                    ? `Lease ${lease.id} is ${lease.status.toLowerCase()}; Agent 47 holds no authority.`
                    : "Declare the incident and generate a proposal first."}
            </div>
          )}

          {(snapshot?.approvals.length ?? 0) > 0 && (
            <div className="mt-6">
              <div className="text-[10.5px] uppercase tracking-[0.2em] text-[#7d8896]">Approval ledger</div>
              <ul className="mt-2 divide-y divide-[#151b23]">
                {snapshot!.approvals.map((a) => {
                  const expired = new Date(a.expiresAt) < new Date(snapshot!.serverTime);
                  return (
                    <li key={a.id} className="flex items-center justify-between py-1.5 font-mono text-[11px]">
                      <span className="text-[#aeb7c3]">
                        {a.id} · {a.leaseId} v{a.leaseVersion}
                      </span>
                      <span className={a.consumedAt ? "text-[#7d8896]" : expired ? "text-[#ef5f6a]" : "text-[#3ecf8e]"}>{a.consumedAt ? `CONSUMED ${hhmmss(a.consumedAt)}` : expired ? "EXPIRED" : `VALID UNTIL ${hhmmss(a.expiresAt)}`}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      </div>
      {open && <button type="button" aria-label="Close Entity B desk" onClick={onClose} className="fixed inset-0 z-20 bg-black/55" />}
    </>
  );
}

/* ------------------------------------------------------------------ atoms */

function PanelHeader({ children }: { children: React.ReactNode }) {
  return <div className="border-b border-t border-[#1f2630] bg-[#0b0e13] px-5 py-1.5 text-[10.5px] uppercase tracking-[0.2em] text-[#7d8896] first:border-t-0">{children}</div>;
}

function Label({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={`text-[10.5px] uppercase tracking-[0.2em] text-[#7d8896] ${className ?? ""}`}>{children}</div>;
}

function Fact({ k, v, sub, tone }: { k: string; v: string; sub: string; tone?: Tone }) {
  return (
    <div className="min-w-[128px] px-4 py-2">
      <div className="text-[10px] uppercase tracking-[0.18em] text-[#7d8896]">{k}</div>
      <div className={`mt-0.5 text-[13.5px] font-semibold tracking-[0.04em] ${tone ? TONE_TEXT[tone] : "text-white"}`}>{v}</div>
      <div className="truncate text-[11px] text-[#7d8896]">{sub}</div>
    </div>
  );
}

function ObjectCard({ kind, title, tone, children }: { kind: string; title: string; tone: Tone; children: React.ReactNode }) {
  return (
    <div className="px-5 py-3">
      <div className={`border-l-[3px] pl-3 ${TONE_BORDER[tone]}`}>
        <div className="text-[10px] uppercase tracking-[0.18em] text-[#7d8896]">{kind}</div>
        <div className="text-[14px] font-semibold text-white">{title}</div>
      </div>
      <div className="mt-2 space-y-1">{children}</div>
    </div>
  );
}

function KV({ k, v, tone, mono }: { k: string; v: string; tone?: Tone; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-3 text-[12px]">
      <span className="text-[#7d8896]">{k}</span>
      <span className={`truncate text-right ${mono ? "font-mono text-[11.5px]" : ""} ${tone ? TONE_TEXT[tone] : "text-[#d5dbe5]"}`} title={v}>
        {v}
      </span>
    </div>
  );
}

function Field({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-[0.18em] text-[#7d8896]">{k}</div>
      <div className={`break-words text-[13px] text-[#d5dbe5] ${mono ? "font-mono text-[12px]" : ""}`} title={v}>
        {v}
      </div>
    </div>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-4 border-t border-[#1f2630] pt-3">
      <div className="mb-1.5 text-[10.5px] uppercase tracking-[0.2em] text-[#7d8896]">{title}</div>
      {children}
    </div>
  );
}

function Mono({ k, v, tone }: { k: string; v: string; tone?: string }) {
  return (
    <div className="flex justify-between gap-3 font-mono text-[11px]">
      <span className="shrink-0 text-[#7d8896]">{k}</span>
      <span className={`truncate text-right ${tone ?? "text-[#d5dbe5]"}`} title={v}>
        {v}
      </span>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="inline-block h-2 w-2" style={{ background: color }} />
      {label}
    </span>
  );
}

function Console({ title, who, children, accent }: { title: string; who?: string; children: React.ReactNode; accent?: boolean }) {
  return (
    <div className={`flex flex-col gap-2 px-4 py-3 ${accent ? "bg-[#10161e]" : "bg-[#0d1117]"}`}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[10.5px] uppercase tracking-[0.2em] text-[#aeb7c3]">{title}</span>
        {who && <span className="truncate text-[10.5px] text-[#5c6672]">{who}</span>}
      </div>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

function Cmd({ children, onClick, disabled, busy, danger, primary }: { children: React.ReactNode; onClick: () => void; disabled?: boolean; busy: boolean; danger?: boolean; primary?: boolean }) {
  const base = "border px-3 py-1.5 text-[12.5px] font-medium transition disabled:cursor-not-allowed disabled:opacity-30";
  const tone = primary
    ? "border-[#3ecf8e] bg-[#3ecf8e]/10 text-[#d9f7ea] hover:bg-[#3ecf8e]/20"
    : danger
      ? "border-[#ef5f6a]/60 bg-[#ef5f6a]/5 text-[#ffd7da] hover:bg-[#ef5f6a]/15"
      : "border-[#2a3340] bg-white/[0.03] text-[#e6ebf2] hover:bg-white/10";
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={`${base} ${tone}`}>
      {busy ? "…" : children}
    </button>
  );
}
