# API Error Logging Enhancement

## Problem
The error `AI_APICallError: Invalid JSON response` was occurring without enough context to debug what was causing it.

## Solution
Added comprehensive error logging to capture:

### 1. Response Body
- Logs the first 1000 characters of the response body
- Helps identify what the API actually returned
- Shows if it's HTML error page, rate limit message, etc.

### 2. Error Details
- Error name, message, and cause
- Response body preview
- Structured error object logging

### 3. Common Issue Detection
- Rate limiting (429 errors)
- Service unavailable (503 errors)
- Provides user-friendly messages for known issues

## Implementation

### In autonomous-god.ts
```typescript
if (error?.name === 'AI_APICallError' && error.message.includes('Invalid JSON response')) {
  console.error(chalk.red('\n❌ API returned invalid JSON'));
  console.error(chalk.yellow('Error details:'), {
    name: error.name,
    message: error.message,
    responseBody: error.responseBody?.substring?.(0, 500) || 'No response body',
    cause: error.cause
  });
  
  // Log response body
  if (error.responseBody) {
    console.error(chalk.yellow('\nResponse body preview:'));
    console.error(error.responseBody.substring(0, 1000));
    
    // Check for common issues
    if (error.responseBody.includes('429') || error.responseBody.includes('rate limit')) {
      console.error(chalk.red('\n⚠️  Rate limit detected! Please wait a moment before trying again.'));
    }
  }
}
```

### In llm/interface.ts
```typescript
if (error?.name === 'AI_APICallError') {
  console.error(chalk.red('\n❌ Structured generation API error'));
  console.error('Error type:', error.name);
  console.error('Message:', error.message);
  
  if (error.responseBody) {
    console.error(chalk.yellow('\nAPI Response Body (first 500 chars):'));
    console.error(error.responseBody.substring(0, 500));
  }
}
```

## Benefits

Now when API errors occur, you'll see:
- What the API actually returned (HTML error page, JSON fragment, etc.)
- Whether it's a rate limit issue
- Whether the service is temporarily unavailable
- Enough context to debug the root cause

## Common Causes of Invalid JSON Response

1. **Rate Limiting** - Too many requests to the API
2. **Token Limits** - Response was truncated
3. **Service Issues** - API returning error pages instead of JSON
4. **Network Issues** - Partial responses or timeouts