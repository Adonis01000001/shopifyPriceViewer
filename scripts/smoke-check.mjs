const baseUrl = (process.env.SMOKE_BASE_URL ?? process.argv[2] ?? "").replace(
  /\/$/,
  ""
);

if (!baseUrl) {
  console.error("Usage: SMOKE_BASE_URL=https://app.example.com pnpm smoke");
  process.exit(2);
}

const checks = [
  { path: "/health/live", expected: 200 },
  { path: "/health/ready", expected: 200 },
  { path: "/", expected: 200 },
];

for (const check of checks) {
  const url = `${baseUrl}${check.path}`;
  try {
    const response = await fetch(url, { redirect: "manual" });
    if (response.status !== check.expected) {
      throw new Error(
        `expected ${check.expected}, received ${response.status}`
      );
    }
    console.log(`PASS ${check.path} (${response.status})`);
  } catch (error) {
    console.error(
      `FAIL ${check.path}: ${error instanceof Error ? error.message : error}`
    );
    process.exit(1);
  }
}

console.log("Smoke checks passed");
