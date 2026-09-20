import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { appendEvent, DATA_DIR, initializeStore, updateState } from "./store.js";

export interface HandoffInput {
  task: string;
  summary?: string;
  nextStep?: string;
  blockers?: string;
  status?: "active" | "paused" | "completed";
}

export interface HandoffResult extends HandoffInput {
  updatedAt: string;
}

function oneLine(value: string | undefined, fallback: string): string {
  const normalized = (value || "").replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
  return (normalized || fallback).slice(0, 2000);
}

export function recordHandoff(root: string, input: HandoffInput): HandoffResult {
  initializeStore(root);
  const updatedAt = new Date().toISOString();
  const result: HandoffResult = {
    task: oneLine(input.task, "none"),
    summary: oneLine(input.summary, "none recorded"),
    nextStep: oneLine(input.nextStep, input.task || "none"),
    blockers: oneLine(input.blockers, "none recorded"),
    status: input.status || "active",
    updatedAt
  };

  const body = [
    "# Current state",
    "",
    "- Status: " + result.status,
    "- Active task: " + result.task,
    "- Summary: " + result.summary,
    "- Next step: " + result.nextStep,
    "- Known blockers: " + result.blockers,
    "- Updated: " + updatedAt,
    ""
  ].join("\n");

  writeFileSync(join(root, DATA_DIR, "STATE.md"), body, "utf8");
  updateState(root);
  appendEvent(root, "handoff.recorded", {
    task: result.task,
    status: result.status,
    nextStep: result.nextStep,
    blockers: result.blockers
  });
  return result;
}
