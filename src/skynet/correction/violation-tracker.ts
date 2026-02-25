import { appendVaultFile, readVaultFile } from "../vault/store.js";

export async function appendViolation(violationDetails: string) {
  console.log(`[Skynet] Recording violation: ${violationDetails}`);
  
  // Create JSON structure or simply append
  const entry = {
    timestamp: new Date().toISOString(),
    violation: violationDetails,
    penaltyPoints: 10
  };

  await appendVaultFile("rules/violation_patterns.json", JSON.stringify(entry) + "\n");
}

export async function getViolations(): Promise<string[]> {
  const content = await readVaultFile("rules/violation_patterns.json");
  if (!content) return [];
  return content.trim().split("\n");
}
