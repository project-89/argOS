# Dependency Fix - Breaking the Code-Only Loop

## 🎯 Problem Identified
The agent was stuck in a "code-only" fix loop:
1. System crashes with `ReferenceError: Input is not defined`
2. Agent tries to fix by modifying the code inside the system
3. System still crashes because the real issue is missing dependencies
4. Loop repeats indefinitely

**Root Cause**: The agent was trying to fix the engine carburetor (code) when the fuel line wasn't connected (dependencies).

## ✅ Solution Implemented

### 1. Enhanced `modifySystem` Tool
**Added new parameter**: `newRequiredComponents?: string[]`

This allows the agent to fix **both** the code and the dependencies in one action.

**Before**: Agent could only edit function body
**After**: Agent can edit "import statements" (requiredComponents) too

### 2. Updated Interface
```typescript
export interface EcsModifySystemParams {
  systemName: string;
  issue?: string;
  errorMessage?: string;
  newBehavior?: string;
  fixInstructions?: string;
  newRequiredComponents?: string[]; // NEW: Fix dependencies!
}
```

### 3. Smart Validation
- Checks that all new components actually exist
- Shows before/after dependencies in logs
- Prevents adding non-existent components

### 4. Enhanced Debugging Guide
Added explicit instructions to the system prompt:
- How to recognize `ReferenceError` dependency issues
- When to use `newRequiredComponents` parameter
- Example of proper dependency fixing

## 🚀 How It Works Now

**Old Broken Flow:**
1. System fails: `ReferenceError: Input is not defined`
2. Agent modifies code: `world.components.Input.horizontal[eid]` 
3. Still fails: `ReferenceError: Input is not defined`
4. Infinite loop 😵

**New Working Flow:**
1. System fails: `ReferenceError: Input is not defined`
2. Agent recognizes this as dependency issue (from debugging guide)
3. Agent calls `modifySystem` with:
   - Fixed code
   - `newRequiredComponents: ["Player", "InRoom", "Input"]`
4. System now has all dependencies in sandbox
5. Success! ✅

## 🎨 Example Usage

The agent will now do this automatically:
```typescript
modifySystem({
  systemName: "PlayerMovementSystem",
  errorMessage: "ReferenceError: Input is not defined",
  fixInstructions: "Add missing Input component to dependencies",
  newRequiredComponents: ["Player", "InRoom", "Input"] // THE KEY FIX!
})
```

## 🔧 What This Enables

- **Self-Healing Systems**: Agent can now fix its own dependency mistakes
- **Proper Architecture**: Systems get the components they actually need
- **No More Loops**: Breaks the infinite code-only fix cycle
- **Better Debugging**: Clear logs show dependency changes

The agent has leveled up from "trying to be a programmer" to "understanding program architecture"! 🎯