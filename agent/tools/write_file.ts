import { disableTool } from "eve/tools";

// This agent answers questions by reading GitHub over the REST API. It has no
// use for the sandbox-backed shell and filesystem tools, and removing them
// keeps sessions from paying to start a sandbox.
export default disableTool();
