# God Agent V2 - Quick Start 🚀

## Running God Agent

```bash
# Main command - starts God with web visualization on port 8081
npm run run

# Then open: http://localhost:8081
```

## Available Models

Switch models with `/model <name>`:
- `flash` - Gemini 1.5 Flash (Fast)
- `flash25` - Gemini 2.0 Flash (Default, Smart & Fast) ⭐
- `flashLite` - Gemini 2.5 Flash Lite (⚡ BLAZING FAST)
- `pro` - Gemini 1.5 Pro (Quality)
- `proPreview` - Gemini 2.5 Pro Preview (Highest Quality)

## Example Commands

```bash
# Simple particle system
Create 5 bouncing particles with physics

# With custom UI
Create a particle system and generate a beautiful UI with glowing trails

# Social simulation
Build a chat room with 3 NPCs that talk to each other

# Neural network
Simulate 10 neurons forming a simple neural network

# Text adventure
Create a text adventure game with 3 rooms and a hero
```

## UI Generation

When generating UI, use these exact values:
- **interactionType**: `"view-only"`, `"interactive"`, or `"game"`
- **style**: `"minimal"`, `"rich"`, `"game-like"`, or `"artistic"`

Example:
```
Generate a rich interactive UI for the particle system with trails
```

## Troubleshooting

### API Key Error
Make sure you have a `.env` file with:
```
GOOGLE_GENERATIVE_AI_API_KEY=your-api-key-here
```

### Port Already in Use
The visualizer runs on port 8081. If that's taken, edit `run-god.ts` to use a different port.

### Token Limit Errors
- Switch to a faster model: `/model flashLite`
- Or simplify your requests

## Features

- 🌐 **Universal Web Visualization** - Adapts to any simulation type
- 🎨 **Dynamic UI Generation** - God creates custom interfaces 
- ⚡ **Blazing Fast Models** - Gemini 2.5 Flash Lite support
- 🧠 **AI-Powered Systems** - Entities can think and make decisions
- 💾 **Persistence** - Save/load simulations as .godsim files
- 🔧 **Self-Healing** - God can detect and fix broken systems

Enjoy creating! 🌟