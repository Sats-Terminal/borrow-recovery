/**
 * Accepts either a full ZeroDev RPC URL or just a project ID,
 * extracts the project ID, and builds the bundler URL for the given chain.
 *
 * Full URL format: https://rpc.zerodev.app/api/v3/{projectId}/chain/{chainId}
 * Project ID format: 8bcedfbe-9a45-4067-b830-63c5e680ead6
 */
export function buildZeroDevBundlerUrl(input: string, chainId: number): string {
  const trimmed = input.trim();
  if (!trimmed) throw new Error("ZeroDev Project ID or URL is required.");

  let projectId: string;
  const projectIdPattern = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

  try {
    const parsed = new URL(trimmed);
    // Extract project ID from full URL.
    const match = parsed.pathname.match(/\/api\/v\d+\/([^/]+)/i);
    if (!match || !match[1]) {
      throw new Error("Could not extract project ID from URL.");
    }
    projectId = match[1];
  } catch {
    projectId = trimmed;
  }

  if (!projectIdPattern.test(projectId)) {
    throw new Error("Invalid ZeroDev Project ID. Paste a valid project ID or RPC URL.");
  }

  return `https://rpc.zerodev.app/api/v3/${projectId}/chain/${chainId}`;
}
