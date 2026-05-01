// One-time OAuth2 setup script.
// Run: bun run scripts/setup-auth.ts
// Scopes: gmail.readonly + spreadsheets

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/spreadsheets",
];

const clientId = process.env.GOOGLE_CLIENT_ID;
const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

if (!clientId || !clientSecret) {
  console.error(
    "Error: GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set in .env\n" +
      "Get these from Google Cloud Console > APIs & Services > Credentials."
  );
  process.exit(1);
}

const redirectUri = "urn:ietf:wg:oauth:2.0:oob";

const authUrl =
  "https://accounts.google.com/o/oauth2/v2/auth?" +
  new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
  });

console.log("\n=== owo-log OAuth2 Setup ===\n");
console.log("1. Open this URL in your browser:\n");
console.log(authUrl);
console.log("\n2. Sign in and grant access to Gmail (read) and Google Sheets.");
console.log("3. Copy the authorization code shown and paste it below.\n");

process.stdout.write("Authorization code: ");

const code = (await new Promise<string>((resolve) => {
  process.stdin.resume();
  process.stdin.setEncoding("utf-8");
  process.stdin.once("data", (data) => {
    process.stdin.pause();
    resolve((data as string).trim());
  });
}));

console.log("\nExchanging code for tokens...");

const res = await fetch("https://oauth2.googleapis.com/token", {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  }),
});

if (!res.ok) {
  const body = await res.text();
  console.error(`\nError exchanging code (${res.status}): ${body}`);
  process.exit(1);
}

const data = (await res.json()) as {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
};

if (!data.refresh_token) {
  console.error(
    "\nError: No refresh token returned. Make sure you included `prompt=consent` and `access_type=offline`."
  );
  process.exit(1);
}

console.log("\n=== Success! ===\n");

const token = data.refresh_token;

async function prompt(question: string): Promise<string> {
  process.stdout.write(question);
  return new Promise<string>((resolve) => {
    process.stdin.resume();
    process.stdin.setEncoding("utf-8");
    process.stdin.once("data", (d) => {
      process.stdin.pause();
      resolve((d as string).trim());
    });
  });
}

async function writeTokenToEnv(refreshToken: string): Promise<void> {
  const envFile = Bun.file(".env");
  const line = `GOOGLE_REFRESH_TOKEN=${refreshToken}`;

  if (await envFile.exists()) {
    const existing = await envFile.text();
    const updated = existing.match(/^GOOGLE_REFRESH_TOKEN=.*/m)
      ? existing.replace(/^GOOGLE_REFRESH_TOKEN=.*/m, line)
      : existing.endsWith("\n") ? existing + line + "\n" : existing + "\n" + line + "\n";
    await Bun.write(".env", updated);
    console.log("  Updated GOOGLE_REFRESH_TOKEN in .env");
  } else {
    await Bun.write(".env", line + "\n");
    console.log("  Created .env with GOOGLE_REFRESH_TOKEN");
  }
}

const writeAnswer = await prompt(`Write GOOGLE_REFRESH_TOKEN to .env? [Y/n]: `);
if (!writeAnswer || /^y/i.test(writeAnswer)) {
  await writeTokenToEnv(token);
} else {
  console.log(`\nAdd this to your .env manually:\n\nGOOGLE_REFRESH_TOKEN=${token}\n`);
}

// Offer to create required sheet tabs
const sheetId = process.env.SHEET_ID;
if (sheetId) {
  const { listSheetTabs, createTab, appendRows, TAB_HEADERS } = await import("../src/sheets/client.ts");
  const REQUIRED_TABS = ["Transactions", "Categories"];
  const existing = await listSheetTabs(sheetId);
  const existingTitles = existing.map((t) => t.title);
  const missing = REQUIRED_TABS.filter((t) => !existingTitles.includes(t));

  if (missing.length > 0) {
    console.log(`\nThe following required sheet tabs are missing: ${missing.join(", ")}`);
    const tabAnswer = await prompt(`Create them now with headers? [Y/n]: `);
    if (!tabAnswer || /^y/i.test(tabAnswer)) {
      for (const tab of missing) {
        await createTab(sheetId, tab);
        const headers = TAB_HEADERS[tab];
        if (headers) await appendRows(sheetId, `${tab}!A1`, [headers]);
        console.log(`  Created tab: ${tab}`);
      }
    } else {
      console.log(`  Skipped. You must create these tabs manually before running sync.`);
    }
  } else {
    console.log("\nAll required sheet tabs are present.");
  }
} else {
  console.log("\nTip: Add SHEET_ID to .env and re-run setup to auto-create sheet tabs.");
}

const syncAnswer = await prompt("\nRun `bun run sync` now? [Y/n]: ");
if (!syncAnswer || /^y/i.test(syncAnswer)) {
  console.log("");
  const proc = Bun.spawn(["bun", "run", "sync"], { stdio: ["inherit", "inherit", "inherit"] });
  const exitCode = await proc.exited;
  process.exit(exitCode);
} else {
  console.log("\nSetup complete. Run `bun run sync` when ready.");
}
