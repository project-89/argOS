# God Agent V2 Performance Analysis

## Current Performance Issues

### 1. **Model Size & Latency**
- **Model**: `gemini-2.5-pro-preview-06-05` (very large, experimental)
- **Latency**: 5-15 seconds per request
- **Token Limits**: 8000 output tokens

### 2. **Tool Overhead**
```
Calling AI with 17 tools available
```
- Each tool has a detailed schema
- Tool descriptions are sent with EVERY request
- Estimated: ~2000-3000 tokens just for tool definitions

### 3. **System Prompt Size**
- Base system prompt: ~500 tokens
- Workflow instructions: ~300 tokens
- Total context before user input: ~3000+ tokens

### 4. **Message History**
- Keeps last 50 messages
- Each tool call adds multiple messages
- Can grow to 10,000+ tokens quickly

## Performance Bottlenecks

### 1. **Every Request Includes:**
```
System Prompt (500 tokens)
+ 17 Tool Definitions (2500 tokens)
+ Message History (0-10,000 tokens)
+ User Input (10-100 tokens)
= 3,000-13,000 tokens per request
```

### 2. **Tool-Calling Overhead**
- Model must parse all 17 tools
- Decides which tool(s) to use
- Generates proper parameters
- This adds cognitive load

### 3. **Multi-Step Operations**
- Simple requests often trigger multiple tool calls
- Each tool call is a separate LLM inference
- 5 tool calls = 5x the latency

## Optimization Strategies

### Quick Wins (Easy)

#### 1. Use Faster Model for Simple Tasks
```typescript
// For simple operations
const fastModel = google('gemini-1.5-flash');

// For complex generation
const powerfulModel = google('gemini-2.5-pro-preview-06-05');
```

#### 2. Reduce Tool Count
```typescript
// Context-aware tool loading
function createAutonomousTools(god: AutonomousGodState, mode: 'build' | 'test' | 'manage') {
  if (mode === 'build') {
    return { generateComponent, generateSystem, createEntity, runSystem };
  } else if (mode === 'test') {
    return { testSimulation, checkBehavior, inspectWorld };
  }
  // etc...
}
```

#### 3. Compress System Prompt
```typescript
const CONCISE_SYSTEM_PROMPT = `ECS God Agent. Create components (data), systems (behavior), entities (instances).
Tools: generate, create, test, inspect. Be concise.`;
```

### Medium Improvements

#### 4. Implement Streaming
```typescript
const result = await generateText({
  model,
  messages,
  tools,
  streamText: true,
  onChunk: (chunk) => {
    // Show progress to user
    process.stdout.write(chunk);
  }
});
```

#### 5. Cache Common Operations
```typescript
const componentCache = new Map<string, any>();

// Cache component generation patterns
if (componentCache.has('Position')) {
  return componentCache.get('Position');
}
```

#### 6. Parallel Processing
```typescript
// When creating multiple components
const components = await Promise.all([
  generateComponent('Position'),
  generateComponent('Velocity'),
  generateComponent('Health')
]);
```

### Advanced Optimizations

#### 7. Tool Routing Layer
```typescript
// Pre-classify intent with fast model
const intent = await classifyIntent(input); // 'create-component', 'test', etc.

// Load only relevant tools
const tools = getToolsForIntent(intent);
```

#### 8. Lazy Message History
```typescript
// Only include relevant history
const relevantHistory = god.messages.filter(msg => 
  msg.timestamp > Date.now() - 300000 // Last 5 minutes
);
```

#### 9. Progressive Enhancement
```typescript
// Start with basic response, enhance if needed
const quickResponse = await fastModel.generate(input);
if (needsMoreDetail(quickResponse)) {
  const detailedResponse = await powerfulModel.enhance(quickResponse);
}
```

## Recommended Implementation

### Phase 1: Quick Wins (1-2 hour fix)
1. Add model selection based on task complexity
2. Reduce system prompt size
3. Implement basic streaming

### Phase 2: Smart Tools (2-4 hours)
1. Context-aware tool loading
2. Tool grouping by function
3. Compress tool descriptions

### Phase 3: Advanced (4-8 hours)
1. Intent classification router
2. Response caching
3. Parallel operations

## Expected Performance Gains

### Current State
- Simple request: 5-10 seconds
- Complex operation: 15-30 seconds
- Multi-step: 30-60 seconds

### After Optimization
- Simple request: 1-3 seconds (using Flash)
- Complex operation: 5-10 seconds (reduced context)
- Multi-step: 10-20 seconds (parallel + caching)

## Model Comparison

| Model | Speed | Quality | Cost | Use Case |
|-------|-------|---------|------|----------|
| gemini-1.5-flash | ⚡⚡⚡⚡⚡ | ★★★ | $ | Quick operations, intent routing |
| gemini-1.5-pro | ⚡⚡⚡ | ★★★★ | $$ | Standard generation |
| gemini-2.0-flash | ⚡⚡⚡⚡ | ★★★★ | $$ | Good balance |
| gemini-2.5-pro-preview | ⚡ | ★★★★★ | $$$$ | Complex generation only |