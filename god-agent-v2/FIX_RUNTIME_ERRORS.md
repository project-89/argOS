# Runtime Error Fixes

## Issues Identified

### 1. "Cannot set properties of undefined (setting '11')"
This error occurs when systems try to set string properties that haven't been properly initialized.

### 2. "InChatRoom is not defined"
Missing component dependencies - components used in systems but not declared in `requiredComponents`.

### 3. Incorrect getString/setString usage
The stub implementations weren't properly handling component property arrays.

## Fixes Applied

### 1. Enhanced System Context
Updated `system-executor.ts` to include ALL BitECS functions in the sandbox:
- Core functions: `query`, `addEntity`, `removeEntity`, `addComponent`, `removeComponent`, `hasComponent`, `entityExists`
- Query operators: `And`, `Or`, `Not`, `All`, `Any`, `None`
- Wildcard support for relations
- Proper string utilities from `god-components.js`

### 2. Fixed String Handling
```typescript
// OLD (broken)
context.getString = (hashValue) => `string_${hashValue}`;
context.setString = (value) => value.charCodeAt(0) * 1000;

// NEW (correct)
context.getString = (componentProp, eid) => {
  if (!componentProp || !componentProp[eid]) return '';
  return realGetString(componentProp[eid]);
};

context.setString = (componentProp, eid, value) => {
  if (!componentProp) {
    console.error('[setString] Component property is undefined');
    return;
  }
  const hash = storeString(value);
  componentProp[eid] = hash;
};
```

### 3. Updated API Documentation
Enhanced the system prompt and generation tools with correct string handling examples:
```javascript
// For string components like NPC.message
setString(NPC.message, eid, "Hello world");
const msg = getString(NPC.message, eid);
```

## How to Use

### For String Components
When creating components with string properties, the system generates:
```typescript
const Message = {
  content: [] as number[],      // Hash storage
  contentStore: {} as Record<number, string>  // String storage
};
```

In systems, use the helper functions:
```javascript
// Setting a string value
setString(Message.content, eid, "Hello!");

// Getting a string value  
const text = getString(Message.content, eid);
```

### For Missing Dependencies
Always declare ALL components used in a system:
```javascript
// If system uses Player, InRoom, and ChatMessage
requiredComponents: ["Player", "InRoom", "ChatMessage"]
```

## Testing the Fixes

To verify these fixes work:

1. **Clear and restart**:
   ```
   /clear
   ```

2. **Create a test simulation**:
   ```
   Create a chat room with 3 NPCs that can send messages
   ```

3. **Check for errors**:
   ```
   Check for system errors and fix them
   ```

The system should now:
- ✅ Properly handle string components
- ✅ Include all required dependencies
- ✅ Use correct BitECS API functions
- ✅ Execute without "Cannot set properties of undefined" errors

## Diagnostic Tool

Run the diagnostic tool to check system health:
```bash
tsx diagnose-system.ts
```

This will show:
- All registered systems and their dependencies
- Any missing components
- Recent error messages
- Component properties and types