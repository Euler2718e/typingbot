export async function copyToClipboard(text: string): Promise<void> {
  const candidates = process.platform === "darwin"
    ? [["pbcopy"]]
    : process.platform === "win32"
      ? [["cmd", "/c", "clip"]]
      : [["wl-copy"], ["xclip", "-selection", "clipboard"]];

  const errors: string[] = [];
  for (const command of candidates) {
    try {
      const child = Bun.spawn(command, { stdin: "pipe", stdout: "ignore", stderr: "pipe" });
      child.stdin.write(text);
      child.stdin.end();
      if (await child.exited === 0) return;
      errors.push(await new Response(child.stderr).text());
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  throw new Error(`Could not access the system clipboard. ${errors.filter(Boolean).join(" ")}`.trim());
}
