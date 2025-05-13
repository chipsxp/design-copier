# design-copier MCP Server

A webpage design extraction tool that captures and converts web designs for development

This is a TypeScript-based MCP server that implements a web design copying system. It allows you to:

- Capture webpage styles and HTML structure
- Extract and convert CSS to Tailwind classes
- Apply extracted styles to different frontend frameworks

## Features

### Tools
- `designcopier_snapshot` - Capture webpage or element styles
  - Takes a URL and optional CSS selector
  - Returns HTML and CSS styles from the target

- `designcopier_extract` - Extract styles and convert to different formats
  - Processes HTML and CSS content
  - Supports conversion to Tailwind classes
  - Can output in CSS, Tailwind, or React formats

- `designcopier_apply` - Apply extracted styles to target framework
  - Takes extracted styles and applies them to a component
  - Supports React (with styled-components)
  - Creates ready-to-use component templates

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

