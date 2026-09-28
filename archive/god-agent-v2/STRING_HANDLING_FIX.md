# String Handling Fix Documentation

## Problem
The AI was generating regular (non-async) systems that tried to use `getString` and `setString` functions, which are only available in async/LLM systems. This caused runtime errors: `ReferenceError: getString is not defined`.

## Root Cause
The prompts weren't clear enough about the distinction between:
1. **Regular Systems** - Synchronous functions that run game logic
2. **Async/LLM Systems** - Asynchronous functions that can call AI and use special string utilities

## Solution Implemented

### 1. Updated System Generation Prompt (`generate-system.ts`)
- Added CRITICAL note that regular systems CANNOT use getString/setString
- Added section "What you CANNOT use in regular systems"
- Clarified that strings are stored as number hashes automatically

### 2. Updated System Modification Prompt (`modify-system.ts`)
- Changed string handling section to emphasize getString/setString are ONLY for async systems
- Added specific fix instructions for getString/setString errors
- Points 6 & 7 now explicitly address these errors

### 3. Updated Autonomous God Prompt (`autonomous-god.ts`)
- Renamed section to "ONLY Available in Async/LLM Systems"
- Added "NOT Available in Regular Systems" section
- Enhanced debugging guide with specific getString/setString error fixes

## How It Works

### Regular Systems
```javascript
// Strings are stored as hashes automatically
function ChatSystem(world) {
  const chatters = query(world, [Chat]);
  for (const eid of chatters) {
    // Chat.message[eid] is a number hash, not a string
    // This is handled automatically by the component system
    if (Chat.message[eid] > 0) {
      console.log(`Entity ${eid} has a message`);
    }
  }
}
```

### Async/LLM Systems
```javascript
async function NPCResponseSystem(world) {
  const npcs = query(world, [NPC, Chat]);
  for (const eid of npcs) {
    // Only async systems can use getString/setString
    const lastMessage = getString(Chat.message, eid);
    const response = await miniLLM(`Reply to: ${lastMessage}`);
    setString(Chat.message, eid, response);
  }
}
```

## Impact
Now when the AI sees getString/setString errors, it will:
1. Recognize the system is not async
2. Use modifySystem to remove getString/setString usage
3. Work with the automatic hash-based string storage instead

## Testing
Try creating a chat simulation - the regular systems should no longer attempt to use getString/setString functions.