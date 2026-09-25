import type { ProposalGenerator } from "./proposal";

const TIMEOUT_MS = 8000;

/**
 * At most one bounded model call per proposal generation. Returns the raw
 * parsed JSON (validated by the caller) or null on absence, timeout, HTTP
 * error or unparseable output. Never throws; never grants anything.
 *
 * Configuration (never printed or committed):
 *   QALAA_MODEL_API_KEY   bearer token for an OpenAI-compatible chat endpoint
 *   QALAA_MODEL_BASE_URL  default https://api.openai.com/v1
 *   QALAA_MODEL_NAME      default gpt-4o-mini
 */
export function configuredGenerator(): ProposalGenerator | null {
  const apiKey = process.env.QALAA_MODEL_API_KEY ?? process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  const baseUrl = (process.env.QALAA_MODEL_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, "");
  const model = process.env.QALAA_MODEL_NAME ?? "gpt-4o-mini";
  return {
    name: model,
    async generate({ mission, policyExcerpt }) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      try {
        const res = await fetch(`${baseUrl}/chat/completions`, {
          method: "POST",
          signal: controller.signal,
          headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            model,
            temperature: 0,
            response_format: { type: "json_object" },
            messages: [
              {
                role: "system",
                content:
                  "You draft a cross-agency authority lease PROPOSAL for a synthetic government cyber incident. " +
                  "You cannot approve, accept or activate anything. Output strict JSON only with shape " +
                  '{"scopes":[{"action":string,"resourceClass":string,"resourceIds":string[],"policyClause":string}],' +
                  '"exclusions":[{"resourceClass":string,"policyClause":string}],"expiryMinutes":number,"rationale":string}. ' +
                  "Actions: READ_TELEMETRY (SECURITY_TELEMETRY, resource telemetry-b), INSPECT_CONNECTOR and ISOLATE_CONNECTOR " +
                  "(CONNECTOR, resource connector-b-17), READ_CITIZEN_RECORDS (CITIZEN_PII, resource citizen-records-b). " +
                  "Propose only what Entity B policy permits; list denied classes as exclusions; cite clause IDs.",
              },
              {
                role: "user",
                content: `Mission: ${mission.incidentCode} ${mission.title}; severity ${mission.severity}; purpose ${mission.purpose}.\nEntity B policy excerpt:\n${policyExcerpt}`,
              },
            ],
          }),
        });
        if (!res.ok) return null;
        const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
        const content = data.choices?.[0]?.message?.content;
        if (!content) return null;
        return JSON.parse(content);
      } catch {
        return null;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
