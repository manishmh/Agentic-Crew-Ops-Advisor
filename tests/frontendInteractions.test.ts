import { readFileSync } from "node:fs";
import { afterEach, describe, expect, test, vi } from "vitest";
import { queryAgent } from "../frontend/src/api/crewops.js";
import { liveScenarios } from "../frontend/src/data/project.js";

const workspaceSource = readFileSync(new URL("../frontend/src/components/crewops/CrewOpsWorkspace.tsx", import.meta.url), "utf8");
const shellSource = readFileSync(new URL("../frontend/src/app/AppShell.tsx", import.meta.url), "utf8");
const scenarioResultSource = readFileSync(new URL("../frontend/src/components/crewops/ScenarioResult.tsx", import.meta.url), "utf8");

describe("public guided-query interaction contract", () => {
  afterEach(() => vi.unstubAllGlobals());

  test("defines all five guided scenarios with the exact operational queries", () => {
    expect(liveScenarios).toEqual([
      { id: "sick", label: "Sick crew", query: "What happens if C-1042 reports sick?" },
      { id: "delay", label: "Delay propagation", query: "Delay DX412 by 90 minutes" },
      { id: "closure", label: "Station closure", query: "Close HYD from 05:00–09:00 UTC" },
      { id: "certification", label: "Certification risk", query: "What happens if C-5417's recurrent training expires?" },
      { id: "multi", label: "Joint recovery", query: "C-3940 and C-1938 report sick on 2026-09-18" },
    ]);
  });

  test("sidebar, workspace cards and New Analysis options share executeScenario", () => {
    for (const id of liveScenarios.map(scenario => scenario.id)) {
      expect(workspaceSource).toContain(`data-testid={\`sidebar-scenario-${"${scenario.id}"}\`}`);
      expect(workspaceSource).toContain(`data-testid={\`workspace-scenario-${"${scenario.id}"}\`}`);
      expect(workspaceSource).toContain(`data-testid={\`new-analysis-${"${scenario.id}"}\`}`);
    }
    expect(workspaceSource).toContain("onClick={() => executeScenario(scenario)}");
    expect(workspaceSource).not.toContain("scenarios[id]");
  });

  test("blank analysis resets and focuses without submitting", () => {
    const blankBody = workspaceSource.slice(workspaceSource.indexOf("const blankAnalysis"), workspaceSource.indexOf("return ("));
    expect(blankBody).toContain("onNewBlank()");
    expect(blankBody).toContain("input.current?.focus()");
    expect(blankBody).not.toContain("onRunQuery");
  });

  test("typed Enter and send form both use the shared executeQuery path", () => {
    expect(workspaceSource).toContain("void executeQuery(query)");
    expect(workspaceSource).toContain('event.key === "Enter" && !event.shiftKey');
    expect(workspaceSource).toContain("disabled={submitting || !query.trim()}");
  });

  test("AppShell has one operational API call site and no mock-result branch", () => {
    expect(shellSource.match(/queryAgent\(normalized\)/g)).toHaveLength(1);
    expect(shellSource).not.toMatch(/query(?:SickCrew|Delay|StationClosure|CertificationExpiry|MultiSick)\(/);
    expect(workspaceSource).not.toContain("Mock operational");
    expect(workspaceSource).not.toContain("Demo response");
  });

  test("every guided query is sent through the real API adapter", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("offline"));
    vi.stubGlobal("fetch", fetchMock);
    for (const scenario of liveScenarios) {
      await expect(queryAgent(scenario.query)).rejects.toMatchObject({ kind: "network" });
    }
    expect(fetchMock).toHaveBeenCalledTimes(5);
    for (const [index, scenario] of liveScenarios.entries()) {
      expect(fetchMock.mock.calls[index]?.[0]).toBe("/api/crewops/query");
      expect(JSON.parse(String(fetchMock.mock.calls[index]?.[1]?.body))).toEqual({ question: scenario.query });
    }
  });

  test.each([
    ["rate limit", new Response(JSON.stringify({ success: false, error: { code: "RATE_LIMITED", message: "private detail" } }), { status: 429, headers: { "content-type": "application/json" } }), "backend", "Too many requests"],
    ["clarification", new Response(JSON.stringify({ success: false, error: { code: "CLARIFICATION_REQUIRED", message: "How long should DX412 be delayed?" } }), { status: 422, headers: { "content-type": "application/json" } }), "clarification", "How long"],
    ["unsupported", new Response(JSON.stringify({ success: false, error: { code: "UNSUPPORTED_INTENT", message: "internal" } }), { status: 422, headers: { "content-type": "application/json" } }), "unsupported", "guided scenario"],
    ["malformed", new Response("not-json", { status: 200 }), "malformed", "unexpected response"],
  ])("classifies %s responses without exposing internal transport details", async (_name, response, kind, message) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
    await expect(queryAgent("question")).rejects.toMatchObject({ kind, message: expect.stringContaining(message) });
  });

  test("failed submissions remain recoverable and completed submissions clear input", () => {
    expect(workspaceSource).toContain("const succeeded = await onRunQuery(normalized)");
    expect(workspaceSource).toContain('if (succeeded) setQuery("")');
    expect(shellSource).toContain("finally {");
    expect(shellSource).toContain("submittingRef.current = false");
    expect(shellSource).toContain("setSubmitting(false)");
  });

  test("main product sources contain no public prototype-mode labels", () => {
    const visible = `${workspaceSource}\n${shellSource}`;
    expect(visible).not.toMatch(/DEMO MODE|READ-ONLY PREVIEW|DEMO SNAPSHOT|LOCAL DEMO MOCKS|DEMO OPERATOR/i);
  });

  test("CrewOps uses the compact workspace bar and removes the former tall desk header", () => {
    expect(shellSource).toContain('workspace === "CrewOps AI"');
    expect(shellSource).toContain('className="date-toolbar crewops-workspace-bar"');
    expect(shellSource).toContain("LIVE OPERATIONS WORKSPACE");
    expect(shellSource).toContain("Crew recovery desk");
    expect(shellSource).toContain("Network view");
    expect(workspaceSource).not.toContain('className="copilot-header"');
    expect(workspaceSource).not.toContain('className="context-strip"');
    expect(workspaceSource).not.toContain("Deterministic disruption analysis and recovery planning");
    expect(workspaceSource).not.toContain("operation.flights");
    expect(workspaceSource).not.toContain("operation.crew");
    expect(workspaceSource).not.toContain("operation.reserves");
  });

  test("large recovery pools default to a concise candidate subset with explicit expansion", () => {
    expect(scenarioResultSource).toContain('.filter((option) => option.status === "legal").slice(0, 5)');
    expect(scenarioResultSource).toContain('.filter((option) => option.status !== "legal").slice(0, 3)');
    expect(scenarioResultSource).toContain("View all ${scenario.alternatives.length} candidates");
  });
});
