"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Action, AuthorityCheck, Decision, DecisionRecord, DemoRole, GovernanceEvent } from "@/lib/domain/types";
import type { DemoStep, Snapshot } from "@/lib/snapshot";
import { api, type ApiResult, type LifecycleBody, type ProtectedBody } from "./api-client";
import { AuthorityGraphView, type GraphFocus } from "./authority-graph";
import { ACTION_META, actionFromPath, bandState, checkLabel, eventTitle, hhmm, hhmmss, minutesRemaining, stopPointFor, type ObjectRef, type Tone } from "./evidence";

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

type Inspect = { kind: "live"; action: LiveAction } | { kind: "event"; event: GovernanceEvent; receipt: DecisionRecord | null } | { kind: "object"; ref: ObjectRef };

function refKey(ref: ObjectRef) {
  return ref.kind === "resource" || ref.kind === "entity" ? `${ref.kind}:${ref.id}` : ref.kind;
}

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
  isolated: "text-[#f08a4b]",
};
const TONE_RULE: Record<Tone, string> = {
  neutral: "bg-[#4b5563]",
  allow: "bg-[#3ecf8e]",
  deny: "bg-[#ef5f6a]",
  stepup: "bg-[#e5b43c]",
  info: "bg-[#6aa6ff]",
  isolated: "bg-[#f08a4b]",
};
const TONE_BORDER: Record<Tone, string> = {
  neutral: "border-[#4b5563]",
  allow: "border-[#3ecf8e]",
  deny: "border-[#ef5f6a]",
  stepup: "border-[#e5b43c]",
  info: "border-[#6aa6ff]",
  isolated: "border-[#f08a4b]",
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
  const connector = snapshot?.connector ?? null;
  const band = snapshot ? bandState(snapshot) : null;
  const drawerHasWork = lease?.status === "ISSUER_APPROVED" || pending?.status === "PENDING";

  const focus = useMemo<GraphFocus | null>(() => {
    if (!inspect || inspect.kind === "object") return null;
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

  const selectedRef = inspect?.kind === "object" ? inspect.ref : null;
  const selectObject = (ref: ObjectRef) => setInspect({ kind: "object", ref });

  const ready = !!tokens.AGENT && !!tokens.ISSUER_COMMANDER && !!tokens.RECEIVER_APPROVER && !!snapshot;
  const approverName = snapshot?.principals.find((p) => p.role === "RECEIVER_APPROVER")?.name ?? "Entity B approver";
  const commanderName = snapshot?.principals.find((p) => p.role === "ISSUER_COMMANDER")?.name ?? "Entity A commander";

  return (
    <div className="flex h-screen min-h-[980px] w-screen flex-col overflow-hidden bg-[#0b0e13] text-[13px] text-[#d5dbe5]">
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
                <div className="text-[11px] uppercase tracking-[0.14em] text-[#8a94a3]">Current authority condition · server-derived</div>
                <div className={`mt-1 text-[24px] font-semibold leading-[1.05] tracking-[0.06em] xl:text-[30px] ${TONE_TEXT[band.tone]}`}>{band.label}</div>
                <div className="mt-2 max-w-[900px] text-[13px] leading-snug text-[#aeb7c3]">{band.detail}</div>
              </div>
              <div className="ml-auto hidden shrink-0 items-stretch divide-x divide-[#1f2630] lg:flex">
                <Fact k="Actor" v="Agent 47" sub="Entity A · autonomous" />
                <Fact
                  k="Authority"
                  v={lease ? lease.status.replace("_", " ") : "NONE"}
                  sub={
                    !lease
                      ? "no lease on Entity B"
                      : lease.status === "REVOKED"
                        ? `closed ${hhmm(lease.revokedAt)} · no path`
                        : lease.status === "EXPIRED"
                          ? `expired ${hhmm(lease.expiresAt)}`
                          : lease.status === "ACTIVE"
                            ? `${minutesRemaining(lease.expiresAt, snapshot!.serverTime)} min remaining`
                            : "nothing granted yet"
                  }
                  tone={lease?.status === "ACTIVE" ? "allow" : lease?.status === "REVOKED" || lease?.status === "EXPIRED" ? "deny" : "neutral"}
                />
                <Fact
                  k="Entity B"
                  v={lease?.status === "REVOKED" ? "REVOKED" : lease?.receiverAcceptedBy ? "ACCEPTED" : lease?.status === "ISSUER_APPROVED" ? "PENDING" : "—"}
                  sub={lease?.status === "REVOKED" ? `by ${approverName}` : lease?.receiverAcceptedBy ? approverName : "no acceptance"}
                  tone={lease?.status === "REVOKED" ? "deny" : lease?.receiverAcceptedBy ? "allow" : lease?.status === "ISSUER_APPROVED" ? "info" : "neutral"}
                />
                <Fact k="Connector B-17" v={connector?.isolated ? "ISOLATED" : "ACTIVE"} sub={connector?.isolated ? `since ${hhmm(connector.isolatedAt)}` : "operational"} tone={connector?.isolated ? "isolated" : "neutral"} />
              </div>
            </div>
          </div>
        ) : (
          <div className="px-6 py-5 text-[#7d8896]">Loading server state…</div>
        )}
      </section>

      {/* Body */}
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_340px] xl:grid-cols-[270px_minmax(0,1fr)_380px]">
        {/* Left: objects */}
        <aside className="hidden min-h-0 flex-col overflow-y-auto border-r border-[#1f2630] bg-[#0d1117] xl:flex">
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

          <PanelHeader>Objects</PanelHeader>
          <ul className="px-3 py-2">
            <ObjectRow label="Entity A" type="Requesting agency" state="Issuer" tone="neutral" selected={selectedRef?.kind === "entity" && selectedRef.id === "entity-a"} onClick={() => selectObject({ kind: "entity", id: "entity-a" })} />
            <ObjectRow label="Agent 47" type="Autonomous agent" state={lease?.status === "ACTIVE" ? "Authorized" : "No authority"} tone={lease?.status === "ACTIVE" ? "allow" : "neutral"} selected={selectedRef?.kind === "agent"} onClick={() => selectObject({ kind: "agent" })} indent />
            <ObjectRow
              label="Incident 024"
              type="Mission"
              state={snapshot?.mission.status === "DECLARED" ? "Active" : "Not declared"}
              tone={snapshot?.mission.status === "DECLARED" ? "info" : "neutral"}
              selected={selectedRef?.kind === "mission"}
              onClick={() => selectObject({ kind: "mission" })}
              indent
            />
            <ObjectRow
              label="Temporary authority"
              type="Lease on Entity B"
              state={!lease ? "None" : lease.status === "ACTIVE" ? "Active" : lease.status === "ISSUER_APPROVED" ? "Awaiting B" : lease.status === "PROPOSED" ? "Proposed" : lease.status === "REVOKED" ? "Revoked" : "Expired"}
              tone={lease?.status === "ACTIVE" ? "allow" : lease?.status === "REVOKED" || lease?.status === "EXPIRED" ? "deny" : lease?.status === "ISSUER_APPROVED" ? "info" : "neutral"}
              selected={selectedRef?.kind === "lease"}
              onClick={() => selectObject({ kind: "lease" })}
              indent
            />
            <ObjectRow label="Entity B" type="Resource owner" state="Veto holder" tone="neutral" selected={selectedRef?.kind === "entity" && selectedRef.id === "entity-b"} onClick={() => selectObject({ kind: "entity", id: "entity-b" })} />
            {(snapshot?.resources ?? []).map((r) => {
              const denied = snapshot?.graph.edges.some((e) => e.kind === "POLICY_DENIED" && e.to === r.id) ?? false;
              const auth = snapshot?.graph.edges.filter((e) => e.kind === "ACTIVE_AUTHORITY" && e.to === r.id) ?? [];
              const isolated = r.id === "connector-b-17" && !!connector?.isolated;
              const state = denied ? "Denied" : isolated ? "Isolated" : auth.some((e) => e.gated) ? "Human-gated" : auth.length ? "Allowed" : "No access";
              const tone: Tone = denied ? "deny" : isolated ? "isolated" : auth.some((e) => e.gated) ? "stepup" : auth.length ? "allow" : "neutral";
              return <ObjectRow key={r.id} label={r.displayName} type="Protected resource" state={state} tone={tone} selected={selectedRef?.kind === "resource" && selectedRef.id === r.id} onClick={() => selectObject({ kind: "resource", id: r.id })} indent />;
            })}
          </ul>
          <div className="mt-auto px-5 py-4 text-[11.5px] leading-relaxed text-[#5c6672]">Select any object or action for its full server-side evidence.</div>
        </aside>

        {/* Center: graph hero + operator consoles */}
        <main className="flex min-h-0 flex-col">
          <div className="flex items-center justify-between px-6 pt-3">
            <span className="text-[11px] uppercase tracking-[0.14em] text-[#8a94a3]">Common operating picture · who → mission → authority → resource → outcome</span>
            <div className="flex items-center gap-4 text-[11px] text-[#8a94a3]">
              <Legend color="#3ecf8e" label="Allowed" />
              <Legend color="#e5b43c" label="Human-gated" />
              <Legend color="#ef5f6a" label="Denied / revoked" />
              <Legend color="#f08a4b" label="Isolated" />
            </div>
          </div>
          <div className="min-h-[300px] flex-1 px-3">{snapshot ? <AuthorityGraphView snapshot={snapshot} focus={focus} selected={selectedRef} onSelect={selectObject} /> : null}</div>

          <div className="grid shrink-0 grid-cols-3 divide-x divide-[#1f2630] border-t border-[#1f2630]">
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

            <Console title="Agent 47 · Actions on Entity B" who="autonomous agent · Entity A">
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
          <PanelHeader>{inspect?.kind === "object" ? "Object" : "Decision evidence"}</PanelHeader>
          {inspect && snapshot ? (
            inspect.kind === "object" ? (
              <ObjectInspector key={refKey(inspect.ref)} ref_={inspect.ref} snapshot={snapshot} onSelect={selectObject} />
            ) : (
              <Inspector key={inspect.kind === "live" ? `${inspect.action.key}-${inspect.action.at}` : inspect.event.id} inspect={inspect} snapshot={snapshot} onOpenDrawer={() => setDrawer(true)} />
            )
          ) : (
            <div className="px-5 py-6 text-[12.5px] leading-relaxed text-[#7d8896]">Nothing selected. Select an object on the picture, run an Agent 47 action, or open a timeline entry. Every protected response is backed by a server-side receipt.</div>
          )}
        </aside>
      </div>

      {/* Bottom: decision history */}
      <footer className="h-[160px] shrink-0 border-t border-[#1f2630] bg-[#0d1117]">
        <div className="flex items-center justify-between px-5 pt-2 pb-1">
          <span className="text-[11px] uppercase tracking-[0.14em] text-[#8a94a3]">Operational timeline</span>
          <span className="text-[11px] text-[#5c6672]">{snapshot?.decisions.length ?? 0} receipts · select an entry for its full record</span>
        </div>
        <ol ref={lineageRef} className="h-[calc(100%-30px)] overflow-y-auto">
          {(snapshot?.events ?? []).map((e) => {
            const receipt = e.receiptId ? snapshot?.decisions.find((d) => d.id === e.receiptId) ?? null : null;
            const t = eventTitle(e, receipt);
            const active = inspect?.kind === "event" && inspect.event.id === e.id;
            return (
              <li key={e.id}>
                <button type="button" onClick={() => setInspect({ kind: "event", event: e, receipt })} className={`grid w-full grid-cols-[88px_300px_minmax(0,1fr)] items-center gap-5 px-5 py-[4px] text-left transition hover:bg-white/[0.03] ${active ? "bg-white/[0.05]" : ""}`}>
                  <span className="font-mono text-[11.5px] text-[#7d8896]">{hhmmss(e.at)}</span>
                  <span className={`flex items-center gap-2.5 text-[12.5px] font-semibold tracking-[0.06em] ${TONE_TEXT[t.tone]}`}>
                    <span className={`inline-block h-1.5 w-1.5 shrink-0 ${TONE_RULE[t.tone]}`} />
                    {t.title}
                  </span>
                  <span className="truncate text-[12px] text-[#7d8896]">{e.summary}</span>
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

function Inspector({ inspect, snapshot, onOpenDrawer }: { inspect: Exclude<Inspect, { kind: "object" }>; snapshot: Snapshot; onOpenDrawer: () => void }) {
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
  const failed = path.find((c) => !c.passed) ?? null;
  const passedChecks = path.filter((c) => c.passed);
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

      <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-y border-[#1f2630] py-3">
        <Field k="Actor" v={actorLabel} />
        <Field k="Mission" v={`Incident 024 · ${snapshot.mission.status === "DECLARED" ? "declared" : "not declared"}`} />
        <Field k="Target" v={targetLabel} />
        {action && <Field k="Receiver" v="Entity B" />}
        {leaseRef && <Field k="Lease" v={leaseRef} mono />}
        {record && <Field k="Policy" v={`${record.policyId} v${record.policyVersion}`} mono />}
      </div>

      {decision && (
        <>
          {failed && (
            <div className={`mt-4 border-l-4 py-2.5 pl-3 pr-3 ${decision === "HUMAN_APPROVAL_REQUIRED" ? "border-[#e5b43c] bg-[#e5b43c]/[0.07]" : "border-[#ef5f6a] bg-[#ef5f6a]/[0.07]"}`}>
              <div className={`text-[11px] uppercase tracking-[0.14em] ${decision === "HUMAN_APPROVAL_REQUIRED" ? "text-[#e5b43c]" : "text-[#ef5f6a]"}`}>{decision === "HUMAN_APPROVAL_REQUIRED" ? "Held for human approval" : "Failed check"}</div>
              <div className={`mt-0.5 text-[16px] font-semibold ${decision === "HUMAN_APPROVAL_REQUIRED" ? "text-[#e5b43c]" : "text-[#ef5f6a]"}`}>{checkLabel(failed.check)}</div>
              <div className="mt-1 break-words font-mono text-[11px] leading-snug text-[#d5dbe5]">{failed.check}</div>
            </div>
          )}

          {isolationDone && (
            <div className="mt-4 border-l-4 border-[#f08a4b] bg-[#f08a4b]/[0.07] py-2.5 pl-3 pr-3">
              <div className="text-[11px] uppercase tracking-[0.14em] text-[#f08a4b]">Connector state change</div>
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

          <Label className="mt-4">Authority path · {passedChecks.length} passed</Label>
          <ol className={`mt-1 ${failed ? "opacity-80" : ""}`}>
            {path.map((c, i) => (
              <li key={i} className="py-1">
                <div className="flex items-center gap-2.5">
                  <span className={`inline-flex h-4 w-4 shrink-0 items-center justify-center text-[11px] font-bold ${c.passed ? "text-[#3ecf8e]" : decision === "HUMAN_APPROVAL_REQUIRED" ? "text-[#e5b43c]" : "text-[#ef5f6a]"}`}>{c.passed ? "✓" : "✕"}</span>
                  <span className={`text-[12.5px] ${c.passed ? "text-[#c3cad4]" : decision === "HUMAN_APPROVAL_REQUIRED" ? "font-semibold text-[#e5b43c]" : "font-semibold text-[#ef5f6a]"}`}>{checkLabel(c.check)}</span>
                </div>
                {evidence && c.passed && <div className="mt-0.5 break-words pl-[26px] font-mono text-[10.5px] leading-snug text-[#7d8896]">{c.check}</div>}
              </li>
            ))}
          </ol>
          <button type="button" onClick={() => setEvidence((v) => !v)} className="mt-2 text-[11px] text-[#7d8896] underline-offset-2 hover:text-[#d5dbe5] hover:underline">
            {evidence ? "Hide check evidence" : "Show check evidence"}
          </button>

          {isVeto && (
            <div className="mt-4 border-l-4 border-[#ef5f6a] py-2 pl-3">
              <div className="text-[11px] uppercase tracking-[0.14em] text-[#ef5f6a]">Entity B veto</div>
              <div className="mt-1 font-mono text-[12px] text-[#d5dbe5]">CITIZEN_PII · OUTSIDE DELEGATED SCOPE</div>
              <div className="mt-1.5 text-[12px] leading-relaxed text-[#aeb7c3]">Entity A can authorize the mission. Entity B still controls its resources — no lease can reach this class.</div>
            </div>
          )}

          <div className={`mt-4 border-l-4 py-2 pl-3 ${TONE_BORDER[tone]}`}>
            <div className="text-[11px] uppercase tracking-[0.14em] text-[#7d8896]">Decision</div>
            <div className={`text-[22px] font-semibold tracking-[0.06em] ${TONE_TEXT[tone]}`}>{decision === "HUMAN_APPROVAL_REQUIRED" ? "STEP-UP REQUIRED" : decision}</div>
            {code !== decision && <div className={`font-mono text-[11.5px] ${TONE_TEXT[tone]}`}>{code}</div>}
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-[#aeb7c3]">{reason}</p>
            {pendingId && (
              <button type="button" onClick={onOpenDrawer} className="mt-2 border border-[#e5b43c] bg-[#e5b43c]/10 px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.14em] text-[#e5b43c]">
                Open Entity B desk
              </button>
            )}
          </div>

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
            <div className="text-[11px] uppercase tracking-[0.14em] text-[#7d8896]">Result</div>
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

/* ------------------------------------------------------------ object inspector */

function ObjectInspector({ ref_, snapshot, onSelect }: { ref_: ObjectRef; snapshot: Snapshot; onSelect: (ref: ObjectRef) => void }) {
  const lease = snapshot.lease;
  const mission = snapshot.mission;
  const policy = snapshot.policyB;
  const principalName = (id: string | null) => snapshot.principals.find((p) => p.id === id)?.name ?? id ?? "—";
  const leaseTone: Tone = !lease ? "neutral" : lease.status === "ACTIVE" ? "allow" : lease.status === "REVOKED" || lease.status === "EXPIRED" ? "deny" : "info";
  const decisionsFor = (resourceId: string) => snapshot.decisions.filter((d) => d.resourceId === resourceId);

  const head = (kind: string, title: string, state: string, tone: Tone) => (
    <>
      <Label>{kind}</Label>
      <div className="text-[20px] font-semibold leading-tight text-white">{title}</div>
      <div className={`mt-1 text-[12.5px] font-semibold tracking-[0.04em] ${TONE_TEXT[tone]}`}>{state}</div>
    </>
  );

  let body: React.ReactNode;

  if (ref_.kind === "agent") {
    const agent = snapshot.agents[0];
    const principal = snapshot.principals.find((p) => p.id === agent?.principalId);
    body = (
      <>
        {head("Autonomous response agent", agent?.name ?? "Agent 47", lease?.status === "ACTIVE" ? "Authorized on Entity B under a temporary lease" : "No cross-agency authority", lease?.status === "ACTIVE" ? "allow" : "neutral")}
        <Block title="Identity">
          <Mono k="agent" v={agent?.id ?? "—"} />
          <Mono k="principal" v={agent?.principalId ?? "—"} />
          <Mono k="role" v={principal?.role ?? "—"} />
          <Mono k="home entity" v={agent?.homeEntityId ?? "—"} />
          <Mono k="active" v={agent ? String(agent.active) : "—"} />
        </Block>
        <Block title="Current authority">
          {lease ? (
            <>
              <KV k="Lease" v={`${lease.id} v${lease.version}`} mono />
              <KV k="Status" v={lease.status} tone={leaseTone} />
              <KV k="Mission" v={mission.incidentCode} />
              <KV k="Receiver" v={lease.receiverEntityId} mono />
            </>
          ) : (
            <p className="text-[12px] leading-relaxed text-[#7d8896]">No lease. Every protected call on Entity B is denied at the resolver.</p>
          )}
        </Block>
        <Block title="What the agent may propose vs. do">
          <p className="text-[12px] leading-relaxed text-[#aeb7c3]">A model may draft a lease proposal. It cannot activate a lease, broaden scope, or execute a human-gated action. Authority exists only when Entity A approves and Entity B accepts, and it is re-resolved server-side on every call.</p>
        </Block>
        <Block title="Decisions on record">
          <Mono k="receipts" v={String(snapshot.decisions.length)} />
          <Mono k="allowed" v={String(snapshot.decisions.filter((d) => d.decision === "ALLOW").length)} />
          <Mono k="denied" v={String(snapshot.decisions.filter((d) => d.decision === "DENY").length)} />
          <Mono k="held" v={String(snapshot.decisions.filter((d) => d.decision === "HUMAN_APPROVAL_REQUIRED").length)} />
        </Block>
      </>
    );
  } else if (ref_.kind === "mission") {
    body = (
      <>
        {head("Mission", `${mission.incidentCode} · ${mission.title}`, mission.status === "DECLARED" ? `HIGH · ACTIVE · valid until ${hhmm(mission.expiresAt)}` : `HIGH · ${mission.status}`, mission.status === "DECLARED" ? "info" : "neutral")}
        <Block title="Record">
          <Mono k="mission" v={`${mission.id} v${mission.version}`} />
          <Mono k="purpose" v={mission.purpose} />
          <Mono k="severity" v={mission.severity} />
          <Mono k="declared by" v={mission.declaredBy ? `${principalName(mission.declaredBy)} · ${mission.declaredBy}` : "—"} />
          <Mono k="declared at" v={mission.declaredAt ?? "—"} />
          <Mono k="valid until" v={mission.expiresAt ?? "—"} />
          <Mono k="declaring entity" v={mission.declaringEntityId} />
        </Block>
        <Block title="Authority derived from this mission">
          {snapshot.leases.length ? (
            snapshot.leases.map((l) => <KV key={l.id} k={`${l.id} v${l.version}`} v={l.status} mono tone={l.status === "ACTIVE" ? "allow" : l.status === "REVOKED" || l.status === "EXPIRED" ? "deny" : "neutral"} />)
          ) : (
            <p className="text-[12px] leading-relaxed text-[#7d8896]">No lease has been proposed under this mission.</p>
          )}
        </Block>
      </>
    );
  } else if (ref_.kind === "lease") {
    const proposal = snapshot.proposal;
    body = lease ? (
      <>
        {head(
          "Temporary authority",
          `Lease ${lease.id}`,
          lease.status === "ACTIVE" ? `ACTIVE · ${minutesRemaining(lease.expiresAt, snapshot.serverTime)} min remaining` : lease.status === "REVOKED" ? `REVOKED · ${hhmmss(lease.revokedAt)} by ${principalName(lease.revokedBy)}` : lease.status === "ISSUER_APPROVED" ? "ENTITY A APPROVED · AWAITING ENTITY B" : lease.status,
          leaseTone,
        )}
        <Block title="Dual approval">
          <KV k="Entity A (issuer)" v={lease.issuerApprovedBy ? `Approved · ${principalName(lease.issuerApprovedBy)}` : "Not approved"} tone={lease.issuerApprovedBy ? "allow" : "neutral"} />
          <KV k="Entity B (receiver)" v={lease.status === "REVOKED" ? `Revoked · ${principalName(lease.revokedBy)}` : lease.receiverAcceptedBy ? `Accepted · ${principalName(lease.receiverAcceptedBy)}` : "Not accepted"} tone={lease.status === "REVOKED" ? "deny" : lease.receiverAcceptedBy ? "allow" : "neutral"} />
        </Block>
        <Block title="Delegated scope">
          {lease.scopes.map((s) => (
            <div key={s.action} className="flex items-center justify-between gap-3 py-0.5">
              <span className={`font-mono text-[11.5px] ${s.action === "ISOLATE_CONNECTOR" ? "text-[#e5b43c]" : "text-[#d5dbe5]"}`}>{s.action}</span>
              <span className="text-[11.5px] text-[#7d8896]">{s.resourceIds.length ? s.resourceIds.join(", ") : s.resourceClass}</span>
            </div>
          ))}
          <div className="flex items-center justify-between gap-3 py-0.5">
            <span className="font-mono text-[11.5px] text-[#ef5f6a]">CITIZEN_PII</span>
            <span className="text-[11.5px] text-[#ef5f6a]">excluded · Entity B veto</span>
          </div>
        </Block>
        <Block title="Record">
          <Mono k="lease" v={`${lease.id} v${lease.version}`} />
          <Mono k="status" v={lease.status} tone={TONE_TEXT[leaseTone]} />
          <Mono k="agent" v={lease.agentId} />
          <Mono k="mission" v={lease.missionId} />
          <Mono k="issuer" v={lease.issuerEntityId} />
          <Mono k="receiver" v={lease.receiverEntityId} />
          <Mono k="purpose" v={lease.purpose} />
          <Mono k="valid from" v={lease.validFrom} />
          <Mono k="expires" v={lease.expiresAt} />
          <Mono k="issuer approved" v={lease.issuerApprovedAt ?? "—"} />
          <Mono k="receiver accepted" v={lease.receiverAcceptedAt ?? "—"} />
          {lease.revokedAt && <Mono k="revoked" v={`${lease.revokedAt} · ${lease.revokedBy}`} tone="text-[#ef5f6a]" />}
        </Block>
        {proposal && (
          <Block title={`Proposal · ${proposal.source === "MODEL" ? "model-drafted" : "rule fallback"}`}>
            <Mono k="proposal" v={proposal.id} />
            <Mono k="source" v={proposal.sourceDetail} />
            <Mono k="duration" v={`${proposal.requestedMinutes}m requested → ${proposal.grantedMinutes}m ceiling`} />
            {proposal.terms.map((t, i) => (
              <Mono key={i} k={t.policyClause} v={`${t.scope.action} · ${!t.accepted ? "REJECTED" : t.gate === "HUMAN_GATED" ? "HUMAN-GATED" : "ALLOWED"}`} tone={!t.accepted ? "text-[#ef5f6a]" : t.gate === "HUMAN_GATED" ? "text-[#e5b43c]" : "text-[#3ecf8e]"} />
            ))}
            {proposal.exclusions.map((x, i) => (
              <Mono key={`x-${i}`} k={x.policyClause} v={`${x.resourceClass} · EXCLUDED`} tone="text-[#ef5f6a]" />
            ))}
          </Block>
        )}
      </>
    ) : (
      <>
        {head("Temporary authority", "No lease", "Agent 47 holds no authority on Entity B", "neutral")}
        <p className="mt-4 text-[12.5px] leading-relaxed text-[#aeb7c3]">Entity A cannot grant itself access to Entity B. A lease exists only after a bounded proposal, Entity A approval and Entity B acceptance — and the resolver re-checks it on every protected call.</p>
      </>
    );
  } else if (ref_.kind === "entity") {
    const entity = snapshot.entities.find((e) => e.id === ref_.id);
    const people = snapshot.principals.filter((p) => p.entityId === ref_.id);
    if (ref_.id === "entity-b") {
      body = (
        <>
          {head("Resource owner · separate trust domain", entity?.name ?? "Entity B", "Controls its resources regardless of Entity A approval", "neutral")}
          <Block title={`Policy ${policy.id} v${policy.version}`}>
            {policy.allowed.map((s) => (
              <Mono key={`a-${s.action}`} k="allowed" v={`${s.action} · ${s.resourceIds.length ? s.resourceIds.join(", ") : s.resourceClass}`} tone="text-[#3ecf8e]" />
            ))}
            {policy.humanGated.map((s) => (
              <Mono key={`g-${s.action}`} k="human-gated" v={`${s.action} · ${s.resourceIds.length ? s.resourceIds.join(", ") : s.resourceClass}`} tone="text-[#e5b43c]" />
            ))}
            {policy.deniedResourceClasses.map((c) => (
              <Mono key={`d-${c}`} k="denied class" v={c} tone="text-[#ef5f6a]" />
            ))}
            <Mono k="max lease" v={`${policy.maximumLeaseMinutes} min`} />
            <Mono k="accepts severity" v={policy.acceptedMissionSeverities.join(", ")} />
          </Block>
          <Block title="Protected resources">
            {snapshot.resources.map((r) => (
              <button key={r.id} type="button" onClick={() => onSelect({ kind: "resource", id: r.id })} className="flex w-full items-center justify-between gap-3 py-0.5 text-left hover:text-white">
                <span className="text-[12.5px] text-[#d5dbe5]">{r.displayName}</span>
                <span className="font-mono text-[11px] text-[#7d8896]">{r.resourceClass}</span>
              </button>
            ))}
          </Block>
          <Block title="Human approver">
            {people.map((p) => (
              <Mono key={p.id} k={p.role.toLowerCase().replace("_", " ")} v={`${p.name} · ${p.id}`} />
            ))}
          </Block>
          {snapshot.approvals.length > 0 && (
            <Block title="Exact approvals issued">
              {snapshot.approvals.map((a) => (
                <Mono key={a.id} k={a.id} v={a.consumedAt ? `consumed ${hhmmss(a.consumedAt)}` : new Date(a.expiresAt) < new Date(snapshot.serverTime) ? "expired" : `valid until ${hhmmss(a.expiresAt)}`} tone={a.consumedAt ? "text-[#7d8896]" : "text-[#3ecf8e]"} />
              ))}
            </Block>
          )}
        </>
      );
    } else {
      body = (
        <>
          {head("Requesting agency", entity?.name ?? "Entity A", mission.status === "DECLARED" ? "Incident 024 declared · mission authority only" : "No mission declared", mission.status === "DECLARED" ? "info" : "neutral")}
          <Block title="Principals">
            {people.map((p) => (
              <Mono key={p.id} k={p.role.toLowerCase().replace("_", " ")} v={`${p.name} · ${p.id}`} />
            ))}
            {snapshot.agents.map((a) => (
              <Mono key={a.id} k="agent" v={`${a.name} · ${a.id}`} />
            ))}
          </Block>
          <Block title="Authority">
            <p className="text-[12px] leading-relaxed text-[#aeb7c3]">Entity A can declare the mission and approve a lease proposal. It cannot grant itself access to Entity B: nothing is delegated until Entity B accepts under its own policy ceiling.</p>
          </Block>
          <Block title="Record">
            <Mono k="entity" v={entity?.id ?? "entity-a"} />
            <Mono k="policy" v={entity?.policyId ?? "—"} />
            <Mono k="active" v={entity ? String(entity.active) : "—"} />
          </Block>
        </>
      );
    }
  } else {
    const r = snapshot.resources.find((x) => x.id === ref_.id);
    const denied = snapshot.graph.edges.some((e) => e.kind === "POLICY_DENIED" && e.to === ref_.id);
    const auth = snapshot.graph.edges.filter((e) => e.kind === "ACTIVE_AUTHORITY" && e.to === ref_.id);
    const gated = auth.some((e) => e.gated);
    const isConnector = ref_.id === "connector-b-17";
    const isolated = isConnector && snapshot.connector.isolated;
    const state = denied ? "DENIED · Entity B veto" : isolated ? "ISOLATED" : gated ? "HUMAN-GATED · exact Entity B approval required" : auth.length ? "ACCESS GRANTED under active lease" : "NO ACCESS · no active authority";
    const tone: Tone = denied ? "deny" : isolated ? "isolated" : gated ? "stepup" : auth.length ? "allow" : "neutral";
    const clauses = [
      ...policy.allowed.filter((s) => (s.resourceIds.length ? s.resourceIds.includes(ref_.id) : s.resourceClass === r?.resourceClass)).map((s) => ({ action: s.action, gate: "ALLOWED" })),
      ...policy.humanGated.filter((s) => (s.resourceIds.length ? s.resourceIds.includes(ref_.id) : s.resourceClass === r?.resourceClass)).map((s) => ({ action: s.action, gate: "HUMAN-GATED" })),
    ];
    const history = decisionsFor(ref_.id);
    body = (
      <>
        {head("Protected resource", r?.displayName ?? ref_.id, state, tone)}
        <Block title="Entity B policy on this resource">
          {denied ? (
            <Mono k="denied class" v={`${r?.resourceClass} · never delegated`} tone="text-[#ef5f6a]" />
          ) : (
            clauses.map((c) => <Mono key={c.action} k={c.gate.toLowerCase()} v={c.action} tone={c.gate === "HUMAN-GATED" ? "text-[#e5b43c]" : "text-[#3ecf8e]"} />)
          )}
          {lease && !denied && <Mono k="in lease scope" v={String(lease.scopes.some((s) => (s.resourceIds.length ? s.resourceIds.includes(ref_.id) : s.resourceClass === r?.resourceClass)))} />}
        </Block>
        {isConnector && (
          <Block title="Connector state">
            <KV k="State" v={snapshot.connector.isolated ? "ISOLATED" : "ACTIVE"} tone={snapshot.connector.isolated ? "isolated" : "neutral"} />
            <Mono k="version" v={`v${snapshot.connector.version}`} />
            <Mono k="isolated at" v={snapshot.connector.isolatedAt ?? "—"} />
            <Mono k="by request" v={snapshot.connector.isolatedByRequestId ?? "—"} />
            {snapshot.pending && <Mono k="step-up" v={`${snapshot.pending.id} · ${snapshot.pending.status}`} tone={snapshot.pending.status === "PENDING" ? "text-[#e5b43c]" : undefined} />}
          </Block>
        )}
        <Block title="Record">
          <Mono k="resource" v={`${r?.id ?? ref_.id} v${r?.version ?? "?"}`} />
          <Mono k="class" v={r?.resourceClass ?? "—"} />
          <Mono k="owner" v={r?.ownerEntityId ?? "—"} />
          <Mono k="active" v={r ? String(r.active) : "—"} />
        </Block>
        <Block title={`Decisions · ${history.length}`}>
          {history.length === 0 && <p className="text-[12px] text-[#7d8896]">No protected call has targeted this resource yet.</p>}
          {history
            .slice(-6)
            .reverse()
            .map((d) => (
              <Mono key={d.id} k={hhmmss(d.decidedAt)} v={`${d.action} · HTTP ${d.httpStatus} · ${d.code}`} tone={TONE_TEXT[decisionToneOf(d.decision)]} />
            ))}
        </Block>
      </>
    );
  }

  return <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{body}</div>;
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
  return <div className="px-5 pt-3 pb-1 text-[11px] uppercase tracking-[0.14em] text-[#8a94a3]">{children}</div>;
}

function Label({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={`text-[11px] uppercase tracking-[0.14em] text-[#8a94a3] ${className ?? ""}`}>{children}</div>;
}

function ObjectRow({ label, type, state, tone, selected, onClick, indent }: { label: string; type: string; state: string; tone: Tone; selected: boolean; onClick: () => void; indent?: boolean }) {
  return (
    <li>
      <button type="button" onClick={onClick} className={`flex w-full items-center gap-3 px-2 py-[6px] text-left transition hover:bg-white/[0.04] ${selected ? "bg-white/[0.06]" : ""} ${indent ? "pl-5" : ""}`}>
        <span className={`h-2 w-2 shrink-0 ${TONE_RULE[tone]}`} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium text-[#e3e8ef]">{label}</span>
          <span className="block truncate text-[11px] text-[#5c6672]">{type}</span>
        </span>
        <span className={`shrink-0 text-[11px] font-semibold ${TONE_TEXT[tone]}`}>{state}</span>
      </button>
    </li>
  );
}

function Fact({ k, v, sub, tone }: { k: string; v: string; sub: string; tone?: Tone }) {
  return (
    <div className="min-w-[128px] px-5 py-1">
      <div className="text-[10.5px] uppercase tracking-[0.14em] text-[#7d8896]">{k}</div>
      <div className={`mt-0.5 text-[13.5px] font-semibold tracking-[0.04em] ${tone ? TONE_TEXT[tone] : "text-white"}`}>{v}</div>
      <div className="truncate text-[11px] text-[#7d8896]">{sub}</div>
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
      <div className="text-[10.5px] uppercase tracking-[0.14em] text-[#7d8896]">{k}</div>
      <div className={`break-words text-[13px] text-[#d5dbe5] ${mono ? "font-mono text-[12px]" : ""}`} title={v}>
        {v}
      </div>
    </div>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-4 border-t border-[#1f2630] pt-3">
      <div className="mb-1.5 text-[11px] uppercase tracking-[0.14em] text-[#8a94a3]">{title}</div>
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

function Console({ title, who, children }: { title: string; who?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2 px-5 py-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[12px] font-semibold text-[#c3cad4]">{title}</span>
        {who && <span className="truncate text-[11px] text-[#5c6672]">{who}</span>}
      </div>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

function Cmd({ children, onClick, disabled, busy, danger, primary }: { children: React.ReactNode; onClick: () => void; disabled?: boolean; busy: boolean; danger?: boolean; primary?: boolean }) {
  const base = "px-3 py-1.5 text-[12.5px] font-medium transition disabled:cursor-not-allowed disabled:opacity-30";
  const tone = primary
    ? "bg-[#3ecf8e]/15 text-[#d9f7ea] hover:bg-[#3ecf8e]/25"
    : danger
      ? "bg-[#ef5f6a]/10 text-[#ffd7da] hover:bg-[#ef5f6a]/20"
      : "bg-white/[0.06] text-[#e6ebf2] hover:bg-white/[0.12]";
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={`${base} ${tone}`}>
      {busy ? "…" : children}
    </button>
  );
}
