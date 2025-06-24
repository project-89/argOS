# AI Model Switching Guide

## New Feature: On-the-fly Model Selection

You can now switch AI models in real-time to optimize for speed or quality!

## Available Models

| Model Key | Name | Speed | Intelligence | Best For |
|-----------|------|-------|--------------|----------|
| `auto` | Automatic | Varies | Varies | Default - picks best for task |
| `flash` | Gemini 1.5 Flash | ⚡⚡⚡⚡⚡ | ★★★ | Simple queries, lists |
| `flash25` | **Gemini 2.0 Flash** ⭐ | ⚡⚡⚡⚡ | ★★★★ | **Recommended! Smart & fast** |
| `flashLatest` | Gemini 2.0 Flash Exp | ⚡⚡⚡⚡ | ★★★★ | Experimental features |
| `pro` | Gemini 1.5 Pro | ⚡⚡ | ★★★★★ | Complex generation |
| `proPreview` | Gemini 2.5 Pro Preview | ⚡ | ★★★★★★ | Highest quality, slow |

## How to Use

### Check Current Model
```bash
🌟 > /model

🤖 AI Model Settings:

Current: Automatic selection

Available models:
  • auto - Automatic selection based on task
  • flash - Gemini 1.5 Flash (Fastest)
  • flash25 - Gemini 2.0 Flash (Smart & Fast) ⭐
  • flashLatest - Gemini 2.0 Flash Exp
  • pro - Gemini 1.5 Pro (Quality)
  • proPreview - Gemini 2.5 Pro Preview (Highest Quality)
```

### Switch Models
```bash
# Use the smartest flash model
🌟 > /model flash25
✅ Model switched to: Gemini 2.0 Flash (Smart & Fast)

# Use highest quality for complex work
🌟 > /model proPreview
✅ Model switched to: Gemini 2.5 Pro Preview (Highest Quality)

# Return to automatic selection
🌟 > /model auto
✅ Model selection set to automatic
```

## Performance Comparison

### Simple Query: "list components"
- `flash`: 0.5s
- `flash25`: 0.7s ⭐ Better quality
- `pro`: 2.0s

### Component Creation
- `flash`: 1.5s (may miss details)
- `flash25`: 2.0s ⭐ Good balance
- `pro`: 4.0s (highest quality)

### Complex System Generation
- `flash25`: 3-5s ⭐ Surprisingly good
- `pro`: 5-8s
- `proPreview`: 10-15s (best for very complex)

## Recommendations

### For Most Users: `flash25`
The new Gemini 2.0 Flash model offers:
- 🚀 Fast responses (2-3s average)
- 🧠 High intelligence 
- 💰 Cost effective
- ✅ Great for 90% of tasks

### When to Use Others:
- **`flash`**: Ultra-fast queries, simple commands
- **`pro`**: Complex multi-component systems
- **`proPreview`**: Research-grade simulations, maximum quality

## Examples

### Fast Development Mode
```bash
🌟 > /model flash25
🌟 > create a game with players and enemies
# Fast, intelligent responses
```

### High Quality Mode
```bash
🌟 > /model pro
🌟 > create a biologically accurate neuron simulation
# Detailed, accurate implementation
```

### Speed Mode
```bash
🌟 > /model flash
🌟 > list all systems
🌟 > show entity count
# Instant responses
```

## Auto Mode Logic

When set to `auto`, the system picks:
- Commands (`/...`) → Flash
- Queries (`list`, `show`) → Flash
- Testing (`test`, `check`) → Flash 2.0
- Creation (`create`, `build`) → Pro
- Complex tasks → Pro Preview

The model switching feature gives you complete control over the speed/quality tradeoff!