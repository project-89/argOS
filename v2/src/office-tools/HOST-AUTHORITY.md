# Host office-tool authority

An NPC's computer is a fictional world object, not authority to use the host
filesystem, shell, image provider or repository services. Every new world denies
`runOfficeTool` by default, before handler invocation or workspace resolution.
Native affordance menus also hide denied `run_tool` effects.

For a deliberately authorized office workflow, the host may provide an exact
tool-ID allowlist:

```ts
const simulation = await createSimulation({
  name: "Authorized office workflow",
  hostOfficeTools: ["workspace.list_dir", "workspace.read_file"],
});
```

For manually created worlds, explicitly call
`setWorldOfficeToolPolicy(world, ["workspace.list_dir", "workspace.read_file"])`.
`true` authorizes all registered office tools; `false` revokes permission.
The allowlist is copied, not retained by reference. Existing standalone office
fixtures that relied on global handler registration must now explicitly opt in;
registering a handler or choosing `scripted`/`shell` mode is not authorization.

Authority is host-owned and world-scoped, not part of ECS metadata or saved world
state. Restored worlds require a fresh explicit grant. Shell/provider mode and
environment restrictions remain additional gates after authorization; no
environment variable overrides a denial. An allowed handler still uses its own
workspace path policy; this gate does not turn a directory into an OS sandbox.

ApartmentSitcom always disables host office access. Generated laptop state and
fictional interactions remain available, but cannot access host files or spawn
processes. The separately authorized engineering coding daemon is unaffected.

`__tests__/world-authorization.test.ts` verifies denied list/read/write/replace/
fixture/repository/terminal/provider calls do not reach filesystem or process
functions even with permissive environment settings. Positive file operations
are restricted to a test-owned temporary directory, and a different world
remains denied.
