// Prints a password hash for PRIVATE_PASSWORDS. Usage: node scripts/hash-password.mjs <slug>
// The password is read from stdin (hidden input is not possible in a pipe, so type it when asked).
import { createInterface } from "node:readline/promises";
import { hashPassword } from "../functions/_lib/private-auth.js";

const slug = process.argv[2];
if (!slug || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(slug)) {
  console.error("Usage: node scripts/hash-password.mjs <slug>   (slug: lowercase letters, digits, -)");
  process.exit(1);
}
const rl = createInterface({ input: process.stdin, output: process.stderr });
const password = await rl.question(`Password for ${slug}: `);
rl.close();
if (password.length < 7) {
  console.error("Use at least 7 characters.");
  process.exit(1);
}
console.log(JSON.stringify({ [slug]: await hashPassword(password) }));
