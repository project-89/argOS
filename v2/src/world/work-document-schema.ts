/** Shared native initialization and authoring vocabulary. This describes how
 * to make a physical document, not authority to read or complete one. */
export const DOCUMENT_VERBS=["read_document","write_document","review_document","finish_document"] as const;
export const WORK_DOCUMENT_INITIAL_VALUES=Object.freeze({revision:0,reviewedRevision:-1,deviceKey:"",lastWriterKey:"",completedAtSimMs:-1});

export function getWorkDocumentAuthoringCapability() {
  return {
    id:"in_world_document",
    description:"Physical text and data with native timed reading, append, review and finalization. No host files or external tools. Choose an existing physical object type and attach these components.",
    components:[
      {name:"WikiDoc",authorFields:["title","body"],initialValues:{status:"draft"}},
      {name:"WorkDocument",initialValues:{...WORK_DOCUMENT_INITIAL_VALUES}},
    ],
    interactions:[...DOCUMENT_VERBS],
    constraints:"Write the actual record in WikiDoc.body; an object description or an NPC's claimed knowledge is not that record. Data is newly authored world content, not evidence that a character has read it. Empty deviceKey means paper/no device. Native use requires local access and sight; writing uses the current revision, review requires text, and finish requires review of that revision. Generation does not perform any of these actions.",
  };
}
