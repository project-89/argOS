/** Some scalar ECS fields encode structured values. Primitive type validation
 * alone cannot make them safe for native readers. Keep author metadata and
 * write-boundary checks together; this does not migrate legacy stored data. */
type Format={encoding:"json-string-array";defaultValue:string;example:string};
export function getComponentValueFormats(component:string):Record<string,Format> {
  return component==="Traits" ? {active:{encoding:"json-string-array",defaultValue:"[]",example:'["readable","examinable"]'}} : {};
}

export function assertComponentValueFormat(component:string,field:string,value:unknown):void {
  if(!Object.hasOwn(getComponentValueFormats(component),field)) return;
  let parsed:unknown;
  try {if(typeof value!=="string"||value.length>4000)throw new Error();parsed=JSON.parse(value);} catch {
    throw new Error(`${component}.${field} requires a JSON-encoded array of nonempty strings, not comma-separated text`);
  }
  if(!Array.isArray(parsed)||parsed.some(item=>typeof item!=="string"||!item.trim()))
    throw new Error(`${component}.${field} requires a JSON-encoded array of nonempty strings`);
}

/** Preflight the entire incoming patch before changing membership or scalars.
 * Omitted encoded fields get safe defaults only on fresh component attachment. */
export function prepareComponentEncodedValues(component:string,values:Record<string,unknown> = {},initialize=false):Record<string,unknown> {
  const defaults=initialize?Object.fromEntries(Object.entries(getComponentValueFormats(component)).map(([field,format])=>[field,format.defaultValue])):{};
  const prepared={...defaults,...values};
  for(const [field,value] of Object.entries(prepared)) assertComponentValueFormat(component,field,value);
  return prepared;
}
