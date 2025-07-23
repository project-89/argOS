# Entity Creation Parameter Fix

## The Error
```
Invalid arguments for tool createEntity: Type validation failed
Required parameter "purpose" is missing
```

## The Issue
The `createEntity` tool requires BOTH:
- `description` - What the entity IS
- `purpose` - What the entity is FOR

The AI was only providing `description`.

## Examples of Correct Usage

### Creating an NPC
```javascript
{
  description: "An NPC with a witty and curious personality",
  purpose: "To engage players in conversation and provide quest hints",
  traits: ["witty", "curious", "helpful"],
  name: "Alice"
}
```

### Creating a Game Object
```javascript
{
  description: "A bouncing ball with physics",
  purpose: "To demonstrate the physics system",
  traits: ["bouncy", "red"],
  name: "Ball1"
}
```

### Creating a System Entity
```javascript
{
  description: "A neuron that can fire",
  purpose: "To simulate neural activity in the brain network",
  traits: ["excitable", "connected"]
}
```

## Why Both Parameters?

- **description**: The "what" - physical/conceptual description
- **purpose**: The "why" - its role in the larger simulation

This helps the AI:
1. Choose appropriate components
2. Set suitable initial values
3. Understand how the entity fits into the simulation

## Quick Rule

When creating entities, always ask:
- What IS it? → description
- What is it FOR? → purpose