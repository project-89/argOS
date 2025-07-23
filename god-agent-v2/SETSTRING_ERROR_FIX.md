# setString Error Fix

## The Error
```
System execution error: TypeError: Cannot create property 'undefined' on string '...'
```

## Root Cause
The AI-generated LLM systems are calling `setString` incorrectly. This happens because the AI confuses the parameter order or tries to pass a value instead of the component property array.

## Common Mistakes

### ❌ WRONG - Passing value instead of component property
```javascript
// This is what generated systems often do wrong:
setString(Message.content[eid], "Hello world");
// Message.content[eid] is a NUMBER (hash), not the property array!
```

### ❌ WRONG - Missing parameters
```javascript
setString(Message.content, "Hello world");
// Missing the entity ID parameter!
```

### ✅ CORRECT - Proper usage
```javascript
// setString takes 3 parameters: componentProp, entityId, stringValue
setString(Message.content, eid, "Hello world");

// getString takes 2 parameters: componentProp, entityId  
const message = getString(Message.content, eid);
```

## How It Works

1. **Component properties are arrays**: `Message.content` is an array where indices are entity IDs
2. **Arrays store hashes**: `Message.content[eid]` contains a numeric hash, not the actual string
3. **setString/getString handle the conversion**: They convert between strings and hashes

```javascript
// What setString does internally:
setString(Message.content, eid, "Hello") {
  const hash = storeString("Hello");  // Convert string to hash
  Message.content[eid] = hash;         // Store hash in array
}

// What getString does internally:
getString(Message.content, eid) {
  const hash = Message.content[eid];   // Get hash from array
  return realGetString(hash);          // Convert hash to string
}
```

## Quick Reference

### For LLM System Generation
```javascript
// Reading strings
const name = getString(Character.name, eid);
const dialogue = getString(Character.dialogue, eid);

// Writing strings  
setString(Character.name, eid, "Alice");
setString(Character.dialogue, eid, "Hello there!");

// Using in AI prompts
const context = `Character ${getString(Character.name, eid)} says: ${getString(Character.dialogue, eid)}`;
const response = await miniLLM(context);
setString(Character.dialogue, eid, response);
```

### Common Patterns
```javascript
// Loop through entities with string components
for (const eid of entities) {
  const currentThought = getString(Mind.thought, eid);
  const newThought = await miniLLM(`Current thought: ${currentThought}. What next?`);
  setString(Mind.thought, eid, newThought);
}

// Initialize string components
const newEntity = addEntity(world);
addComponent(world, newEntity, Character);
setString(Character.name, newEntity, "New Character");
setString(Character.description, newEntity, "A mysterious figure");
```

## Debugging Tips

1. **Check the error details**: The enhanced error messages now show what type was passed
2. **Verify component property exists**: Make sure the component and property are defined
3. **Check entity ID is valid**: Ensure the entity exists and is a number
4. **Use console logs**: Add logging to see what values are being passed

```javascript
console.log('Setting string for entity', eid);
console.log('Component property:', Message.content); // Should be an array
console.log('Current value:', Message.content[eid]); // Should be a number (hash)
setString(Message.content, eid, "New message");
```

## Prevention

When instructing the AI to generate LLM systems, emphasize:
- `setString` takes THREE parameters: component property, entity ID, string value
- The first parameter is the property array (e.g., `Message.content`), NOT a value from the array
- Always show examples in the prompt to guide correct usage