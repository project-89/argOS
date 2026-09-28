/** The focused profile uses the same evidence runner and production cognition.
 * No video/model-render calls. --core-only isolates cognition from world builders.
 * Without --live this checks plumbing only, never autonomous behavior. */
process.argv.push("--focused");
if (!process.argv.some(value => value.startsWith("--narrative-mind="))) process.argv.push("--narrative-mind=on");
if (!process.argv.some(value => value.startsWith("--reconsideration="))) process.argv.push("--reconsideration=on");
await import("./sitcom-breakup-check");
export {};
