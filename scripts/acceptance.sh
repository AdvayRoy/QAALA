#!/usr/bin/env bash
# Direct-API acceptance gate for QALAA. Runs against a live server (default
# http://localhost:3000) and prints the real HTTP status + decision code for
# every step of the presentation flow. Exits non-zero on the first mismatch.
set -euo pipefail

BASE="${QALAA_BASE_URL:-http://localhost:3000}"
H="x-qalaa-demo-session"

session() { curl -s -X POST "$BASE/api/demo/session" -H 'content-type: application/json' -d "{\"role\":\"$1\"}" | sed -E 's/.*"token":"([^"]+)".*/\1/'; }
code_of() { sed -E 's/.*"code":"([^"]+)".*/\1/' <<<"$1"; }

# $1 label, $2 expected status, $3 expected code (or -), then curl args
check() {
  local label="$1" want_status="$2" want_code="$3"; shift 3
  local out status body code
  out=$(curl -s -w $'\n%{http_code}' "$@")
  status=$(tail -n1 <<<"$out")
  body=$(sed '$d' <<<"$out")
  code=$(code_of "$body")
  local receipt; receipt=$(sed -nE 's/.*"receiptId":"([^"]+)".*/\1/p' <<<"$body")
  printf '%-48s HTTP %s  %-26s %s\n' "$label" "$status" "$code" "${receipt:+receipt=$receipt}"
  if [[ "$status" != "$want_status" ]]; then echo "  FAIL: expected HTTP $want_status"; echo "  $body"; exit 1; fi
  if [[ "$want_code" != "-" && "$code" != "$want_code" ]]; then echo "  FAIL: expected code $want_code"; echo "  $body"; exit 1; fi
  LAST_BODY="$body"
}

echo "QALAA acceptance gate against $BASE"
echo "----------------------------------------------------------------------------------------"
AGENT=$(session AGENT)
CMDR=$(session ISSUER_COMMANDER)
APPR=$(session RECEIVER_APPROVER)

check "RESET"                                   200 RESET                    -X POST "$BASE/api/demo/reset"
check "no authority: telemetry"                 403 MISSION_NOT_DECLARED     "$BASE/api/entity-b/security-telemetry" -H "$H: $AGENT"
check "declare Incident 024 (Entity A cmdr)"    200 MISSION_DECLARED         -X POST "$BASE/api/mission/declare" -H "$H: $CMDR"
check "telemetry, mission but no lease"         403 NO_ACTIVE_LEASE          "$BASE/api/entity-b/security-telemetry" -H "$H: $AGENT"
check "generate proposal (Entity A cmdr)"       200 PROPOSAL_CREATED         -X POST "$BASE/api/leases/propose" -H "$H: $CMDR"
grep -o '"source":"[A-Z_]*"' <<<"$LAST_BODY" | head -1 | sed 's/^/  proposal /'
check "telemetry, lease PROPOSED"               403 NO_ACTIVE_LEASE          "$BASE/api/entity-b/security-telemetry" -H "$H: $AGENT"
check "Entity A approves mission+lease"         200 LEASE_ISSUER_APPROVED    -X POST "$BASE/api/leases/issuer-approve" -H "$H: $CMDR"
check "telemetry, A approved / B not accepted"  403 RECEIVER_NOT_ACCEPTED    "$BASE/api/entity-b/security-telemetry" -H "$H: $AGENT"
check "Entity A cannot accept for Entity B"     403 ROLE_NOT_PERMITTED         -X POST "$BASE/api/leases/receiver-accept" -H "$H: $CMDR"
check "Entity B accepts constrained lease"      200 LEASE_ACCEPTED           -X POST "$BASE/api/leases/receiver-accept" -H "$H: $APPR"
check "telemetry, ACTIVE lease"                 200 ALLOW                    "$BASE/api/entity-b/security-telemetry" -H "$H: $AGENT"
check "citizen records, ACTIVE lease"           403 RESOURCE_CLASS_DENIED    "$BASE/api/entity-b/citizen-records" -H "$H: $AGENT"
check "inspect connector B-17"                  200 ALLOW                    "$BASE/api/entity-b/connectors/b-17" -H "$H: $AGENT"
check "isolate B-17 without approval"           409 HUMAN_APPROVAL_REQUIRED  -X POST "$BASE/api/entity-b/connectors/b-17/isolate" -H "$H: $AGENT"
PENDING=$(sed -nE 's/.*"pendingRequestId":"([^"]+)".*/\1/p' <<<"$LAST_BODY")
echo "  pendingRequestId=$PENDING"
check "isolate again, still no approval"        409 HUMAN_APPROVAL_REQUIRED  -X POST "$BASE/api/entity-b/connectors/b-17/isolate" -H "$H: $AGENT"
check "Entity A cannot approve step-up"         403 ROLE_NOT_PERMITTED         -X POST "$BASE/api/step-up/approve" -H "$H: $CMDR" -H 'content-type: application/json' -d "{\"pendingRequestId\":\"$PENDING\"}"
check "Entity B issues exact approval"          200 STEP_UP_APPROVED         -X POST "$BASE/api/step-up/approve" -H "$H: $APPR" -H 'content-type: application/json' -d "{\"pendingRequestId\":\"$PENDING\"}"
BEFORE=$(curl -s "$BASE/api/demo/state" | grep -o '"connector":{[^}]*}')
echo "  connector before: $BEFORE"
check "isolate B-17 with exact approval"        200 ALLOW                    -X POST "$BASE/api/entity-b/connectors/b-17/isolate" -H "$H: $AGENT"
AFTER=$(curl -s "$BASE/api/demo/state" | grep -o '"connector":{[^}]*}')
echo "  connector after:  $AFTER"
check "isolate B-17 again (approval consumed)"  409 HUMAN_APPROVAL_REQUIRED  -X POST "$BASE/api/entity-b/connectors/b-17/isolate" -H "$H: $AGENT"
AGAIN=$(curl -s "$BASE/api/demo/state" | grep -o '"connector":{[^}]*}')
[[ "$AFTER" == "$AGAIN" ]] && echo "  connector unchanged by second call (mutated exactly once)" || { echo "  FAIL: connector changed twice"; exit 1; }
check "citizen records, still denied"           403 RESOURCE_CLASS_DENIED    "$BASE/api/entity-b/citizen-records" -H "$H: $AGENT"
check "Entity B revokes lease"                  200 LEASE_REVOKED            -X POST "$BASE/api/leases/revoke" -H "$H: $APPR"
check "telemetry after revoke"                  403 AUTHORITY_REVOKED        "$BASE/api/entity-b/security-telemetry" -H "$H: $AGENT"
check "stale leaseId cannot bypass revoke"      403 AUTHORITY_REVOKED        "$BASE/api/entity-b/security-telemetry?leaseId=lease-024-1" -H "$H: $AGENT"
check "isolate after revoke"                    403 AUTHORITY_REVOKED        -X POST "$BASE/api/entity-b/connectors/b-17/isolate" -H "$H: $AGENT"
EDGES=$(curl -s "$BASE/api/demo/state" | { grep -o '"kind":"ACTIVE_AUTHORITY"' || true; } | wc -l | tr -d ' ')
echo "  ACTIVE_AUTHORITY edges in graph after revoke: $EDGES"
[[ "$EDGES" == "0" ]] || { echo "  FAIL: active edges remain"; exit 1; }
check "RESET restores state"                    200 RESET                    -X POST "$BASE/api/demo/reset"
check "after reset: telemetry denied again"     403 MISSION_NOT_DECLARED     "$BASE/api/entity-b/security-telemetry" -H "$H: $AGENT"
echo "----------------------------------------------------------------------------------------"
echo "ACCEPTANCE GATE PASSED"
