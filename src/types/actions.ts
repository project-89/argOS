export interface ActionResult {
  success: boolean;
  message: string;
  timestamp: number;
  actionName: string; // The action that was performed
  parameters: Record<string, any>; // The parameters used
  data: {
    entityId?: number; // Any created/affected entity ID
    content?: string; // Any content/message produced
    metadata?: Record<string, any>; // Additional action-specific data
  };
}
