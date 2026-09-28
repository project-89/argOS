import { spawnSitcomEpisode } from "../sitcom-restart";

test("a child reports its private loopback link over IPC and keeps launch arguments", async () => {
  const url = `http://127.0.0.1:3470/#${"d".repeat(48)}`;
  const code = `if (process.env.ARGOS_SITCOM_PORT !== "0" || process.argv[1] !== "--narrative-mind") process.exit(2);
    process.on("disconnect", () => process.exit(0));
    process.send({type:"sitcom_ready",url:${JSON.stringify(url)}});`;
  await expect(spawnSitcomEpisode("--eval", [code, "--", "--narrative-mind"])).resolves.toEqual({ url });
});

test("an invalid child link fails closed rather than navigating outside loopback", async () => {
  await expect(spawnSitcomEpisode("--eval", ['process.send({type:"sitcom_ready",url:"https://example.com/"}); setInterval(()=>{},1000);']))
    .rejects.toThrow("invalid local session link");
});

test("a startup exit rejects promptly instead of returning a dead receiver", async () => {
  await expect(spawnSitcomEpisode("--eval", ["process.exit(2)"])).rejects.toThrow("exited before becoming ready");
});
