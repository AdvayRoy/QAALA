"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { DemoRole } from "@/lib/domain/types";
import type { Snapshot } from "@/lib/snapshot";
import { api, type ApiResult, type LifecycleBody, type ProtectedBody } from "./api-client";
import type { ObjectRef } from "./evidence";

export type Selection =
  | { kind: "receipt"; id: string }
  | { kind: "event"; id: string }
  | { kind: "object"; ref: ObjectRef }
  | { kind: "response"; title: string; status: number; body: LifecycleBody };

type Tokens = Record<DemoRole, string | null>;
const emptyTokens: Tokens = { AGENT: null, ISSUER_COMMANDER: null, RECEIVER_APPROVER: null };

/** Only presentation state lives here. Every operational update is a server snapshot. */
export function useCommandCenter() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [connection, setConnection] = useState<"loading" | "live" | "stale">("loading");
  const [fault, setFault] = useState<string | null>(null);
  const [sessionsReady, setSessionsReady] = useState(false);
  const [deskOpen, setDeskOpen] = useState(false);
  const tokens = useRef<Tokens>(emptyTokens);
  const locked = useRef(false);
  const readVersion = useRef(0);
  const readPending = useRef(false);
  const mounted = useRef(false);

  const refresh = useCallback(async () => {
    const version = ++readVersion.current;
    readPending.current = true;
    try {
      const result = await api.state();
      if (result.status !== 200 || !result.body?.graph || !result.body?.serverTime) throw new Error("Unable to reconcile server state.");
      if (mounted.current && version === readVersion.current) {
        setSnapshot(result.body);
        setConnection("live");
      }
      return result.body;
    } catch (error) {
      if (mounted.current && version === readVersion.current) setConnection("stale");
      throw error;
    } finally {
      if (version === readVersion.current) readPending.current = false;
    }
  }, []);

  const connect = useCallback(async () => {
    try {
      const roles: DemoRole[] = ["AGENT", "ISSUER_COMMANDER", "RECEIVER_APPROVER"];
      // Role-specific headers, never the last session cookie, determine who acts.
      const sessions = await Promise.all(roles.map(async (role) => {
        const result = await api.session(role);
        if (result.status !== 200 || !result.body.token) throw new Error(`Could not establish ${role} session.`);
        return [role, result.body.token] as const;
      }));
      if (!mounted.current) return;
      tokens.current = Object.fromEntries(sessions) as Tokens;
      setSessionsReady(true);
      setFault(null);
      await refresh();
    } catch (error) {
      if (mounted.current) {
        setConnection("stale");
        setFault(error instanceof Error ? error.message : "Connection failed.");
      }
    }
  }, [refresh]);

  useEffect(() => {
    mounted.current = true;
    const reads = readVersion;
    let cancelled = false;
    queueMicrotask(() => { if (!cancelled) void connect(); });
    const reconcile = () => {
      if (!locked.current && !readPending.current && document.visibilityState === "visible") void refresh().catch(() => {});
    };
    const interval = window.setInterval(reconcile, 2000);
    window.addEventListener("focus", reconcile);
    window.addEventListener("online", reconcile);
    document.addEventListener("visibilitychange", reconcile);
    return () => {
      mounted.current = false;
      cancelled = true;
      reads.current++;
      window.clearInterval(interval);
      window.removeEventListener("focus", reconcile);
      window.removeEventListener("online", reconcile);
      document.removeEventListener("visibilitychange", reconcile);
    };
  }, [connect, refresh]);

  const run = useCallback(async (
    key: string,
    title: string,
    role: DemoRole | null,
    operation: (token: string) => Promise<ApiResult<ProtectedBody | LifecycleBody>>,
  ) => {
    if (locked.current || connection !== "live" || (role && !tokens.current[role])) return;
    locked.current = true;
    ++readVersion.current; // Invalidate reads started before this mutation.
    setBusy(key);
    setFault(null);
    try {
      const result = await operation(role ? tokens.current[role]! : "");
      await refresh();
      if ("receiptId" in result.body) {
        setSelection({ kind: "receipt", id: result.body.receiptId });
      } else if (key === "reset" && result.body.ok) {
        setSelection(null);
        setDeskOpen(false);
      } else {
        setSelection({ kind: "response", title, status: result.status, body: result.body });
        if (result.body.ok && ["accept", "reject", "stepup"].includes(key)) setDeskOpen(false);
      }
    } catch (error) {
      setFault(`${error instanceof Error ? error.message : "Request interrupted."} Checking the server before any retry.`);
      await refresh().catch(() => {});
    } finally {
      locked.current = false;
      setBusy(null);
    }
  }, [connection, refresh]);

  return { snapshot, selection, setSelection, busy, connection, fault, deskOpen, setDeskOpen,
    ready: sessionsReady && connection === "live" && !!snapshot && !busy, run, reconnect: connect };
}
