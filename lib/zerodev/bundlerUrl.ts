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

  if (trimmed.startsWith("http")) {
    // Extract project ID from full URL
    // e.g. https://rpc.zerodev.app/api/v3/8bcedfbe-9a45-4067-b830-63c5e680ead6/chain/4790
    const match = trimmed.match(/\/api\/v\d+\/([^/]+)/);
    if (!match) {
      throw new Error("Could not extract project ID from URL. Paste a ZeroDev RPC URL or project ID.");
    }
    projectId = match[1];
  } else {
    // Assume it's a raw project ID
    projectId = trimmed;
  }

  return `https://rpc.zerodev.app/api/v3/${projectId}/chain/${chainId}`;
}
