# CLI Experience Guide

## Overview
God Agent V2 now has enhanced CLI interaction capabilities with real-time execution logging and I/O system generation.

## Live Mode Enhancements

### Starting Live Mode
```
/live on
```

When live mode starts, you'll now see:
- 🔴 Live execution logging enabled
- Real-time system execution logs
- Entity actions and thoughts
- Execution summaries every 5 seconds

### Log Output Format
```
[12:34:56] ⚙️  ChatSystem: Starting execution
[12:34:56] 💭 Entity 3 thinks: I wonder what the weather is like...
[12:34:56] 🎯 Entity 3: speaks "Hello there!"
[12:34:56] ⚙️  ChatSystem: Completed successfully
```

### Execution Summary
Every 5 seconds, you'll see:
```
📊 Execution Summary:
────────────────────────────────────
Systems Run:
  ChatSystem: 45 times
  MovementSystem: 45 times
  ThinkingSystem: 15 times

Active Entities: 3
Thoughts Generated: 12
────────────────────────────────────
```

## Creating Interactive Experiences

### 1. Output Systems
Create systems that display entity states:
```
Create an output system that shows when NPCs speak or take actions
```

### 2. Input Systems  
Create systems that handle user commands:
```
Create an input system that lets users send messages to NPCs with /tell <name> <message>
```

### 3. Interactive Systems
Create full interactive experiences:
```
Create an interactive system for a text adventure where users can explore rooms and interact with objects
```

## I/O System Examples

### Chat Room Display
```javascript
// Generated OutputSystem
function ChatRoomOutputIOSystem(world) {
  const speakers = query(world, [Speaking, Name]);
  
  for (const eid of speakers) {
    const name = getString(Name.value, eid);
    const message = getString(Speaking.message, eid);
    
    console.log(chalk.cyan(`[${name}]:`), message);
    logAction(eid, `said: ${message}`);
    
    // Clear speaking flag
    removeComponent(world, eid, Speaking);
  }
}
```

### Command Input System
```javascript
// Generated InputSystem
function CommandInputIOSystem(world) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  
  rl.on('line', (input) => {
    if (input.startsWith('/speak ')) {
      const message = input.substring(7);
      const player = query(world, [Player])[0];
      
      if (player) {
        addComponent(world, player, Speaking);
        setString(Speaking.message, player, message);
        logAction(player, `speaks: ${message}`);
      }
    }
  });
}
```

## Console Methods Available

All generated systems have access to:
- `console.log()` - General output
- `console.error()` - Error messages
- `console.warn()` - Warnings
- `console.info()` - Information
- `console.debug()` - Debug info

Plus special logging functions:
- `logAction(eid, action)` - Log entity actions
- `logThought(eid, thought)` - Log entity thoughts

## Tips for Better CLI Experience

1. **Use chalk for colors**:
   ```javascript
   console.log(chalk.green('✓ Success!'));
   console.log(chalk.red('✗ Failed!'));
   console.log(chalk.yellow('⚠ Warning!'));
   ```

2. **Format entity displays**:
   ```javascript
   console.log(chalk.bold(`=== ${entityName} ===`));
   console.log(`Health: ${chalk.green('████████')} 80/100`);
   console.log(`Status: ${chalk.yellow('In Combat')}`);
   ```

3. **Create status bars**:
   ```javascript
   const healthBar = '█'.repeat(health/10) + '░'.repeat(10-health/10);
   console.log(`HP: ${chalk.red(healthBar)} ${health}/100`);
   ```

4. **Use ASCII art for rooms**:
   ```javascript
   console.log(chalk.gray('╔════════════════╗'));
   console.log(chalk.gray('║   Town Square  ║'));
   console.log(chalk.gray('╚════════════════╝'));
   ```

## Common Patterns

### Live Status Display
```
Create an output system that shows a live status display with entity positions, health, and current actions, updated every frame
```

### Interactive Menu
```
Create an interactive system that shows a menu of actions when the user types /menu, letting them select options with number keys
```

### Entity Inspector
```
Create an output system that shows detailed information about an entity when it performs important actions
```

## Debugging with Logs

The execution logger helps debug your simulation:
- See which systems are running
- Track entity behaviors
- Identify performance issues
- Monitor AI thoughts

Use `/live off` to stop and see a final summary of all activity.