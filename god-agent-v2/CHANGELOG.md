# God Agent V2 Changelog

## [Latest] - 2024-01-24

### ✨ Component Awareness Enhancement

#### Added Component Registry Visibility
- **Problem**: AI was guessing component names, causing "Required component X does not exist" errors
- **Solution**: All system generation prompts now show available components from the registry
- **Files Changed**: `generate-system.ts`, `generate-llm-system.ts`, `modify-system.ts`
- **Impact**: Systems now use correct component names, dramatically reducing creation failures

### 🐛 Runtime Error Fixes

#### Fixed "Cannot set properties of undefined" Errors
- **Problem**: Systems trying to set string properties on undefined component arrays
- **Solution**: Fixed getString/setString implementations to properly handle component property arrays
- **Files Changed**: `system-executor.ts`

#### Enhanced System Sandbox Context
- **Problem**: Missing BitECS functions causing "world.query is not a function" errors
- **Solution**: Added all BitECS core functions, query operators, and utilities to sandbox
- **Includes**: `And`, `Or`, `Not`, `All`, `Any`, `None`, `Wildcard` support

#### Fixed String Component Handling
- **Problem**: Stub string utilities weren't working with actual component storage
- **Solution**: Imported real string utilities from `god-components.js`
- **Impact**: String components now properly store and retrieve values

## [2024-01-23]

### 🐛 Bug Fixes

#### Fixed `/clear` Command Web Visualizer Issue
- **Problem**: When using `/clear` to reset the world, the web visualizer remained connected to the old world instance
- **Solution**: Modified `/clear` to properly stop the old visualizer, create a new one connected to the fresh world, and update all references
- **Files Changed**: `run-god.ts`

#### Fixed Component Dependency Resolution Loop
- **Problem**: Systems would get stuck in an infinite loop trying to fix missing component dependencies
- **Solution**: Added `newRequiredComponents` parameter to `modifySystem` tool, allowing the AI to update system dependencies
- **Files Changed**: `autonomous-god.ts`, `modify-system.ts`

#### Fixed JSON Parsing Errors with Comments
- **Problem**: LLM would sometimes generate JSON with `//` comments, causing parse failures
- **Solution**: Enhanced `parseJSON` to strip single-line and multi-line comments before parsing
- **Files Changed**: `llm/interface.ts`

#### Fixed Array Type Compatibility
- **Problem**: Component schema used `number[]` while registry expected `array` type
- **Solution**: Added type conversion when registering components to ensure compatibility
- **Files Changed**: `generate-component.ts`

#### Fixed Async Error Propagation
- **Problem**: Async system errors weren't being captured for the God agent to fix
- **Solution**: Modified error handlers to re-throw errors for proper propagation
- **Files Changed**: `system-executor.ts`

### ✨ Features & Improvements

#### Unified CLI Command
- Combined `cli.ts` and `run-god.ts` into a single comprehensive `npm run god` command
- Includes web visualization, terminal visualization, save/load, model switching, and all features
- Web visualizer automatically starts on port 8081

#### Enhanced System Debugging
- Added comprehensive debugging guide in system prompt
- Improved error messages to help AI identify dependency issues vs code problems
- Better context about the sandboxed execution environment

#### Model Support
- Added case-insensitive model selection
- Clear error messages for unknown models
- Support for all Gemini models including Flash Lite

### 📝 Documentation

- Created `GOD_AGENT_COMPLETE.md` with full feature documentation
- Added examples for common workflows
- Included pro tips for effective usage
- Created this changelog to track improvements

## [Previous Session]

### Major Architectural Improvements

#### Context Mismatch Resolution
- Fixed issues where LLM made incorrect assumptions about execution environment
- Added clear execution rules to system prompt
- Emphasized sandbox restrictions and variable injection

#### Enhanced Error Recovery
- Improved system modification capabilities
- Better error detection and automatic fixing
- Clearer error messages for debugging

#### UI Generation
- Enabled dynamic UI generation using Gemini 2.0 Flash
- Added `/ui` command for custom visualization
- Universal visualizer adapts to any simulation type

### 🔧 Technical Details

The God Agent V2 now features:
- **Self-healing systems** through intelligent error detection
- **Proper dependency management** for components
- **Robust JSON parsing** that handles LLM quirks
- **Unified interface** combining all features
- **Live web visualization** with automatic updates
- **Comprehensive error handling** throughout the stack

All changes maintain backward compatibility while significantly improving reliability and user experience.