# design-copier MCP Server

webpage design copier to transfer in a development app

This is a TypeScript-based MCP server that implements a simple notes system. It demonstrates core MCP concepts by providing:

- Resources representing text notes with URIs and metadata
- Tools for creating new notes
- Prompts for generating summaries of notes

## Features

### Resources
- List and access notes via `note://` URIs
- Each note has a title, content and metadata
- Plain text mime type for simple content access

### Tools
- `create_note` - Create new text notes
  - Takes title and content as required parameters
  - Stores note in server state

### Prompts
- `summarize_notes` - Generate a summary of all stored notes
  - Includes all note contents as embedded resources
  - Returns structured prompt for LLM summarization

## Clone Repo and Development

Install dependencies:
```bash
npm install
```

```bash
npm run prepare , first time only or any custom changes 
```

Build the server:
```bash
npm run build , to make the build index.js file
```

For development with auto-rebuild:
```bash
npm run watch
```

## Installation

To use with Claude Desktop, add the server config:

On MacOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
On Windows: `%APPDATA%/Claude/claude_desktop_config.json`
VS-Code with Cline or Roo: `Click top MCP Server icon, go to 'Installed' and at bottom of server list running, click 'Configure MCP Server'` Add this to the config:

```json
"design-copier": {
      "timeout": 60,
      "command": "node",
      "args": [ "C:\\Users\\$ProfileUser$\\your-folder\\whatever folder\\design-copier\\build\\index.js" 
    ],
      "transportType": "stdio"
    } 
```
Another example:

```json
{
  "mcpServers": {
    "design-copier": {
      "command": "node",
      "args": [
        "/path/to/design-copier/build/index.js"
      ],
      "transportType": "stdio"
    }
  }
}
```

### Debugging

Since MCP servers communicate over stdio, debugging can be challenging. We recommend using the [MCP Inspector](https://github.com/modelcontextprotocol/inspector), which is available as a package script:

```bash
npm run inspector
```

The Inspector will provide a URL to access debugging tools in your browser.
