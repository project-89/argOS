# God Agent V2 - Runtime Capabilities

## How Long Can It Run?

The agent uses the **Vercel AI SDK** with configurable limits:

### Default Mode (`npm run cli`)
- **Max Steps**: 50 tool calls per request
- **Max Tokens**: 8,000 per response
- **Message History**: Last 50 messages kept
- **Typical Duration**: 30 seconds to 2 minutes per task

### Continuous Mode (`npm run cli:continuous`)
- **/continuous <task>**: 100 steps (5-10 minutes)
- **/unlimited <task>**: 1,000 steps (until done!)
- **Adaptive**: Agent decides when it's finished

## Yes, It Can Build Until Done!

The agent has true autonomy to:
1. **Analyze** the complexity of your request
2. **Plan** what components/systems are needed
3. **Build** everything step by step
4. **Test** by running systems
5. **Iterate** if needed
6. **Decide** when the simulation is complete

## Examples of Extended Building

### Complex Neural Network
```
/continuous Build a 3-layer neural network with:
- Input layer (784 neurons for MNIST)
- Hidden layer (128 neurons with ReLU)
- Output layer (10 neurons with softmax)
- Forward propagation system
- Backpropagation system
- Training loop
```

The agent would:
- Create ~7-10 components (Neuron, Layer, Weight, Bias, Activation, etc.)
- Generate ~5-6 systems (ForwardPass, Backprop, WeightUpdate, etc.)
- Spawn 922 neuron entities
- Create thousands of weight relationships
- Run training iterations

### Complete Ecosystem
```
/unlimited Create a complete ecosystem with:
- Plants that grow and reproduce
- Herbivores that eat plants
- Carnivores that hunt herbivores
- Energy transfer and metabolism
- Birth and death cycles
- Environmental factors (weather, seasons)
```

The agent would create 20+ components and systems, potentially taking 100+ steps.

## Technical Details

### Vercel AI SDK Features Used
- **generateText()** with tool calling
- **maxSteps** for extended conversations
- **Tool calling** for autonomous actions
- **Message history** for context
- **Streaming** support (could be added)

### Current Limits
1. **API Rate Limits**: Gemini API has rate limits
2. **Context Window**: ~1M tokens for Gemini 2.5 Pro
3. **Memory**: Message history trimmed at 50 messages
4. **Timeout**: None built-in (agent decides when done)

### Future Enhancements
- **Streaming**: Show real-time progress
- **Checkpointing**: Save/resume long builds
- **Parallel Building**: Multiple systems at once
- **Memory Optimization**: Smarter context management

## The Philosophy

The agent embodies "**Latent Space Extraction**" - the idea that LLMs contain complete simulations within their weights. By giving it tools and autonomy, we're letting it extract and manifest these latent simulations into working ECS architectures.

In theory, given enough steps and the right prompt, it could build:
- Entire game worlds
- Complex scientific simulations  
- Multi-agent societies
- Living knowledge graphs
- Self-modifying systems

The only limits are imagination and API quotas!