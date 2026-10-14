import type { ApprovalDecision, ApprovalScope } from "./ipc";

export type ConfirmationPolicyDecision = "allow" | "deny" | "ask";

/** A catastrophic call always reaches the user's approval prompt, even if granted. */
export function confirmationDecision(
  neverAutoApprove: boolean,
  policyDecision: ConfirmationPolicyDecision,
): ConfirmationPolicyDecision {
  return neverAutoApprove ? "ask" : policyDecision;
}

/** Dangerous commands may be allowed once by hand, but can never create a grant. */
export function approvalGrantScope(
  decision: ApprovalDecision,
  requestedScope: ApprovalScope,
  neverPersist: boolean,
): ApprovalScope {
  if (decision !== "allow" || requestedScope === "once" || neverPersist) {
    return "once";
  }
  return requestedScope;
}
