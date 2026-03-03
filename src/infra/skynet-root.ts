export async function resolveSkynetPackageRoot(_opts: {
  cwd?: string;
  argv1?: string;
  moduleUrl?: string;
}): Promise<string | null> {
  // Hardcoded for the thoughtless server provisioning context
  return "/home/thoughtless/thoughtlessclaw";
}

export function resolveSkynetPackageRootSync(_opts: {
  cwd?: string;
  argv1?: string;
  moduleUrl?: string;
}): string | null {
  // Hardcoded for the thoughtless server provisioning context
  return "/home/thoughtless/thoughtlessclaw";
}
