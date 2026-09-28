# System Type Guide: Regular vs LLM Systems

## Quick Decision Guide

### Use `generateSystem` (Regular) when:
- ✅ You only need to work with numbers, booleans, entity IDs
- ✅ You're doing physics, movement, health calculations
- ✅ You're checking relationships between entities
- ✅ You DON'T need to read the actual text of strings
- ✅ You DON'T need AI decision making

### Use `generateLLMSystem` (Async/LLM) when:
- ✅ You need to READ string values (names, messages, descriptions)
- ✅ You need AI to make decisions
- ✅ You're processing natural language
- ✅ You're generating dynamic content
- ✅ You need `getString()` or `setString()` functions

## The Key Difference: String Handling

### Regular Systems
```javascript
function ChatSystem(world) {
  const chatters = query(world, [Chat, Name]);
  for (const eid of chatters) {
    // ❌ CANNOT DO THIS - getString not available
    // const name = getString(Name.value, eid);
    
    // ✅ CAN DO THIS - work with the hash number
    if (Chat.messageHash[eid] > 0) {
      console.log(`Entity ${eid} has a message`);
    }
  }
}
```

### LLM Systems
```javascript
async function ChatResponseSystem(world) {
  const chatters = query(world, [Chat, Name]);
  for (const eid of chatters) {
    // ✅ CAN DO THIS - getString is available
    const name = getString(Name.value, eid);
    const message = getString(Chat.message, eid);
    
    // ✅ CAN ALSO USE AI
    const response = await miniLLM(`${name} said: ${message}. Reply:`);
    setString(Chat.message, eid, response);
  }
}
```

## Common Mistakes and Fixes

### Mistake 1: Using getString in Regular System
**Error**: `ReferenceError: getString is not defined`
**Fix**: Either:
- Remove the need to read strings (just work with hashes)
- OR recreate as an LLM system if you MUST read strings

### Mistake 2: Creating LLM System for Simple Logic
**Issue**: Unnecessary complexity and slower execution
**Fix**: Use regular `generateSystem` if you don't need string reading or AI

### Mistake 3: Trying llmModel:"none"
**Error**: `Invalid enum value. Expected 'flash' | 'flash25' | 'pro'`
**Fix**: Use `generateSystem` instead - LLM systems MUST have an AI model

## Examples

### Good Regular System
```javascript
// Movement doesn't need string reading
function MovementSystem(world) {
  const movers = query(world, [Position, Velocity]);
  for (const eid of movers) {
    Position.x[eid] += Velocity.dx[eid];
    Position.y[eid] += Velocity.dy[eid];
  }
}
```

### Good LLM System
```javascript
// Chat needs to read/write actual strings
async function ChatAISystem(world) {
  const npcs = query(world, [NPC, Chat]);
  for (const eid of npcs) {
    const lastMessage = getString(Chat.lastMessage, eid);
    if (lastMessage) {
      const response = await miniLLM(`Reply to: ${lastMessage}`);
      setString(Chat.response, eid, response);
    }
  }
}
```

## Rule of Thumb

When in doubt, ask yourself:
1. Do I need to read the actual text content? → Use LLM System
2. Do I need AI to make decisions? → Use LLM System
3. Otherwise → Use Regular System

Regular systems are faster and simpler. Only use LLM systems when you actually need their special capabilities!