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
console.log("Add the following to your .env file:\n");
console.log(`GOOGLE_REFRESH_TOKEN=${data.refresh_token}`);
console.log("\nSetup complete. You can now run `bun run sync`.");
