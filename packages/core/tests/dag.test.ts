import { describe, it, expect } from "vitest";
import { buildExecutionPlan } from "../src/dag.js";
import { AgentNotFoundError, CircularDependencyError } from "../src/errors.js";
import type { AgentConfig } from "../src/types.js";

function makeAgent(
  overrides: Partial<AgentConfig<unknown, unknown>> = {},
): AgentConfig<unknown, unknown> {
  return {
    name: overrides.name ?? "agent",
    systemPrompt: "You are a test agent.",
    ...overrides,
  };
}

// ============================================================
// buildExecutionPlan
// ============================================================

describe("buildExecutionPlan", () => {
  // --------------------------------------------------------
  // Single agent
  // --------------------------------------------------------

  describe("single agent", () => {
    it("should create a plan for a single agent with no tags", () => {
      const configs: Record<string, AgentConfig<unknown, unknown>> = {
        agentA: makeAgent({ name: "agentA" }),
      };

      const plan = buildExecutionPlan(["agentA"], configs);
      expect(plan.steps).toHaveLength(1);
      expect(plan.steps[0]!.agentName).toBe("agentA");
      expect(plan.steps[0]!.dependsOn).toEqual([]);
      expect(plan.steps[0]!.parallelGroup).toBe(0);
      expect(plan.totalGroups).toBe(1);
    });
  });

  // --------------------------------------------------------
  // Linear chains
  // --------------------------------------------------------

  describe("linear chains", () => {
    it("should order agents based on tag dependencies", () => {
      const configs: Record<string, AgentConfig<unknown, unknown>> = {
        researcher: makeAgent({
          name: "researcher",
          providesTags: [{ type: "Research", id: "topic" }],
        }),
        writer: makeAgent({
          name: "writer",
          invalidatesTags: [{ type: "Research" }],
          providesTags: [{ type: "Draft" }],
        }),
      };

      const plan = buildExecutionPlan(["researcher", "writer"], configs);

      // researcher should be in an earlier group than writer
      const researcherStep = plan.steps.find((s) => s.agentName === "researcher")!;
      const writerStep = plan.steps.find((s) => s.agentName === "writer")!;

      expect(researcherStep.parallelGroup).toBeLessThan(writerStep.parallelGroup);
      expect(writerStep.dependsOn).toContain("researcher");
    });

    it("should handle a 3-agent linear chain", () => {
      const configs: Record<string, AgentConfig<unknown, unknown>> = {
        a: makeAgent({
          name: "a",
          providesTags: ["TagA"],
        }),
        b: makeAgent({
          name: "b",
          invalidatesTags: ["TagA"],
          providesTags: ["TagB"],
        }),
        c: makeAgent({
          name: "c",
          invalidatesTags: ["TagB"],
        }),
      };

      const plan = buildExecutionPlan(["a", "b", "c"], configs);
      expect(plan.totalGroups).toBe(3);

      const stepA = plan.steps.find((s) => s.agentName === "a")!;
      const stepB = plan.steps.find((s) => s.agentName === "b")!;
      const stepC = plan.steps.find((s) => s.agentName === "c")!;

      expect(stepA.parallelGroup).toBe(0);
      expect(stepB.parallelGroup).toBe(1);
      expect(stepC.parallelGroup).toBe(2);
      expect(stepB.dependsOn).toContain("a");
      expect(stepC.dependsOn).toContain("b");
    });
  });

  // --------------------------------------------------------
  // Parallel groups
  // --------------------------------------------------------

  describe("parallel groups", () => {
    it("should put independent agents in the same parallel group", () => {
      const configs: Record<string, AgentConfig<unknown, unknown>> = {
        a: makeAgent({ name: "a" }),
        b: makeAgent({ name: "b" }),
        c: makeAgent({ name: "c" }),
      };

      const plan = buildExecutionPlan(["a", "b", "c"], configs);
      expect(plan.totalGroups).toBe(1);
      for (const step of plan.steps) {
        expect(step.parallelGroup).toBe(0);
        expect(step.dependsOn).toEqual([]);
      }
    });

    it("should handle a diamond dependency pattern", () => {
      // A provides TagA
      // B and C both invalidate TagA (depend on A), but are independent of each other
      // D invalidates TagB and TagC (depends on B and C)
      const configs: Record<string, AgentConfig<unknown, unknown>> = {
        a: makeAgent({ name: "a", providesTags: ["TagA"] }),
        b: makeAgent({
          name: "b",
          invalidatesTags: ["TagA"],
          providesTags: ["TagB"],
        }),
        c: makeAgent({
          name: "c",
          invalidatesTags: ["TagA"],
          providesTags: ["TagC"],
        }),
        d: makeAgent({
          name: "d",
          invalidatesTags: ["TagB", "TagC"],
        }),
      };

      const plan = buildExecutionPlan(["a", "b", "c", "d"], configs);

      const stepA = plan.steps.find((s) => s.agentName === "a")!;
      const stepB = plan.steps.find((s) => s.agentName === "b")!;
      const stepC = plan.steps.find((s) => s.agentName === "c")!;
      const stepD = plan.steps.find((s) => s.agentName === "d")!;

      // A is first
      expect(stepA.parallelGroup).toBe(0);
      // B and C are in the same parallel group
      expect(stepB.parallelGroup).toBe(stepC.parallelGroup);
      expect(stepB.parallelGroup).toBe(1);
      // D is last
      expect(stepD.parallelGroup).toBe(2);
      expect(stepD.dependsOn).toContain("b");
      expect(stepD.dependsOn).toContain("c");
    });

    it("should handle mixed independent and dependent agents", () => {
      // A provides TagA, B invalidates TagA. C is independent.
      const configs: Record<string, AgentConfig<unknown, unknown>> = {
        a: makeAgent({ name: "a", providesTags: ["TagA"] }),
        b: makeAgent({ name: "b", invalidatesTags: ["TagA"] }),
        c: makeAgent({ name: "c" }),
      };

      const plan = buildExecutionPlan(["a", "b", "c"], configs);

      const stepA = plan.steps.find((s) => s.agentName === "a")!;
      const stepB = plan.steps.find((s) => s.agentName === "b")!;
      const stepC = plan.steps.find((s) => s.agentName === "c")!;

      // A and C can run in parallel (group 0)
      expect(stepA.parallelGroup).toBe(0);
      expect(stepC.parallelGroup).toBe(0);
      // B depends on A, so it is in group 1
      expect(stepB.parallelGroup).toBe(1);
    });
  });

  // --------------------------------------------------------
  // Cycle detection
  // --------------------------------------------------------

  describe("cycle detection", () => {
    it("should throw CircularDependencyError for a direct cycle", () => {
      const configs: Record<string, AgentConfig<unknown, unknown>> = {
        a: makeAgent({
          name: "a",
          providesTags: ["TagA"],
          invalidatesTags: ["TagB"],
        }),
        b: makeAgent({
          name: "b",
          providesTags: ["TagB"],
          invalidatesTags: ["TagA"],
        }),
      };

      expect(() => buildExecutionPlan(["a", "b"], configs)).toThrow(
        CircularDependencyError,
      );
    });

    it("should throw CircularDependencyError for a 3-node cycle", () => {
      const configs: Record<string, AgentConfig<unknown, unknown>> = {
        a: makeAgent({
          name: "a",
          providesTags: ["TagA"],
          invalidatesTags: ["TagC"],
        }),
        b: makeAgent({
          name: "b",
          providesTags: ["TagB"],
          invalidatesTags: ["TagA"],
        }),
        c: makeAgent({
          name: "c",
          providesTags: ["TagC"],
          invalidatesTags: ["TagB"],
        }),
      };

      expect(() => buildExecutionPlan(["a", "b", "c"], configs)).toThrow(
        CircularDependencyError,
      );
    });

    it("should include the offending agent names in the error", () => {
      const configs: Record<string, AgentConfig<unknown, unknown>> = {
        x: makeAgent({
          name: "x",
          providesTags: ["TX"],
          invalidatesTags: ["TY"],
        }),
        y: makeAgent({
          name: "y",
          providesTags: ["TY"],
          invalidatesTags: ["TX"],
        }),
      };

      try {
        buildExecutionPlan(["x", "y"], configs);
        expect.unreachable("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(CircularDependencyError);
        const cde = err as CircularDependencyError;
        expect(cde.agents).toContain("x");
        expect(cde.agents).toContain("y");
      }
    });
  });

  // --------------------------------------------------------
  // Missing agents
  // --------------------------------------------------------

  describe("missing agents", () => {
    it("should throw AgentNotFoundError for an unknown agent name", () => {
      const configs: Record<string, AgentConfig<unknown, unknown>> = {
        a: makeAgent({ name: "a" }),
      };

      expect(() => buildExecutionPlan(["a", "nonexistent"], configs)).toThrow(
        AgentNotFoundError,
      );
    });

    it("should throw AgentNotFoundError when config is empty", () => {
      expect(() => buildExecutionPlan(["a"], {})).toThrow(AgentNotFoundError);
    });

    it("should include the missing agent name in the error message", () => {
      const configs: Record<string, AgentConfig<unknown, unknown>> = {};
      expect(() => buildExecutionPlan(["myAgent"], configs)).toThrow("myAgent");
    });
  });

  // --------------------------------------------------------
  // Edge cases
  // --------------------------------------------------------

  describe("edge cases", () => {
    it("should handle an empty agent list", () => {
      const plan = buildExecutionPlan([], {});
      expect(plan.steps).toHaveLength(0);
      expect(plan.totalGroups).toBe(0);
    });

    it("should ignore function-based providesTags (cannot be resolved statically)", () => {
      const configs: Record<string, AgentConfig<unknown, unknown>> = {
        a: makeAgent({
          name: "a",
          providesTags: (result: unknown) => [{ type: "Dynamic", id: String(result) }],
        }),
        b: makeAgent({
          name: "b",
          invalidatesTags: ["Dynamic"],
        }),
      };

      // Since providesTags is a function, no static dependency can be inferred
      // Both should be in the same parallel group
      const plan = buildExecutionPlan(["a", "b"], configs);
      const stepA = plan.steps.find((s) => s.agentName === "a")!;
      const stepB = plan.steps.find((s) => s.agentName === "b")!;
      expect(stepA.parallelGroup).toBe(stepB.parallelGroup);
    });

    it("should ignore function-based invalidatesTags", () => {
      const configs: Record<string, AgentConfig<unknown, unknown>> = {
        a: makeAgent({
          name: "a",
          providesTags: ["TagA"],
        }),
        b: makeAgent({
          name: "b",
          invalidatesTags: (input: unknown) => [{ type: "TagA", id: String(input) }],
        }),
      };

      // Since invalidatesTags is a function, no static dependency
      const plan = buildExecutionPlan(["a", "b"], configs);
      const stepA = plan.steps.find((s) => s.agentName === "a")!;
      const stepB = plan.steps.find((s) => s.agentName === "b")!;
      expect(stepA.parallelGroup).toBe(stepB.parallelGroup);
    });

    it("should handle agents with tags that do not overlap with any other agent", () => {
      const configs: Record<string, AgentConfig<unknown, unknown>> = {
        a: makeAgent({ name: "a", providesTags: ["X"] }),
        b: makeAgent({ name: "b", providesTags: ["Y"] }),
      };

      const plan = buildExecutionPlan(["a", "b"], configs);
      expect(plan.totalGroups).toBe(1);
    });
  });
});
