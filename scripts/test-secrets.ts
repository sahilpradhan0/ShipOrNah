import { scanSecrets } from "../src/lib/scanner/secrets";

// The fake keys below are split in two and joined at runtime. That way this file
// never contains a complete key-shaped string, so GitHub push protection doesn't
// mistake it for a real leak and block your push.
const join = (...parts: string[]) => parts.join("");

const OPENAI_KEY = join("sk-proj-", "abc123xyz789secretkeyhere");
const OPENAI_EXAMPLE_KEY = join("sk-proj-", "fakeexamplekey1234567890");
const STRIPE_KEY = join("sk_live_", "1234567890abcdefghijklmnop");
const ANTHROPIC_KEY = join("sk-ant-", "api03-notreal");

const files = [
  {
    path: "src/config.ts",
    content: `export const key = "${OPENAI_KEY}";`,
  },
  {
    path: ".env.example",
    content: `OPENAI_API_KEY=${OPENAI_EXAMPLE_KEY}`,
  },
  {
    path: ".env",
    content: `STRIPE_KEY=${STRIPE_KEY}`,
  },
  {
    path: "lib/api.ts",
    content: `// placeholder: your-key-here\nconst x = "${ANTHROPIC_KEY}";`,
  },
];

const findings = scanSecrets(files);
console.log(JSON.stringify(findings, null, 2));
console.log(`\nTotal findings: ${findings.length}`);