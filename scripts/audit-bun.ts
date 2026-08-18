const allowedAdvisories = new Set(['https://github.com/advisories/GHSA-67mh-4wv8-2f99']);

const audit = Bun.spawn(['bun', 'audit', '--json'], { stdout: 'pipe', stderr: 'pipe' });
const [stdout, stderr, exitCode] = await Promise.all([
  new Response(audit.stdout).text(),
  new Response(audit.stderr).text(),
  audit.exited,
]);

const jsonLine = stdout
  .split('\n')
  .map((line) => line.trim())
  .findLast((line) => line.startsWith('{'));
if (!jsonLine) {
  console.error(stderr || stdout || `bun audit exited ${exitCode}`);
  process.exit(1);
}

const report = JSON.parse(jsonLine) as Record<string, Array<{ url: string; title: string }>>;
const unexpected = Object.entries(report).flatMap(([name, advisories]) =>
  advisories
    .filter((advisory) => !allowedAdvisories.has(advisory.url))
    .map((advisory) => ({ name, ...advisory })),
);
if (unexpected.length > 0) {
  console.error('Unexpected dependency advisories:', unexpected);
  process.exit(1);
}

const knownEsbuild = report.esbuild?.some((item) => allowedAdvisories.has(item.url));
if (knownEsbuild) {
  const why = Bun.spawn(['bun', 'why', 'esbuild'], { stdout: 'pipe', stderr: 'pipe' });
  const graph = await new Response(why.stdout).text();
  const whyExit = await why.exited;
  if (
    whyExit !== 0 ||
    !graph.includes('esbuild@0.18.20') ||
    !graph.includes('@esbuild-kit/core-utils@3.3.2') ||
    !graph.includes('dev @subtitle-fm/db@workspace')
  ) {
    console.error(
      'The allowed esbuild advisory is no longer confined to the known Drizzle dev path.',
    );
    process.exit(1);
  }
  console.warn('Allowed: GHSA-67mh-4wv8-2f99 in Drizzle Kit development tooling only.');
}

console.log('No unreviewed Bun dependency advisories.');
