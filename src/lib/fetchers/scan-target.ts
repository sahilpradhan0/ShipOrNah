import type { ScanFile } from "@/lib/scanner/types";

const MAX_FILE_SIZE = 500 * 1024;

const TEXT_EXTENSIONS =
  /\.(js|jsx|ts|tsx|json|sql|env(\..+)?|mjs|cjs|css|html|md|yaml|yml|toml|prisma)$/i;

const SKIP_DIRS = /(^|\/)(node_modules|\.git|dist|build|\.next|coverage|vendor)(\/|$)/i;

const SKIP_FILES =
  /(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|\.png$|\.jpg$|\.jpeg$|\.gif$|\.webp$|\.ico$|\.woff2?$|\.ttf$|\.eot$|\.pdf$|\.zip$|\.tar$|\.gz$)/i;

export function shouldIncludeRepoFile(path: string, size: number): boolean {
  if (size > MAX_FILE_SIZE) return false;
  if (SKIP_DIRS.test(path)) return false;
  if (SKIP_FILES.test(path)) return false;
  if (path.endsWith(".env") || TEXT_EXTENSIONS.test(path)) return true;
  return TEXT_EXTENSIONS.test(path);
}

export function parseGitHubRepoUrl(url: string): { owner: string; repo: string } | null {
  try {
    const parsed = new URL(url.startsWith("http") ? url : `https://${url}`);
    const parts = parsed.pathname.replace(/^\/+|\/+$/g, "").split("/");
    if (parts.length < 2 || parts[0] === "" || parts[1] === "") return null;
    if (parsed.hostname.replace(/^www\./, "") !== "github.com") return null;
    return { owner: parts[0], repo: parts[1].replace(/\.git$/, "") };
  } catch {
    return null;
  }
}

async function githubFetch(path: string): Promise<Response> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "ShipOrNah-Scanner",
  };
  const token = process.env.GITHUB_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;

  return fetch(`https://api.github.com${path}`, { headers });
}

export async function fetchGitHubRepo(url: string): Promise<ScanFile[]> {
  const repoInfo = parseGitHubRepoUrl(url);
  if (!repoInfo) {
    throw new Error("Invalid GitHub repository URL.");
  }

  const { owner, repo } = repoInfo;
  const repoRes = await githubFetch(`/repos/${owner}/${repo}`);

  if (repoRes.status === 404) {
    throw new Error("Repository not found. It may be private or the URL is incorrect.");
  }
  if (repoRes.status === 403) {
    throw new Error(
      "GitHub API rate limit reached. Wait a few minutes and try again, or scan a live app URL instead.",
    );
  }
  if (!repoRes.ok) {
    throw new Error("Unable to reach GitHub. Try again in a moment.");
  }

  const repoData = (await repoRes.json()) as { default_branch: string };
  const branch = repoData.default_branch ?? "main";

  const treeRes = await githubFetch(
    `/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`,
  );

  if (!treeRes.ok) {
    throw new Error("Unable to read repository file tree.");
  }

  const treeData = (await treeRes.json()) as {
    tree: Array<{ path: string; type: string; size?: number; url?: string }>;
  };

  const blobs = treeData.tree.filter(
    (item) =>
      item.type === "blob" &&
      item.url &&
      shouldIncludeRepoFile(item.path, item.size ?? 0),
  );

  // Fetch raw content via raw.githubusercontent.com instead of the api.github.com
  // blob endpoint. This avoids spending the 60-req/hour unauthenticated core API
  // rate limit on every single file — raw.githubusercontent.com is served from a
  // CDN with its own, much higher limits, so the only api.github.com calls this
  // function makes are the 2 above (repo info + tree), regardless of repo size.
  const files: ScanFile[] = [];
  const batchSize = 15;

  for (let i = 0; i < blobs.length; i += batchSize) {
    const batch = blobs.slice(i, i + batchSize);
    const contents = await Promise.all(
      batch.map(async (blob) => {
        const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${encodeURI(blob.path)}`;
        const res = await fetch(rawUrl, {
          headers: { "User-Agent": "ShipOrNah-Scanner" },
        });
        if (!res.ok) return null;
        const content = await res.text();
        if (content.length > MAX_FILE_SIZE) return null;
        return { path: blob.path, content };
      }),
    );
    files.push(...contents.filter((f): f is ScanFile => f !== null));
  }

  return files;
}


