# JSON Parse Error Fix

## The Error
```
System Error: SyntaxError: Unexpected token 'T', "The user h"... is not valid JSON
at JSON.parse (<anonymous>)
```

## Root Cause
The AI-generated LLM system is calling `JSON.parse()` on a response from `miniLLM()`, but `miniLLM()` returns plain text, not JSON. The AI doesn't always respond with JSON even when asked.

## Key Understanding
- `miniLLM()` returns a `Promise<string>` with RAW TEXT
- It does NOT automatically return JSON
- Even if you ask for JSON in the prompt, the AI might return plain text

## ❌ WRONG - Assuming JSON response
```javascript
const response = await miniLLM("What should the NPC say?");
const data = JSON.parse(response); // CRASHES if response is "Hello there!"
```

## ✅ CORRECT - Safe JSON parsing
```javascript
const response = await miniLLM("Respond with JSON: {action: 'speak', text: '...'}");
let action = 'speak';
let text = 'Hello';

try {
  const data = JSON.parse(response);
  action = data.action || 'speak';
  text = data.text || 'Hello';
} catch (e) {
  // Fallback: treat entire response as the text
  text = response;
}
```

## Best Practices

### 1. Always Use Try/Catch
```javascript
try {
  const data = JSON.parse(response);
  // Use data...
} catch (e) {
  // Handle plain text response
  console.log('Got plain text response:', response);
}
```

### 2. Be Explicit About JSON in Prompts
```javascript
// Good prompts for JSON:
"Respond ONLY with valid JSON in this format: {action: string, message: string}"
"Return a JSON object with fields: {mood: string, response: string}"

// Bad prompts (might return plain text):
"What should the NPC do?"
"How does the character respond?"
```

### 3. Have Sensible Defaults
```javascript
// Define defaults before parsing
let npcAction = 'idle';
let npcMessage = 'Hello traveler';
let npcMood = 'neutral';

try {
  const data = JSON.parse(response);
  npcAction = data.action || npcAction;
  npcMessage = data.message || npcMessage;
  npcMood = data.mood || npcMood;
} catch (e) {
  // Use defaults or treat response as message
  npcMessage = response;
}
```

### 4. Consider Response Format
Sometimes it's better to NOT use JSON:
```javascript
// For simple responses, just use plain text
const response = await miniLLM(`${getString(Character.name, eid)} sees a dragon. What do they say?`);
setString(Character.dialogue, eid, response); // No JSON needed!

// Use JSON only for structured data
const response = await miniLLM(`Analyze ${getString(Character.name, eid)}'s mood. Return JSON: {mood: string, confidence: number}`);
try {
  const analysis = JSON.parse(response);
  // Use structured data...
} catch (e) {
  // Fallback to simple parsing or defaults
}
```

## Common Patterns

### NPC Dialogue System
```javascript
async function NPCDialogueSystem(world) {
  const npcs = query(world, [Character, InConversation]);
  
  for (const eid of npcs) {
    const context = getString(Character.context, eid);
    const prompt = `${context}\nRespond naturally as this character would speak.`;
    
    // Get plain text response - no JSON needed for dialogue
    const response = await miniLLM(prompt);
    setString(Character.lastDialogue, eid, response);
  }
}
```

### Complex Decision System
```javascript
async function NPCDecisionSystem(world) {
  const npcs = query(world, [Character, NeedsDecision]);
  
  for (const eid of npcs) {
    const situation = getString(Character.situation, eid);
    const prompt = `${situation}\nDecide the NPC's action. Return JSON: {action: "fight"|"flee"|"talk", confidence: 0-100}`;
    
    const response = await miniLLM(prompt);
    
    // Safe parsing with defaults
    let action = 'talk';
    let confidence = 50;
    
    try {
      const decision = JSON.parse(response);
      action = decision.action || 'talk';
      confidence = decision.confidence || 50;
    } catch (e) {
      // Fallback: try to extract action from plain text
      if (response.toLowerCase().includes('fight')) action = 'fight';
      else if (response.toLowerCase().includes('flee')) action = 'flee';
    }
    
    // Use the parsed or fallback values
    setString(Character.currentAction, eid, action);
    Character.actionConfidence[eid] = confidence;
  }
}
```

## Debugging Tips

1. **Log the raw response** to see what miniLLM actually returned:
   ```javascript
   const response = await miniLLM(prompt);
   console.log('Raw miniLLM response:', response);
   ```

2. **Check if response looks like JSON** before parsing:
   ```javascript
   if (response.trim().startsWith('{') && response.trim().endsWith('}')) {
     try {
       const data = JSON.parse(response);
     } catch (e) {
       console.error('Response looked like JSON but failed to parse:', response);
     }
   } else {
     // Handle as plain text
   }
   ```

3. **Use a JSON extraction helper**:
   ```javascript
   function extractJSON(text) {
     // Try to find JSON in the response
     const jsonMatch = text.match(/\{[\s\S]*\}/);
     if (jsonMatch) {
       try {
         return JSON.parse(jsonMatch[0]);
       } catch (e) {
         return null;
       }
     }
     return null;
   }
   ```