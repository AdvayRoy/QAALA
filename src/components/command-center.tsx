"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DemoRole } from "@/lib/domain/types";
import type { DemoStep, Snapshot } from "@/lib/snapshot";
import { api, type ApiResult, type LifecycleBody, type ProtectedBody } from "./api-client";
import { AuthorityGraphView } from "./authority-graph";

type Tokens = Record<DemoRole, string | null>;

interface SelectedAction {
  key: string;
  title: string;
  method: "GET" | "POST";
  path: string;
  role: DemoRole | "NONE";
  status: number;
  body: ProtectedBody | LifecycleBody | Record<string, unknown> | null;
  at: string;
}

const ROLE_LABEL: Record<DemoRole | "NONE", string> = {
  AGENT: "Agent 47 · Entity A",
  ISSUER_COMMANDER: "Commander · Entity A",
  RECEIVER_APPROVER: "Approver · Entity B",
  NONE: "unauthenticated",
};

const STEPS: { id: DemoStep; label: string; detail: string }[] = [
  { id: "NO_AUTHORITY", label: "No authority", detail: "Baseline. Every Entity B call is denied." },
  { id: "MISSION_DECLARED", label: "Incident 024 declared", detail: "Entity A commander declares the mission." },
  { id: "PROPOSED", label: "Lease proposed", detail: "Bounded proposal, validated against Policy B." },
  { id: "ISSUER_APPROVED", label: "Entity A approved", detail: "Issuer approval. Still no access." },
  { id: "ACTIVE", label: "Entity B accepted", detail: "Constrained lease active. Telemetry allowed." },
  { id: "STEP_UP_PENDING", label: "Isolation needs human", detail: "409 HUMAN_APPROVAL_REQUIRED." },
  { id: "STEP_UP_APPROVED", label: "Exact approval issued", detail: "One use, 10 minutes, bound to lease version." },
  { id: "ISOLATED", label: "B-17 isolated once", detail: "Approval consumed. Connector version bumped." },
  { id: "REVOKED", label: "Lease revoked", detail: "AUTHORITY_REVOKED on the same endpoint." },
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

function fmtTime(iso: string | null | undefined) {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${d.toISOString().slice(11, 19)}Z`;
}

function statusTone(status: number) {
  if (status === 200) return "bg-emerald-500/15 text-emerald-300 ring-emerald-500/40";
  if (status === 409) return "bg-amber-500/15 text-amber-300 ring-amber-500/40";
  if (status >= 400) return "bg-rose-500/15 text-rose-300 ring-rose-500/40";
  return "bg-slate-500/15 text-slate-300 ring-slate-500/40";
}

function isProtected(body: SelectedAction["body"]): body is ProtectedBody {
  return !!body && typeof body === "object" && "decision" in body && "receiptId" in body;
}

function isLifecycle(body: SelectedAction["body"]): body is LifecycleBody {
  return !!body && typeof body === "object" && "ok" in body && "message" in body;
}

export function CommandCenter() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [tokens, setTokens] = useState<Tokens>({ AGENT: null, ISSUER_COMMANDER: null, RECEIVER_APPROVER: null });
  const [selected, setSelected] = useState<SelectedAction | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [drawer, setDrawer] = useState(false);
  const [fault, setFault] = useState<string | null>(null);
  const lineageRef = useRef<HTMLDivElement | null>(null);

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
        setSelected({ key, title, method, path, role, status: res.status, body: res.body, at: new Date().toISOString() });
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

  const drawerHasWork = (lease?.status === "ISSUER_APPROVED") || pending?.status === "PENDING";
  const highlight = useMemo(() => {
    if (!selected) return null;
    if (selected.path.includes("security-telemetry")) return "telemetry-b";
    if (selected.path.includes("citizen-records")) return "citizen-records-b";
    if (selected.path.includes("connectors")) return "connector-b-17";
    if (selected.path.includes("mission")) return "mission-024";
    if (selected.path.includes("leases") || selected.path.includes("step-up")) return "lease";
    return null;
  }, [selected]);

  const onReset = () =>
    run("reset", "Reset demo state", "POST", "/api/demo/reset", "NONE", async () => {
      const res = await api.reset();
      setDrawer(false);
      return res;
    });

  const agentToken = tokens.AGENT;
  const commanderToken = tokens.ISSUER_COMMANDER;
  const approverToken = tokens.RECEIVER_APPROVER;
  const ready = !!agentToken && !!commanderToken && !!approverToken && !!snapshot;

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-[#070a10] text-slate-200">
      {/* Top bar */}
      <header className="flex h-14 shrink-0 items-center gap-4 border-b border-white/10 bg-[#0b0f16] px-5">
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-lg font-bold tracking-[0.35em] text-white">QALAA</span>
          <span className="hidden text-[10px] uppercase tracking-widest text-slate-500 lg:inline">cross-agency authority gate</span>
        </div>
        <span className="rounded-sm border border-amber-400/60 bg-amber-400/10 px-2 py-0.5 font-mono text-[10px] font-semibold tracking-[0.2em] text-amber-300">
          SYNTHETIC DEMO
        </span>
        <div className="mx-2 h-6 w-px bg-white/10" />
        <div className="flex items-center gap-3 font-mono text-xs">
          <span className="text-slate-400">INCIDENT</span>
          <span className="font-semibold text-white">{snapshot?.mission.incidentCode ?? "INC-024"}</span>
          <span className="rounded-sm bg-rose-500/20 px-1.5 py-0.5 text-[10px] font-bold tracking-widest text-rose-300 ring-1 ring-rose-500/40">
            HIGH
          </span>
          <span className="hidden text-slate-500 xl:inline">{snapshot?.mission.title ?? ""}</span>
        </div>
        <div className="ml-auto flex items-center gap-3 font-mono text-xs">
          <StatusPill step={step} />
          <span className="text-slate-500">server {snapshot ? fmtTime(snapshot.serverTime) : "—"}</span>
          <button
            type="button"
            onClick={() => setDrawer((d) => !d)}
            className={`relative rounded-sm border px-3 py-1 text-[11px] uppercase tracking-widest transition ${
              drawerHasWork ? "border-amber-400/60 bg-amber-400/10 text-amber-200" : "border-white/15 text-slate-300 hover:bg-white/5"
            }`}
          >
            Approvals
            {drawerHasWork && <span className="absolute -right-1 -top-1 h-2.5 w-2.5 animate-pulse rounded-full bg-amber-400" />}
          </button>
          <button
            type="button"
            onClick={onReset}
            disabled={!!busy}
            className="rounded-sm border border-white/15 px-3 py-1 text-[11px] uppercase tracking-widest text-slate-200 transition hover:bg-white/10 disabled:opacity-40"
          >
            {busy === "reset" ? "Resetting…" : "Reset"}
          </button>
        </div>
      </header>

      {fault && <div className="border-b border-rose-500/40 bg-rose-950/40 px-5 py-1 font-mono text-xs text-rose-300">{fault}</div>}

      {/* Main grid */}
      <div className="grid min-h-0 flex-1 grid-cols-[300px_minmax(0,1fr)_380px]">
        {/* Left rail: lifecycle */}
        <aside className="flex min-h-0 flex-col border-r border-white/10 bg-[#090d14]">
          <RailHeader>Authority lifecycle</RailHeader>
          <ol className="flex-1 overflow-y-auto px-4 py-3">
            {STEPS.map((s, i) => {
              const state = i < stepIdx ? "done" : i === stepIdx ? "current" : "todo";
              const terminal = s.id === "REVOKED" && (step === "REVOKED" || step === "EXPIRED");
              return (
                <li key={s.id} className="relative flex gap-3 pb-4 last:pb-0">
                  {i < STEPS.length - 1 && <span className={`absolute left-[7px] top-4 h-full w-px ${state === "done" ? "bg-emerald-500/50" : "bg-white/10"}`} />}
                  <span
                    className={`mt-0.5 h-[15px] w-[15px] shrink-0 rounded-full border-2 ${
                      terminal
                        ? "border-rose-400 bg-rose-400/30"
                        : state === "done"
                          ? "border-emerald-400 bg-emerald-400"
                          : state === "current"
                            ? "border-amber-300 bg-amber-300/20 shadow-[0_0_12px_rgba(252,211,77,0.6)]"
                            : "border-white/20 bg-transparent"
                    }`}
                  />
                  <div className="min-w-0">
                    <div className={`text-[12.5px] font-medium ${state === "todo" ? "text-slate-500" : "text-slate-100"}`}>{s.label}</div>
                    <div className="text-[11px] leading-snug text-slate-500">{s.detail}</div>
                  </div>
                </li>
              );
            })}
          </ol>
          <div className="border-t border-white/10 px-4 py-3 font-mono text-[11px]">
            <div className="mb-1 text-[10px] uppercase tracking-widest text-slate-500">Lease</div>
            {lease ? (
              <div className="space-y-0.5 text-slate-300">
                <Row k="id" v={lease.id} />
                <Row k="version" v={`v${lease.version}`} />
                <Row k="status" v={lease.status} tone={lease.status === "ACTIVE" ? "text-emerald-300" : lease.status === "REVOKED" || lease.status === "EXPIRED" ? "text-rose-300" : "text-slate-200"} />
                <Row k="issuer" v={lease.issuerApprovedBy ?? "—"} />
                <Row k="receiver" v={lease.receiverAcceptedBy ?? "—"} />
                <Row k="expires" v={fmtTime(lease.expiresAt)} />
                <Row k="scopes" v={lease.scopes.map((s) => s.action).join(", ")} />
              </div>
            ) : (
              <div className="text-slate-500">none · no cross-agency authority</div>
            )}
            {proposal && (
              <div className="mt-2 border-t border-white/10 pt-2">
                <div className="mb-1 text-[10px] uppercase tracking-widest text-slate-500">Proposal source</div>
                <span
                  className={`rounded-sm px-1.5 py-0.5 text-[10px] font-semibold tracking-wider ring-1 ${
                    proposal.source === "MODEL" ? "bg-violet-500/15 text-violet-200 ring-violet-500/40" : "bg-slate-500/15 text-slate-200 ring-slate-500/40"
                  }`}
                >
                  {proposal.source === "MODEL" ? "MODEL-PROPOSED" : "RULE FALLBACK"}
                </span>
                <div className="mt-1 text-[10.5px] leading-snug text-slate-500">{proposal.sourceDetail}</div>
              </div>
            )}
          </div>
        </aside>

        {/* Center: graph + controls */}
        <main className="flex min-h-0 flex-col">
          <div className="flex items-center justify-between border-b border-white/10 px-5 py-2">
            <span className="text-[10px] uppercase tracking-widest text-slate-500">Authority graph · derived from server state · fixed layout</span>
            <div className="flex items-center gap-3 font-mono text-[10px] text-slate-500">
              <Legend color="#34d399" label="active authority" />
              <Legend color="#60a5fa" label="issuer approved" />
              <Legend color="#a78bfa" label="proposed" dashed />
              <Legend color="#f87171" label="policy denied" dashed />
            </div>
          </div>
          <div className="min-h-0 flex-1 p-2">
            {snapshot ? <AuthorityGraphView graph={snapshot.graph} highlight={highlight} /> : <div className="p-6 font-mono text-xs text-slate-500">loading server state…</div>}
          </div>

          <div className="grid grid-cols-3 gap-px border-t border-white/10 bg-white/10">
            <ControlGroup title="Entity A · Commander" who={snapshot?.principals.find((p) => p.role === "ISSUER_COMMANDER")?.name}>
              <Btn
                busy={busy === "declare"}
                disabled={!ready || !!busy || snapshot?.mission.status === "DECLARED"}
                onClick={() => run("declare", "Declare Incident 024", "POST", "/api/mission/declare", "ISSUER_COMMANDER", (t) => api.declare(t!))}
              >
                Declare Incident 024
              </Btn>
              <Btn
                busy={busy === "propose"}
                disabled={!ready || !!busy || snapshot?.mission.status !== "DECLARED" || (!!lease && lease.status !== "REVOKED" && lease.status !== "EXPIRED")}
                onClick={() => run("propose", "Generate lease proposal", "POST", "/api/leases/propose", "ISSUER_COMMANDER", (t) => api.propose(t!))}
              >
                Generate proposal
              </Btn>
              <Btn
                busy={busy === "issuer"}
                disabled={!ready || !!busy || lease?.status !== "PROPOSED"}
                onClick={() => run("issuer", "Approve mission & lease (Entity A)", "POST", "/api/leases/issuer-approve", "ISSUER_COMMANDER", (t) => api.issuerApprove(t!))}
              >
                Approve mission &amp; lease
              </Btn>
            </ControlGroup>

            <ControlGroup title="Agent 47 · protected Entity B APIs" who="autonomous · entity-a" accent>
              <Btn busy={busy === "telemetry"} disabled={!ready || !!busy} onClick={() => run("telemetry", "Read security telemetry", "GET", "/api/entity-b/security-telemetry", "AGENT", api.telemetry)}>
                GET security-telemetry
              </Btn>
              <Btn busy={busy === "citizen"} disabled={!ready || !!busy} onClick={() => run("citizen", "Read citizen records", "GET", "/api/entity-b/citizen-records", "AGENT", api.citizenRecords)}>
                GET citizen-records
              </Btn>
              <Btn busy={busy === "inspect"} disabled={!ready || !!busy} onClick={() => run("inspect", "Inspect connector B-17", "GET", "/api/entity-b/connectors/b-17", "AGENT", api.inspectConnector)}>
                GET connectors/b-17
              </Btn>
              <Btn
                busy={busy === "isolate"}
                disabled={!ready || !!busy}
                danger
                onClick={() => run("isolate", "Isolate connector B-17", "POST", "/api/entity-b/connectors/b-17/isolate", "AGENT", api.isolateConnector)}
              >
                POST connectors/b-17/isolate
              </Btn>
            </ControlGroup>

            <ControlGroup title="Entity B · Approver" who={snapshot?.principals.find((p) => p.role === "RECEIVER_APPROVER")?.name}>
              <Btn
                busy={false}
                disabled={!ready || !!busy || lease?.status !== "ISSUER_APPROVED"}
                onClick={() => setDrawer(true)}
              >
                Review proposal…
              </Btn>
              <Btn busy={false} disabled={!ready || !!busy || pending?.status !== "PENDING"} onClick={() => setDrawer(true)}>
                Review step-up…
              </Btn>
              <Btn
                busy={busy === "revoke"}
                danger
                disabled={!ready || !!busy || !lease || lease.status === "REVOKED" || lease.status === "EXPIRED"}
                onClick={() => run("revoke", "Revoke lease (Entity B)", "POST", "/api/leases/revoke", "RECEIVER_APPROVER", (t) => api.revoke(t!))}
              >
                Revoke lease
              </Btn>
            </ControlGroup>
          </div>
        </main>

        {/* Right rail: selected action */}
        <aside className="flex min-h-0 flex-col border-l border-white/10 bg-[#090d14]">
          <RailHeader>Selected action</RailHeader>
          {selected ? (
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 font-mono text-[11.5px]">
              <div className="text-[13px] font-semibold text-slate-100">{selected.title}</div>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <span className={`rounded-sm px-2 py-0.5 text-[11px] font-bold ring-1 ${statusTone(selected.status)}`}>HTTP {selected.status}</span>
                <span className="text-slate-400">
                  {selected.method} {selected.path}
                </span>
              </div>
              <div className="mt-1 text-slate-500">
                as {ROLE_LABEL[selected.role]} · {fmtTime(selected.at)}
              </div>

              {isProtected(selected.body) && (
                <>
                  <Section title="Result">
                    <div
                      className={`text-[13px] font-bold ${
                        selected.body.decision === "ALLOW" ? "text-emerald-300" : selected.body.decision === "HUMAN_APPROVAL_REQUIRED" ? "text-amber-300" : "text-rose-300"
                      }`}
                    >
                      {selected.body.decision}
                      {selected.body.code !== selected.body.decision && ` · ${selected.body.code}`}
                    </div>
                    <div className="mt-1 leading-snug text-slate-300">{selected.body.reason}</div>
                    {selected.body.pendingRequestId && (
                      <button type="button" onClick={() => setDrawer(true)} className="mt-2 rounded-sm border border-amber-400/50 bg-amber-400/10 px-2 py-1 text-[10.5px] uppercase tracking-widest text-amber-200">
                        Open approval drawer · {selected.body.pendingRequestId}
                      </button>
                    )}
                  </Section>
                  <Section title="Authority path">
                    <ol className="space-y-1">
                      {selected.body.authorityPath.map((c, i) => (
                        <li key={i} className="flex gap-2">
                          <span className={c.passed ? "text-emerald-400" : "text-rose-400"}>{c.passed ? "✓" : "✕"}</span>
                          <span className={c.passed ? "text-slate-300" : "text-rose-200"}>{c.check}</span>
                        </li>
                      ))}
                    </ol>
                  </Section>
                  <Section title="Decision receipt">
                    <Row k="receiptId" v={selected.body.receiptId} tone="text-amber-200" />
                    <Row k="decision" v={selected.body.decision} />
                    <Row k="http" v={String(selected.status)} />
                    <Row k="server-side" v="persisted" />
                  </Section>
                  {selected.body.data !== undefined && (
                    <Section title="Data (server response)">
                      <pre className="max-h-56 overflow-auto rounded-sm bg-black/40 p-2 text-[10.5px] leading-snug text-emerald-100/90">{JSON.stringify(selected.body.data, null, 2)}</pre>
                    </Section>
                  )}
                </>
              )}

              {isLifecycle(selected.body) && (
                <>
                  <Section title="Result">
                    <div className={`text-[13px] font-bold ${selected.body.ok ? "text-emerald-300" : "text-rose-300"}`}>
                      {selected.body.ok ? "OK" : "REJECTED"} · {selected.body.code}
                    </div>
                    <div className="mt-1 leading-snug text-slate-300">{selected.body.message}</div>
                  </Section>
                  {selected.body.data !== undefined && (
                    <Section title="Server record">
                      <pre className="max-h-72 overflow-auto rounded-sm bg-black/40 p-2 text-[10.5px] leading-snug text-slate-300">{JSON.stringify(selected.body.data, null, 2)}</pre>
                    </Section>
                  )}
                </>
              )}
            </div>
          ) : (
            <div className="px-4 py-6 font-mono text-xs leading-relaxed text-slate-500">
              No action selected. Start from <span className="text-slate-300">RESET</span>, then call a protected Entity B endpoint as Agent 47. Every response carries a server-generated receipt.
            </div>
          )}
          <div className="border-t border-white/10 px-4 py-2 font-mono text-[10.5px] text-slate-500">
            <div className="flex justify-between">
              <span>connector b-17</span>
              <span className={connector?.isolated ? "text-orange-300" : "text-slate-300"}>{connector ? (connector.isolated ? `ISOLATED · v${connector.version}` : `online · v${connector.version}`) : "—"}</span>
            </div>
            <div className="flex justify-between">
              <span>policy b</span>
              <span className="text-slate-300">{snapshot ? `${snapshot.policyB.id} v${snapshot.policyB.version} · max ${snapshot.policyB.maximumLeaseMinutes}m` : "—"}</span>
            </div>
          </div>
        </aside>
      </div>

      {/* Bottom: decision lineage */}
      <footer className="h-44 shrink-0 border-t border-white/10 bg-[#0b0f16]">
        <div className="flex items-center justify-between px-5 py-1.5">
          <span className="text-[10px] uppercase tracking-widest text-slate-500">Decision lineage · chronological · server events</span>
          <span className="font-mono text-[10px] text-slate-500">{snapshot?.events.length ?? 0} events · {snapshot?.decisions.length ?? 0} receipts</span>
        </div>
        <div ref={lineageRef} className="h-[calc(100%-28px)] overflow-y-auto px-5 pb-2 font-mono text-[11px]">
          <table className="w-full border-separate border-spacing-0">
            <tbody>
              {(snapshot?.events ?? []).map((e) => {
                const receipt = e.receiptId ? snapshot?.decisions.find((d) => d.id === e.receiptId) : null;
                const tone =
                  e.kind === "DECISION"
                    ? receipt?.decision === "ALLOW"
                      ? "text-emerald-300"
                      : receipt?.decision === "HUMAN_APPROVAL_REQUIRED"
                        ? "text-amber-300"
                        : "text-rose-300"
                    : e.kind === "LEASE_REVOKED"
                      ? "text-rose-300"
                      : e.kind === "RESET"
                        ? "text-slate-400"
                        : "text-sky-300";
                return (
                  <tr key={e.id} className="border-b border-white/5 hover:bg-white/[0.03]">
                    <td className="w-10 py-0.5 pr-3 text-slate-600">{String(e.seq).padStart(3, "0")}</td>
                    <td className="w-20 py-0.5 pr-3 text-slate-500">{fmtTime(e.at)}</td>
                    <td className={`w-44 py-0.5 pr-3 font-semibold ${tone}`}>{e.kind === "DECISION" && receipt ? `${receipt.decision} ${receipt.httpStatus}` : e.kind}</td>
                    <td className="py-0.5 pr-3 text-slate-300">{e.summary}</td>
                    <td className="w-36 py-0.5 pr-3 text-slate-500">{e.leaseId ? `${e.leaseId} v${e.leaseVersion ?? "?"}` : ""}</td>
                    <td className="w-32 py-0.5 text-right text-amber-200/80">{e.receiptId ?? ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </footer>

      {/* Approval drawer */}
      <div className={`fixed inset-y-0 right-0 z-30 flex w-[440px] transform flex-col border-l border-amber-400/30 bg-[#0d1119] shadow-2xl transition-transform duration-300 ${drawer ? "translate-x-0" : "translate-x-full"}`}>
        <div className="flex h-14 items-center justify-between border-b border-white/10 px-5">
          <div>
            <div className="text-[10px] uppercase tracking-widest text-amber-300">Entity B approval desk</div>
            <div className="text-sm font-semibold text-slate-100">{snapshot?.principals.find((p) => p.role === "RECEIVER_APPROVER")?.name ?? "Approver"}</div>
          </div>
          <button type="button" onClick={() => setDrawer(false)} className="rounded-sm border border-white/15 px-2 py-1 text-[11px] uppercase tracking-widest text-slate-300 hover:bg-white/5">
            Close
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 font-mono text-[11.5px]">
          {lease?.status === "ISSUER_APPROVED" && proposal && (
            <DrawerCard title="Lease proposal awaiting Entity B acceptance" tone="blue">
              <Row k="lease" v={`${lease.id} v${lease.version}`} />
              <Row k="agent" v={lease.agentId} />
              <Row k="mission" v={lease.missionId} />
              <Row k="purpose" v={lease.purpose} />
              <Row k="issuer" v={`${lease.issuerEntityId} · ${lease.issuerApprovedBy}`} />
              <Row k="requested" v={`${proposal.requestedMinutes}m`} />
              <Row k="ceiling" v={`${proposal.grantedMinutes}m (policy B-4.2)`} />
              <Row k="source" v={proposal.source === "MODEL" ? "MODEL-PROPOSED" : "RULE FALLBACK"} />
              <div className="mt-3 text-[10px] uppercase tracking-widest text-slate-500">Terms vs Policy B</div>
              <ul className="mt-1 space-y-1">
                {proposal.terms.map((t, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className={t.accepted ? (t.gate === "HUMAN_GATED" ? "text-amber-300" : "text-emerald-300") : "text-rose-300"}>{t.accepted ? (t.gate === "HUMAN_GATED" ? "◐" : "●") : "✕"}</span>
                    <span className="text-slate-200">
                      {t.scope.action} <span className="text-slate-500">on</span> {t.scope.resourceIds.length ? t.scope.resourceIds.join(",") : `class ${t.scope.resourceClass}`}{" "}
                      <span className="text-slate-500">· {t.policyClause}</span>
                      {t.gate === "HUMAN_GATED" && t.accepted && <span className="text-amber-300"> · human-gated</span>}
                      {t.rejectionReason && <span className="text-rose-300"> · {t.rejectionReason}</span>}
                    </span>
                  </li>
                ))}
                {proposal.exclusions.map((x, i) => (
                  <li key={`x-${i}`} className="flex items-start gap-2 text-rose-300">
                    <span>⊘</span>
                    <span>
                      {x.resourceClass} excluded <span className="text-slate-500">· {x.policyClause}</span>
                    </span>
                  </li>
                ))}
              </ul>
              <div className="mt-4 flex gap-2">
                <Btn
                  busy={busy === "accept"}
                  disabled={!!busy}
                  primary
                  onClick={() => run("accept", "Accept constrained lease (Entity B)", "POST", "/api/leases/receiver-accept", "RECEIVER_APPROVER", (t) => api.receiverAccept(t!))}
                >
                  Accept constrained lease
                </Btn>
                <Btn
                  busy={busy === "reject"}
                  disabled={!!busy}
                  danger
                  onClick={() => run("reject", "Reject lease (Entity B)", "POST", "/api/leases/receiver-reject", "RECEIVER_APPROVER", (t) => api.receiverReject(t!))}
                >
                  Reject
                </Btn>
              </div>
            </DrawerCard>
          )}

          {pending && pending.status === "PENDING" && (
            <DrawerCard title="Human step-up requested" tone="amber">
              <Row k="request" v={pending.id} />
              <Row k="receipt" v={pending.receiptId} tone="text-amber-200" />
              <Row k="action" v={pending.action} tone="text-orange-200" />
              <Row k="resource" v={pending.resourceId} />
              <Row k="lease" v={`${pending.leaseId} v${pending.leaseVersion}`} />
              <Row k="mission" v={pending.missionId} />
              <Row k="actor" v={pending.actorId} />
              <Row k="requested" v={fmtTime(pending.requestedAt)} />
              <p className="mt-3 leading-snug text-slate-400">
                Approval is bound to exactly this lease version, mission, agent, action and resource. It is single-use and expires in 10 minutes server time.
              </p>
              <div className="mt-4">
                <Btn
                  busy={busy === "stepup"}
                  disabled={!!busy}
                  primary
                  onClick={() => run("stepup", "Issue exact isolation approval (Entity B)", "POST", "/api/step-up/approve", "RECEIVER_APPROVER", (t) => api.approveStepUp(t!, pending.id))}
                >
                  Issue exact one-use approval
                </Btn>
              </div>
            </DrawerCard>
          )}

          {pending && pending.status === "APPROVED" && (
            <DrawerCard title="Exact approval issued · not yet consumed" tone="green">
              <Row k="request" v={pending.id} />
              <Row k="approval" v={pending.approvalId ?? "—"} />
              <Row k="lease" v={`${pending.leaseId} v${pending.leaseVersion}`} />
              <Row k="expires" v={fmtTime(snapshot?.approvals.find((a) => a.id === pending.approvalId)?.expiresAt)} />
              <p className="mt-3 leading-snug text-slate-400">Agent 47 must now re-issue POST /connectors/b-17/isolate. The resolver rechecks everything, consumes the approval, and mutates the connector once.</p>
            </DrawerCard>
          )}

          {!drawerHasWork && pending?.status !== "APPROVED" && (
            <div className="rounded-sm border border-white/10 bg-white/[0.02] p-4 text-slate-500">
              Nothing awaiting Entity B.{" "}
              {lease?.status === "ACTIVE"
                ? "Lease is active; revoke from the console."
                : lease?.status === "PROPOSED"
                  ? "Waiting for Entity A issuer approval first."
                  : lease?.status === "REVOKED" || lease?.status === "EXPIRED"
                    ? `Lease ${lease.id} is ${lease.status.toLowerCase()}; Agent 47 holds no authority. Reset or generate a new proposal.`
                    : "Declare the incident and generate a proposal first."}
            </div>
          )}

          {(snapshot?.approvals.length ?? 0) > 0 && (
            <div className="mt-5">
              <div className="text-[10px] uppercase tracking-widest text-slate-500">Approval ledger</div>
              <ul className="mt-1 space-y-1">
                {snapshot!.approvals.map((a) => (
                  <li key={a.id} className="flex justify-between text-slate-400">
                    <span>
                      {a.id} · {a.leaseId} v{a.leaseVersion}
                    </span>
                    <span className={a.consumedAt ? "text-slate-500" : new Date(a.expiresAt) < new Date(snapshot!.serverTime) ? "text-rose-300" : "text-emerald-300"}>
                      {a.consumedAt ? `consumed ${fmtTime(a.consumedAt)}` : new Date(a.expiresAt) < new Date(snapshot!.serverTime) ? "expired" : `valid until ${fmtTime(a.expiresAt)}`}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
      {drawer && <button type="button" aria-label="Close drawer" onClick={() => setDrawer(false)} className="fixed inset-0 z-20 bg-black/40" />}
    </div>
  );
}

function StatusPill({ step }: { step: DemoStep }) {
  const map: Record<DemoStep, { label: string; cls: string }> = {
    NO_AUTHORITY: { label: "NO AUTHORITY", cls: "bg-slate-500/15 text-slate-300 ring-slate-500/40" },
    MISSION_DECLARED: { label: "MISSION DECLARED", cls: "bg-rose-500/15 text-rose-200 ring-rose-500/40" },
    PROPOSED: { label: "LEASE PROPOSED", cls: "bg-violet-500/15 text-violet-200 ring-violet-500/40" },
    ISSUER_APPROVED: { label: "AWAITING ENTITY B", cls: "bg-sky-500/15 text-sky-200 ring-sky-500/40" },
    ACTIVE: { label: "LEASE ACTIVE", cls: "bg-emerald-500/15 text-emerald-200 ring-emerald-500/40" },
    STEP_UP_PENDING: { label: "HUMAN APPROVAL REQUIRED", cls: "bg-amber-500/15 text-amber-200 ring-amber-500/40" },
    STEP_UP_APPROVED: { label: "APPROVAL ARMED", cls: "bg-amber-500/15 text-amber-200 ring-amber-500/40" },
    ISOLATED: { label: "B-17 ISOLATED", cls: "bg-orange-500/15 text-orange-200 ring-orange-500/40" },
    REVOKED: { label: "AUTHORITY REVOKED", cls: "bg-rose-500/15 text-rose-200 ring-rose-500/40" },
    EXPIRED: { label: "AUTHORITY EXPIRED", cls: "bg-rose-500/15 text-rose-200 ring-rose-500/40" },
  };
  const m = map[step];
  return <span className={`rounded-sm px-2 py-0.5 text-[10px] font-bold tracking-widest ring-1 ${m.cls}`}>{m.label}</span>;
}

function RailHeader({ children }: { children: React.ReactNode }) {
  return <div className="border-b border-white/10 px-4 py-2 text-[10px] uppercase tracking-widest text-slate-500">{children}</div>;
}

function Row({ k, v, tone }: { k: string; v: string; tone?: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="shrink-0 text-slate-500">{k}</span>
      <span className={`truncate text-right ${tone ?? "text-slate-200"}`} title={v}>
        {v}
      </span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-4 border-t border-white/10 pt-3">
      <div className="mb-1.5 text-[10px] uppercase tracking-widest text-slate-500">{title}</div>
      {children}
    </div>
  );
}

function DrawerCard({ title, tone, children }: { title: string; tone: "blue" | "amber" | "green"; children: React.ReactNode }) {
  const cls =
    tone === "amber"
      ? "border-amber-400/40 bg-amber-400/[0.04]"
      : tone === "green"
        ? "border-emerald-400/40 bg-emerald-400/[0.04]"
        : "border-sky-400/40 bg-sky-400/[0.04]";
  const titleCls = tone === "amber" ? "text-amber-200" : tone === "green" ? "text-emerald-200" : "text-sky-200";
  return (
    <div className={`mb-4 rounded-sm border p-4 ${cls}`}>
      <div className={`mb-2 text-[10px] uppercase tracking-widest ${titleCls}`}>{title}</div>
      {children}
    </div>
  );
}

function Legend({ color, label, dashed }: { color: string; label: string; dashed?: boolean }) {
  return (
    <span className="flex items-center gap-1.5">
      <svg width="18" height="6">
        <line x1="0" y1="3" x2="18" y2="3" stroke={color} strokeWidth="2" strokeDasharray={dashed ? "3 3" : undefined} />
      </svg>
      {label}
    </span>
  );
}

function ControlGroup({ title, who, children, accent }: { title: string; who?: string; children: React.ReactNode; accent?: boolean }) {
  return (
    <div className={`flex flex-col gap-1.5 p-3 ${accent ? "bg-[#0c1119]" : "bg-[#090d14]"}`}>
      <div className="flex items-baseline justify-between">
        <span className="text-[10px] uppercase tracking-widest text-slate-400">{title}</span>
        {who && <span className="truncate font-mono text-[9.5px] text-slate-600">{who}</span>}
      </div>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

function Btn({
  children,
  onClick,
  disabled,
  busy,
  danger,
  primary,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  busy: boolean;
  danger?: boolean;
  primary?: boolean;
}) {
  const base = "rounded-sm border px-2.5 py-1 font-mono text-[11px] transition disabled:cursor-not-allowed disabled:opacity-35";
  const tone = primary
    ? "border-emerald-400/60 bg-emerald-400/10 text-emerald-100 hover:bg-emerald-400/20"
    : danger
      ? "border-rose-400/50 bg-rose-400/5 text-rose-100 hover:bg-rose-400/15"
      : "border-white/15 bg-white/[0.03] text-slate-100 hover:bg-white/10";
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={`${base} ${tone}`}>
      {busy ? "…" : children}
    </button>
  );
}
