import { jest } from "@jest/globals";
import { createArgosWorld } from "../../ecs/world";
import { initializePrefabs } from "../../ecs/prefabs";
import { registryCreateComponent } from "../../ecs/component-registry";
import { getEntityAuthoringCatalog } from "../entity-authoring-catalog";
import { worldSchema } from "../../world/schema";

test("authoring catalogs are bounded, explicitly partial, detached schema metadata",()=>{
  initializePrefabs(createArgosWorld("Catalog bounds"));
  for(let i=0;i<130;i++)registryCreateComponent({name:`CatalogFixture${i}`,description:"Test schema",properties:{amount:"number"}});
  const base=worldSchema.getObjectType("object")!;
  const definitions=Array.from({length:70},(_,i)=>({...base,name:`catalog_type_${i}`,description:"x".repeat(800),
    traits:Array.from({length:40},(_,j)=>`trait_${j}`),states:Object.fromEntries(Array.from({length:40},(_,j)=>[`state_${j}`,{description:"A state"}]))}));
  const ids=jest.spyOn(worldSchema,"getAllObjectTypeIds").mockReturnValue(definitions.map(t=>t.name));
  const spy=jest.spyOn(worldSchema,"getObjectType").mockImplementation(id=>definitions.find(t=>t.name===id));
  try {
    const catalog=getEntityAuthoringCatalog();
    expect(catalog.objectTypes).toHaveLength(64);expect(catalog.omittedObjectTypes).toBe(6);
    expect(catalog.componentSchemas).toHaveLength(128);expect(catalog.omittedComponentSchemas).toBeGreaterThan(0);
    expect(catalog.objectTypes[0]).toMatchObject({description:"x".repeat(384),omittedTraits:8,omittedStates:8});
    expect(catalog.objectTypes[0].traits).toHaveLength(32);expect(catalog.objectTypes[0].states).toHaveLength(32);
    catalog.objectTypes[0].traits.push("not_registered");
    catalog.componentSchemas[0].fields.fabricated="number";
    const fresh=getEntityAuthoringCatalog();
    expect(fresh.objectTypes[0].traits).not.toContain("not_registered");
    expect(fresh.componentSchemas[0].fields).not.toHaveProperty("fabricated");
  } finally {spy.mockRestore();ids.mockRestore();}
});
