/** An expected, explained pipeline failure. Printed without a stack trace. */
export class PipelineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PipelineError";
  }
}
