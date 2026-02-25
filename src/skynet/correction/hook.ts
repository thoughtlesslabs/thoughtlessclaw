import { appendViolation } from "./violation-tracker.js";

export async function checkViolationHook(agentId: string, result: string): Promise<boolean> {
  // Check for completion contract
  const hasDonePrefix = result.startsWith("DONE:");
  
  if (!hasDonePrefix) {
    const violation = `Agent ${agentId} failed to prefix result with 'DONE:'. Result: ${result}`;
    await appendViolation(violation);
    return false;
  }
  return true;
}
