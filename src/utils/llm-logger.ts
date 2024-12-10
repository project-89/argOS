import fs from "fs";
import path from "path";
import { logger } from "./logger";

class LLMLogger {
  private logDir: string;
  private currentSession: string;
  private promptsAwaitingResponse: Map<
    string,
    { prompt: string; systemPrompt: string; timestamp: number }
  >;

  constructor() {
    this.logDir = path.join(process.cwd(), "logs", "llm");
    this.currentSession = new Date().toISOString().replace(/[:.]/g, "-");
    this.promptsAwaitingResponse = new Map();
    this.ensureLogDir();
  }

  private ensureLogDir() {
    try {
      // Create full path if it doesn't exist
      fs.mkdirSync(this.logDir, { recursive: true });
      logger.debug(`Created LLM log directory: ${this.logDir}`);
    } catch (error) {
      logger.error(`Failed to create LLM log directory: ${error}`);
    }
  }

  private getLogPath(type: string): string {
    const logPath = path.join(
      this.logDir,
      `${this.currentSession}_${type}.log`
    );
    // Ensure the file exists
    if (!fs.existsSync(logPath)) {
      try {
        fs.writeFileSync(logPath, ""); // Create empty file
      } catch (error) {
        logger.error(`Failed to create log file ${logPath}: ${error}`);
      }
    }
    return logPath;
  }

  private appendToLog(logPath: string, content: string) {
    try {
      fs.appendFileSync(logPath, content);
    } catch (error) {
      logger.error(`Failed to write to log ${logPath}: ${error}`);
      // Try to recreate directory and retry
      this.ensureLogDir();
      try {
        fs.appendFileSync(logPath, content);
      } catch (retryError) {
        logger.error(`Retry failed for ${logPath}: ${retryError}`);
      }
    }
  }

  private formatEntry(entry: any): string {
    const timestamp = new Date().toISOString();
    const divider = "=".repeat(80);
    let output = `${divider}\n`;
    output += `Timestamp: ${timestamp}\n`;
    output += `Agent: ${entry.agentId}\n\n`;

    if (entry.type === "conversation") {
      output += "System Prompt:\n";
      output += "------------\n";
      output += `${entry.systemPrompt}\n\n`;
      output += "Prompt:\n";
      output += "-------\n";
      output += `${entry.prompt}\n\n`;
      output += "Response:\n";
      output += "---------\n";
      output += `${entry.response}\n`;
      if (entry.latency) {
        output += `\nLatency: ${entry.latency}ms\n`;
      }
    } else if (entry.type === "error") {
      output += "Error Context:\n";
      output += "-------------\n";
      output += `${entry.context}\n\n`;
      output += "Error:\n";
      output += "------\n";
      output += `${entry.error}\n`;
      if (entry.stack) {
        output += "\nStack Trace:\n";
        output += "------------\n";
        output += `${entry.stack}\n`;
      }
    } else if (entry.type === "experience") {
      output += "Experience:\n";
      output += "-----------\n";
      output += `${JSON.stringify(entry.experience, null, 2)}\n`;
    }

    output += `${divider}\n\n`;
    return output;
  }

  logPrompt(agentId: string, prompt: string, systemPrompt: string) {
    // Store prompt temporarily until we get the response
    this.promptsAwaitingResponse.set(agentId, {
      prompt,
      systemPrompt,
      timestamp: Date.now(),
    });
  }

  logResponse(agentId: string, response: any, latency: number) {
    // Get the stored prompt
    const promptData = this.promptsAwaitingResponse.get(agentId);
    if (!promptData) {
      console.warn(`No prompt found for agent ${agentId}`);
      return;
    }

    // Create a complete conversation entry
    const entry = {
      agentId,
      type: "conversation",
      systemPrompt: promptData.systemPrompt,
      prompt: promptData.prompt,
      response,
      latency,
      timestamp: promptData.timestamp,
    };

    // Write the complete conversation
    this.appendToLog(this.getLogPath("conversations"), this.formatEntry(entry));

    // Clear the stored prompt
    this.promptsAwaitingResponse.delete(agentId);
  }

  logError(agentId: string, error: any, context: string) {
    const entry = {
      agentId,
      type: "error",
      error: error.toString(),
      stack: error.stack,
      context,
    };
    this.appendToLog(this.getLogPath("errors"), this.formatEntry(entry));
  }

  logExperience(agentId: string, experience: any) {
    const entry = {
      agentId,
      type: "experience",
      experience,
    };
    this.appendToLog(this.getLogPath("experiences"), this.formatEntry(entry));
  }
}

export const llmLogger = new LLMLogger();
