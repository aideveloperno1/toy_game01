const url = process.env.APP_URL,
  token = process.env.ADMIN_TOKEN;
if (!url || !token) throw new Error("APP_URL and ADMIN_TOKEN are required.");
const headers = {
  Authorization: `Bearer ${token}`,
  "Content-Type": "application/json",
};
const enable = !process.argv.includes("--resume");
const response = await fetch(`${url}/api/admin/drain`, {
  method: "POST",
  headers,
  body: JSON.stringify({ enabled: enable }),
  signal: AbortSignal.timeout(15000),
});
if (!response.ok) throw new Error(`Drain request failed (${response.status}).`);
if (enable) {
  let finished = false;
  for (let i = 0; i < 120; i++) {
    const status = await fetch(`${url}/api/admin/status`, {
      headers,
      signal: AbortSignal.timeout(15000),
    });
    if (!status.ok)
      throw new Error(`Status request failed (${status.status}).`);
    if ((await status.json()).activeRounds === 0) {
      finished = true;
      break;
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
  if (!finished)
    throw new Error(
      "Active games did not finish within 10 minutes. Deployment must stop.",
    );
}
console.log(
  enable ? "No active rounds. Safe to deploy." : "New rounds enabled.",
);
