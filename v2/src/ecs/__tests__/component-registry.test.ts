import { createArgosWorld } from "../world";
import {
  getComponent,
  initializeRegistry,
  registryCreateComponent,
  listDefinitions,
} from "../component-registry";

describe("component registry", () => {
  test("built-in schema types are authoritative before any entities populate sparse arrays", () => {
    initializeRegistry(createArgosWorld("Empty schema world"));
    const definitions = Object.fromEntries(listDefinitions().map(def => [def.name, def.properties]));
    expect(definitions.Position).toEqual({ x: "number", y: "number", z: "number" });
    expect(definitions.Agent.active).toBe("boolean");
    expect(definitions.Mind.arousal).toBe("number");
    expect(definitions.Name.value).toBe("string");
  });
  test("rejects a dynamic component that shadows a built-in", () => {
    const world = createArgosWorld("RegistryCollisionTest");
    initializeRegistry(world);
    const originalName = getComponent("Name");

    expect(() => registryCreateComponent({
      name: "Name",
      description: "An invalid shadow component",
      properties: { impostor: { type: "string", default: "" } },
    })).toThrow(/Component name collision/);

    expect(getComponent("Name")).toBe(originalName);
  });

  test("rejects duplicate dynamic component names", () => {
    const world = createArgosWorld("RegistryDuplicateTest");
    initializeRegistry(world);

    registryCreateComponent({
      name: "Weathering",
      description: "Surface wear",
      properties: { amount: { type: "number", default: 0 } },
    });

    expect(() => registryCreateComponent({
      name: "Weathering",
      description: "A conflicting definition",
      properties: { severity: { type: "number", default: 0 } },
    })).toThrow(/Component name collision/);
  });
});
