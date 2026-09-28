# Malformed Function Call Fix

## Problem
The API returns "MALFORMED_FUNCTION_CALL" errors when the AI tries to call tools incorrectly. This happens when:
- Too many tools are available (cognitive overload)
- Tool parameters are complex or ambiguous
- The AI is trying to do too many things at once

## Solution Implemented

### 1. **Enhanced Error Detection**
Added specific handling for MALFORMED_FUNCTION_CALL errors with helpful diagnostics:
```javascript
if (error.responseBody.includes('MALFORMED_FUNCTION_CALL')) {
  console.error('⚠️  Malformed function call detected!');
  console.error('This usually means:');
  console.error('  - The AI is confused about tool parameters');
  console.error('  - The prompt is too complex or ambiguous');
  console.error('  - Too many tools are available');
}
```

### 2. **Automatic Retry with Reduced Complexity**
When this error occurs, the system:
- Adds a system message asking for simpler approach
- Retries with reduced step count (max 10)
- Uses a reduced tool set

### 3. **Reduced Tool Set**
Created `createReducedAutonomousTools()` that only includes essential tools:
- narrate
- generateComponent
- generateSystem
- modifySystem
- createEntity
- inspectWorld
- runSystem
- checkSystemErrors

This reduces from ~20+ tools to 8 essential ones.

## Benefits

1. **Lower Cognitive Load**: Fewer tools = clearer decisions
2. **Simpler Parameters**: Essential tools have simpler interfaces
3. **Better Success Rate**: AI less likely to make malformed calls
4. **Automatic Recovery**: System self-heals when complexity issues arise

## Usage

The system automatically switches to reduced tools when:
- MALFORMED_FUNCTION_CALL errors occur
- The `reducedTools: true` option is passed
- The AI seems to be struggling with complexity

## Example Flow

1. User asks for complex task
2. AI tries with full tool set (20+ tools)
3. Gets MALFORMED_FUNCTION_CALL error
4. System detects error and logs helpful info
5. Automatically retries with:
   - Simplified prompt
   - Reduced tool set (8 tools)
   - Lower step count
6. Task completes successfully

## Future Improvements

1. **Dynamic Tool Selection**: Choose tools based on task type
2. **Progressive Complexity**: Start simple, add tools as needed
3. **Tool Grouping**: Present related tools together
4. **Better Tool Descriptions**: Make parameters even clearer