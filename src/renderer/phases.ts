export type Phase = "spec" | "user-story" | "technical-story" | "implementation";

export const PHASE_ORDER: Phase[] = ["spec", "user-story", "technical-story", "implementation"];

export const PHASE_LABEL: Record<Phase, string> = {
  spec: "Spec",
  "user-story": "User Stories",
  "technical-story": "Technical Stories",
  implementation: "Implementation",
};

export function canAdvance(phase: Phase, artifacts: Artifacts): boolean {
  switch (phase) {
    case "spec":
      return artifacts.spec.trim().length > 0;
    case "user-story":
      return artifacts.userStories.trim().length > 0;
    case "technical-story":
      return artifacts.technicalStories.trim().length > 0;
    case "implementation":
      return false;
  }
}

export function nextPhase(phase: Phase): Phase {
  const i = PHASE_ORDER.indexOf(phase);
  return PHASE_ORDER[Math.min(i + 1, PHASE_ORDER.length - 1)];
}

export function prevPhase(phase: Phase): Phase {
  const i = PHASE_ORDER.indexOf(phase);
  return PHASE_ORDER[Math.max(i - 1, 0)];
}

export interface Artifacts {
  spec: string;
  userStories: string;
  technicalStories: string;
  code: string;
}

export const EMPTY_ARTIFACTS: Artifacts = {
  spec: "",
  userStories: "",
  technicalStories: "",
  code: "",
};
