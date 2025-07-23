# Google API System Message Fix

## The Error
```
AI_UnsupportedFunctionalityError: 'system messages are only supported at the beginning of the conversation' functionality not supported.
```

## The Cause
Google's Gemini API has a restriction: system messages can ONLY appear at the beginning of a conversation, not in the middle. 

Our error recovery code was trying to add a system message mid-conversation to help the AI recover from errors.

## The Fix
Changed from:
```javascript
god.messages.push({ 
  role: 'system', 
  content: 'The previous tool call was malformed...' 
});
```

To:
```javascript
god.messages.push({ 
  role: 'assistant', 
  content: 'I encountered a malformed function call error. Let me try a simpler approach...' 
});
```

## Why This Works
- Assistant messages can appear anywhere in the conversation
- The AI still understands it should adjust its approach
- Google's API accepts this format

## Additional Fixes
- Also fixed `NodeJS.Timer` deprecation warning by changing to `NodeJS.Timeout`

## Impact
Error recovery will now work properly without triggering API errors. The AI can still recover from malformed function calls by using the reduced tool set approach.