import { directorConfigure, isDirectorProxyTarget, projectDirectorScene, validateDirectorResolution, confirmDirectorResolution } from "../director-projection";

test.each(["480p", "768p", "1080p"] as const)("requested %s needs an exact configured receipt", resolution => {
  expect(directorConfigure("Scene", 3, resolution)).toMatchObject({ resolution, prompt_version: 3 });
  expect(() => confirmDirectorResolution({ type: "configured", resolution }, resolution)).not.toThrow();
  for (const message of [{ type: "session_info", resolution }, { type: "configured" },
    { type: "configured", resolution: resolution === "480p" ? "768p" : "480p" }])
    expect(() => confirmDirectorResolution(message, resolution)).toThrow();
});
test("resolution validation rejects unsupported or ambiguous values", () => {
  for (const v of [undefined, "720p", "768P", "1080p ", 1080, "4k"]) expect(() => validateDirectorResolution(v)).toThrow();
});

test("projects confirmed location without turning private thoughts into dialogue", () => {
  const prompt = projectDirectorScene("Rainy island", {
    name: "Mara", role: "keeper", description: "Yellow coat", room: "Beacon room",
    currentThought: "SECRET THOUGHT", thoughts: [{ content: "SECRET THOUGHT" }],
  } as any, 12);
  expect(prompt).toContain("Beacon room");
  expect(prompt).toContain("tick: 12");
  expect(prompt).not.toContain("SECRET THOUGHT");
  expect(directorConfigure(prompt)).toMatchObject({ type: "configure", resolution: "480p", prompt_version: 1 });
  expect(() => directorConfigure(" ")).toThrow();
});

test("proxy allowlist rejects alternate models and URL tricks", () => {
  expect(isDirectorProxyTarget("https://wma.fal.run/session")).toBe(true);
  for (const target of ["https://fal.run/other-model", "https://wma.fal.run.evil.com/session",
    "http://wma.fal.run/session", "https://wma.fal.run/session?redirect=evil"]) {
    expect(isDirectorProxyTarget(target)).toBe(false);
  }
});
