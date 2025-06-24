# God Agent V2 Troubleshooting Guide

## Common Issues and Solutions

### 🔴 "Component is not defined" Errors

**Symptom**: Systems fail with ReferenceError saying a component is not defined

**Cause**: System is trying to use a component that isn't in its dependencies

**Solution**: 
```
Check for system errors and fix any missing dependencies
```

The God agent will automatically update the system's required components.

### 🔴 "Cannot read properties of undefined" Errors

**Symptom**: TypeError: Cannot read properties of undefined (reading '7')

**Cause**: System is trying to access component properties incorrectly or component arrays aren't initialized

**Common Issues**:
- Using `world.query` instead of `query(world, [...])`
- Accessing components like `eid.Position.x` instead of `Position.x[eid]`
- Missing component dependencies

**Solution**:
```
Fix the system to use proper BitECS API - components must be accessed as arrays
```

### 🔴 "world.query is not a function" Errors

**Symptom**: TypeError: world.query is not a function

**Cause**: System is using incorrect BitECS API syntax

**Solution**: Use the correct syntax:
- **CORRECT**: `const entities = query(world, [Position, Velocity]);`
- **WRONG**: `const entities = world.query([Position, Velocity]);`

### 🔴 API Key Errors

**Symptom**: "unregistered callers" error message

**Solution**:
1. Copy `.env.example` to `.env`
2. Add your `GOOGLE_GENERATIVE_AI_API_KEY`
3. Restart the application

### 🔴 Web Visualizer Not Updating

**Symptom**: Web page shows old data after using `/clear`

**Solution**: This has been fixed! Update to the latest version. The `/clear` command now properly resets the visualizer.

### 🔴 JSON Parse Errors

**Symptom**: "Unexpected token / in JSON" errors

**Cause**: LLM generating JSON with comments

**Solution**: This has been fixed! The parser now strips comments automatically.

### 🔴 Systems Not Running

**Symptom**: Created systems don't execute

**Common Causes**:
1. Not in live mode - use `/live` to toggle
2. System has errors - ask God to check for errors
3. No entities match the system query

**Debug Steps**:
```
1. /inspect - Check what exists
2. Show me any system errors
3. /live - Toggle live mode
4. Run all systems once
```

### 🔴 Terminal Visualization Issues

**Symptom**: `/watch` shows empty or corrupted display

**Solution**:
1. Stop with Ctrl+C
2. Try again with `/watch`
3. Ensure terminal window is large enough

### 🔴 Model Not Found

**Symptom**: "Unknown model" error

**Solution**: Model names are case-sensitive. Use:
- `flashLite` (not `flashlite`)
- `flash25` (not `flash2.5`)
- `/model` to see all options

### 🔴 Save/Load Issues

**Symptom**: Can't save or load simulations

**Common Issues**:
1. **Filename has spaces**: Use quotes or underscores
2. **No .godsim extension**: Extension is added automatically
3. **File not found**: Use `/list` to see available files

### 🔴 Performance Issues

**Symptom**: Simulation running slowly

**Solutions**:
1. Switch to faster model: `/model flashLite`
2. Reduce entity count
3. Simplify systems
4. Turn off terminal visualization if active

## Pro Debugging Commands

### Check System Health
```
Show me all systems and their status
Are there any errors in the systems?
List all components and their properties
```

### Fix Common Issues
```
Fix any system errors you find
Update all systems to use the correct components
Check and fix any dependency issues
```

### Inspect Simulation State
```
/inspect
Show me what entities exist and their components
Display the current simulation statistics
What systems are currently active?
```

## When to Start Fresh

Use `/clear` when:
- Systems are in an unrecoverable error state
- You want to try a completely different simulation
- The world has become too complex
- You're testing something new

## Getting Help

1. Use `/help` for command list
2. Check `GOD_AGENT_COMPLETE.md` for examples
3. Review the error message carefully - God agent often provides hints
4. Try asking God to explain the error:
   ```
   What does this error mean and how do I fix it?
   ```

## Performance Tips

1. **Use the right model**:
   - `flashLite` - Fastest, good for iteration
   - `flash25` - Balanced (default)
   - `pro` - Highest quality, slower

2. **Keep simulations focused**:
   - Start simple, add complexity gradually
   - Create one system at a time
   - Test each addition before moving on

3. **Save working states**:
   - Use `/save` when things work well
   - Can always `/load` to return to good state

Remember: The God agent is designed to be self-healing. When in doubt, just describe what you want to happen!