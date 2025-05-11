#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import puppeteer from "puppeteer";
import * as cheerio from "cheerio";
import * as csstree from "css-tree";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
import autoprefixer from "autoprefixer";
import { fileURLToPath } from "url";
import * as fs from "fs";
import * as path from "path";

class DesignCopierServer {
  private server: Server;

  constructor() {
    this.server = new Server(
      {
        name: "design-copier",
        version: "0.1.0",
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupToolHandlers();
    this.checkVersionCompatibility();

    this.server.onerror = (error) => console.error("[MCP Error]", error);
    process.on("SIGINT", async () => {
      await this.server.close();
      process.exit(0);
    });
  }

  // Add version compatibility check
  private checkVersionCompatibility() {
    try {
      const currentDir = path.dirname(fileURLToPath(import.meta.url));
      const tailwindPath = path.join(currentDir, "..", "node_modules", "tailwindcss", "package.json");
      const postcssPath = path.join(currentDir, "..", "node_modules", "postcss", "package.json");
      
      const tailwindContent = fs.readFileSync(tailwindPath, "utf8");
      const postcssContent = fs.readFileSync(postcssPath, "utf8");
      
      const tailwindVersion = JSON.parse(tailwindContent).version;
      const postcssVersion = JSON.parse(postcssContent).version;

      console.log(
        `Using Tailwind CSS v${tailwindVersion} with PostCSS v${postcssVersion}`
      );

      // Check for known compatibility issues
      if (
        tailwindVersion.startsWith("4.") &&
        !postcssVersion.startsWith("8.")
      ) {
        console.warn(
          `Warning: Tailwind CSS v${tailwindVersion} may have compatibility issues with PostCSS v${postcssVersion}.`
        );
        console.warn(
          "Consider using Tailwind CSS v3.x with PostCSS v8.x for better compatibility."
        );
      }
    } catch (error) {
      console.warn("Could not check version compatibility:", error);
    }
  }

  private async captureStyles(url: string, selector?: string) {
    const browser = await puppeteer.launch();
    const page = await browser.newPage();

    try {
      await page.goto(url, { waitUntil: "networkidle0" });

      // Get all styles (inline, embedded, and external)
      const styles = await page.evaluate((selector) => {
        const extractStyles = (element: Element) => {
          const styles: string[] = [];

          // Get computed styles
          const computed = window.getComputedStyle(element);
          const computedStyles = Object.entries(computed)
            .filter(([key]) => isNaN(Number(key))) // Filter out indexed properties
            .map(([prop, value]) => `${prop}: ${value};`)
            .join("\n");
          styles.push(computedStyles);

          // Get inline styles
          if (element.hasAttribute("style")) {
            styles.push(element.getAttribute("style") || "");
          }

          return styles.join("\n");
        };

        if (selector) {
          const element = document.querySelector(selector);
          return element ? extractStyles(element) : "";
        }

        // Get all stylesheet contents
        const styleSheets = Array.from(document.styleSheets);
        const cssRules: string[] = [];

        styleSheets.forEach((sheet) => {
          try {
            Array.from(sheet.cssRules).forEach((rule) => {
              cssRules.push(rule.cssText);
            });
          } catch (e) {
            // Handle CORS errors for external stylesheets
            console.error("Could not access stylesheet rules:", e);
          }
        });

        return cssRules.join("\n");
      }, selector);

      const html = await page.content();
      return { styles, html };
    } finally {
      await browser.close();
    }
  }

  private async extractTailwindClasses(html: string, styles: string) {
    const $ = cheerio.load(html);
    const existingClasses = new Set<string>();

    // Extract existing Tailwind classes
    $("*").each((_, element) => {
      const classNames = $(element).attr("class");
      if (classNames) {
        classNames.split(" ").forEach((cls) => existingClasses.add(cls.trim()));
      }
    });

    // Parse CSS and convert to Tailwind using PostCSS and Tailwind
    const tailwindMappings: Record<string, string[]> = {};
    const cssToTailwindMap: Record<string, string> = {};
    const tailwindSuggestions: Record<string, string[]> = {};

    try {
      // Parse CSS with css-tree to get selectors and declarations
      const ast = csstree.parse(styles);

      csstree.walk(ast, {
        visit: "Rule",
        enter: (node: any) => {
          if (node.type === "Rule") {
            const selector = csstree.generate(node.prelude);
            const declarations: string[] = [];
            const cssProperties: Record<string, string> = {};

            csstree.walk(node.block, {
              visit: "Declaration",
              enter: (declNode: any) => {
                const prop = declNode.property;
                const value = csstree.generate(declNode.value);
                declarations.push(`${prop}: ${value}`);
                cssProperties[prop] = value;
              },
            });

            tailwindMappings[selector] = declarations;

            // Map CSS properties to Tailwind classes using the helper method
            tailwindSuggestions[selector] =
              this.mapCssToTailwind(cssProperties);

            // Process with PostCSS and Tailwind
            const cssText = `.temp-selector { ${declarations.join("; ")} }`;

            // Store for later processing with PostCSS
            cssToTailwindMap[selector] = cssText;
          }
        },
      });

      // Process all collected CSS with PostCSS and Tailwind
      const processor = postcss([
        tailwindcss({
          content: [{ raw: html, extension: "html" }],
          config: this.getTailwindConfig(),
        }),
        autoprefixer(), // Add autoprefixer to the PostCSS plugins
      ]);

      // Create a temporary CSS file with all the collected styles
      const tempCss = Object.values(cssToTailwindMap).join("\n");
      const result = await processor.process(tempCss, { from: undefined });
      const processedCss = result.css;

      // Extract Tailwind classes from processed CSS
      const tailwindClassRegex = /\.([a-zA-Z0-9_\-:\/]+)/g;
      const extractedClasses = new Set<string>();
      let match;

      while ((match = tailwindClassRegex.exec(processedCss)) !== null) {
        if (match[1] && !match[1].includes("temp-selector")) {
          extractedClasses.add(match[1]);
        }
      }

      return {
        existingClasses: Array.from(existingClasses),
        cssToTailwind: tailwindMappings,
        tailwindSuggestions: tailwindSuggestions,
        extractedClasses: Array.from(extractedClasses),
      };
    } catch (error) {
      console.error("Error processing CSS with Tailwind:", error);

      // Provide more detailed error information
      let errorMessage = "Failed to process with Tailwind";
      if (error instanceof Error) {
        errorMessage = `${errorMessage}: ${error.message}`;

        // Add stack trace in development environment
        if (process.env.NODE_ENV === "development") {
          errorMessage += `\nStack: ${error.stack}`;
        }
      } else {
        errorMessage = `${errorMessage}: ${String(error)}`;
      }

      // Return more structured error information
      return {
        existingClasses: Array.from(existingClasses),
        cssToTailwind: tailwindMappings,
        tailwindSuggestions: tailwindSuggestions,
        error: {
          message: errorMessage,
          code: "TAILWIND_PROCESSING_ERROR",
          details: error,
        },
      };
    }
  }

  private mapCssToTailwind(cssProperties: Record<string, string>): string[] {
    const tailwindClasses: string[] = [];

    // This is a more comprehensive mapping of CSS properties to Tailwind classes
    Object.entries(cssProperties).forEach(([property, value]) => {
      switch (property) {
        case "color":
          // Try to map to Tailwind color palette
          const textColor = this.mapColorToTailwind(value);
          tailwindClasses.push(textColor || `text-[${value}]`);
          break;
        case "background-color":
          const bgColor = this.mapColorToTailwind(value, "bg");
          tailwindClasses.push(bgColor || `bg-[${value}]`);
          break;
        case "margin":
          // Handle shorthand margin properties
          const marginClasses = this.mapSpacingToTailwind(value, "m");
          tailwindClasses.push(...marginClasses);
          break;
        case "margin-top":
          const mtClass = this.mapSingleSpacingToTailwind(value, "mt");
          tailwindClasses.push(mtClass);
          break;
        case "margin-right":
          const mrClass = this.mapSingleSpacingToTailwind(value, "mr");
          tailwindClasses.push(mrClass);
          break;
        case "margin-bottom":
          const mbClass = this.mapSingleSpacingToTailwind(value, "mb");
          tailwindClasses.push(mbClass);
          break;
        case "margin-left":
          const mlClass = this.mapSingleSpacingToTailwind(value, "ml");
          tailwindClasses.push(mlClass);
          break;
        case "padding":
          // Handle shorthand padding properties
          const paddingClasses = this.mapSpacingToTailwind(value, "p");
          tailwindClasses.push(...paddingClasses);
          break;
        // Add more property mappings as needed
        case "font-size":
          const fontSize = this.mapFontSizeToTailwind(value);
          tailwindClasses.push(fontSize);
          break;
        case "font-weight":
          const weightMap: Record<string, string> = {
            normal: "font-normal",
            bold: "font-bold",
            "100": "font-thin",
            "200": "font-extralight",
            "300": "font-light",
            "400": "font-normal",
            "500": "font-medium",
            "600": "font-semibold",
            "700": "font-bold",
            "800": "font-extrabold",
            "900": "font-black",
          };
          tailwindClasses.push(weightMap[value] || `font-[${value}]`);
          break;
        case "display":
          const displayMap: Record<string, string> = {
            block: "block",
            inline: "inline",
            "inline-block": "inline-block",
            flex: "flex",
            "inline-flex": "inline-flex",
            grid: "grid",
            none: "hidden",
          };
          tailwindClasses.push(displayMap[value] || `${property}-[${value}]`);
          break;
        default:
          // For properties without specific mappings, use Tailwind's arbitrary value syntax
          tailwindClasses.push(`${property}-[${value}]`);
      }
    });

    return tailwindClasses.filter(Boolean);
  }

  // Helper methods for mapping CSS values to Tailwind classes
  private mapColorToTailwind(
    color: string,
    prefix: string = "text"
  ): string | null {
    // Basic color mapping - would need to be expanded for a complete implementation
    const colorMap: Record<string, string> = {
      black: `${prefix}-black`,
      white: `${prefix}-white`,
      "#000": `${prefix}-black`,
      "#fff": `${prefix}-white`,
      "#ffffff": `${prefix}-white`,
      "#000000": `${prefix}-black`,
      // Add more color mappings as needed
    };

    return colorMap[color.toLowerCase()] || null;
  }

  private mapSpacingToTailwind(value: string, prefix: string): string[] {
    // Handle shorthand properties like "margin: 10px 20px 15px 5px"
    const values = value.split(" ").map((v) => v.trim());

    if (values.length === 1) {
      return [this.mapSingleSpacingToTailwind(values[0], prefix)];
    } else if (values.length === 2) {
      // vertical horizontal
      return [
        this.mapSingleSpacingToTailwind(values[0], `${prefix}y`),
        this.mapSingleSpacingToTailwind(values[1], `${prefix}x`),
      ];
    } else if (values.length === 4) {
      // top right bottom left
      return [
        this.mapSingleSpacingToTailwind(values[0], `${prefix}t`),
        this.mapSingleSpacingToTailwind(values[1], `${prefix}r`),
        this.mapSingleSpacingToTailwind(values[2], `${prefix}b`),
        this.mapSingleSpacingToTailwind(values[3], `${prefix}l`),
      ];
    }

    return [`${prefix}-[${value}]`];
  }

  private mapSingleSpacingToTailwind(value: string, prefix: string): string {
    // Map pixel values to Tailwind spacing scale
    if (value.endsWith("px")) {
      const pixels = parseInt(value);
      // Tailwind's default spacing scale
      const spacingMap: Record<number, string> = {
        0: `${prefix}-0`,
        1: `${prefix}-px`,
        4: `${prefix}-1`,
        8: `${prefix}-2`,
        12: `${prefix}-3`,
        16: `${prefix}-4`,
        20: `${prefix}-5`,
        24: `${prefix}-6`,
        32: `${prefix}-8`,
        40: `${prefix}-10`,
        48: `${prefix}-12`,
        64: `${prefix}-16`,
        80: `${prefix}-20`,
        96: `${prefix}-24`,
        128: `${prefix}-32`,
        160: `${prefix}-40`,
        192: `${prefix}-48`,
        224: `${prefix}-56`,
        256: `${prefix}-64`,
      };

      return spacingMap[pixels] || `${prefix}-[${value}]`;
    }

    return `${prefix}-[${value}]`;
  }

  private mapFontSizeToTailwind(value: string): string {
    // Map common font sizes to Tailwind's text size scale
    if (value.endsWith("px")) {
      const pixels = parseInt(value);
      const fontSizeMap: Record<number, string> = {
        12: "text-xs",
        14: "text-sm",
        16: "text-base",
        18: "text-lg",
        20: "text-xl",
        24: "text-2xl",
        30: "text-3xl",
        36: "text-4xl",
        48: "text-5xl",
        60: "text-6xl",
        72: "text-7xl",
        96: "text-8xl",
        128: "text-9xl",
      };

      return fontSizeMap[pixels] || `text-[${value}]`;
    }

    return `text-[${value}]`;
  }

  private setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: "designcopier_snapshot",
          description: "Capture webpage or element styles",
          inputSchema: {
            type: "object",
            properties: {
              url: {
                type: "string",
                description: "URL to capture",
              },
              selector: {
                type: "string",
                description: "Optional CSS selector for specific element",
              },
            },
            required: ["url"],
          },
        },
        {
          name: "designcopier_extract",
          description: "Extract styles and convert to different formats",
          inputSchema: {
            type: "object",
            properties: {
              html: {
                type: "string",
                description: "HTML content",
              },
              styles: {
                type: "string",
                description: "CSS styles",
              },
              format: {
                type: "string",
                enum: ["css", "tailwind", "react"],
                description: "Output format",
              },
            },
            required: ["html", "styles", "format"],
          },
        },
        {
          name: "designcopier_apply",
          description: "Apply extracted styles to target framework",
          inputSchema: {
            type: "object",
            properties: {
              styles: {
                type: "string",
                description: "Extracted styles",
              },
              targetFramework: {
                type: "string",
                enum: ["react", "vue", "angular", "svelte"],
                description: "Target framework",
              },
              componentName: {
                type: "string",
                description: "Name for the generated component",
              },
            },
            required: ["styles", "targetFramework", "componentName"],
          },
        },
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      switch (request.params.name) {
        case "designcopier_snapshot": {
          const { url, selector } = request.params.arguments as {
            url: string;
            selector?: string;
          };
          try {
            const result = await this.captureStyles(url, selector);
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(result, null, 2),
                },
              ],
            };
          } catch (error) {
            throw new McpError(
              ErrorCode.InternalError,
              `Failed to capture styles: ${error}`
            );
          }
        }

        case "designcopier_extract": {
          const { html, styles, format } = request.params.arguments as {
            html: string;
            styles: string;
            format: "css" | "tailwind" | "react";
          };

          try {
            let result;
            switch (format) {
              case "tailwind":
                result = await this.extractTailwindClasses(html, styles);
                break;
              case "react":
                // Convert to React styled-components format
                result = `import styled from 'styled-components';\n\n${styles
                  .split("\n")
                  .map((line) => line.trim())
                  .join("\n")}`;
                break;
              default:
                // Return formatted CSS
                result = styles;
            }

            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(result, null, 2),
                },
              ],
            };
          } catch (error) {
            throw new McpError(
              ErrorCode.InternalError,
              `Failed to extract styles: ${error}`
            );
          }
        }

        case "designcopier_apply": {
          const { styles, targetFramework, componentName } = request.params
            .arguments as {
            styles: string;
            targetFramework: string;
            componentName: string;
          };

          try {
            let result;
            switch (targetFramework) {
              case "react":
                result = `
import React from 'react';
import styled from 'styled-components';

const Styled${componentName} = styled.div\`
  ${styles}
\`;

export const ${componentName} = () => {
  return (
    <Styled${componentName}>
      {/* Add your content here */}
    </Styled${componentName}>
  );
};
`;
                break;
              // Add other framework implementations
              default:
                throw new McpError(
                  ErrorCode.InvalidParams,
                  `Unsupported framework: ${targetFramework}`
                );
            }

            return {
              content: [
                {
                  type: "text",
                  text: result,
                },
              ],
            };
          } catch (error) {
            throw new McpError(
              ErrorCode.InternalError,
              `Failed to apply styles: ${error}`
            );
          }
        }

        default:
          throw new McpError(
            ErrorCode.MethodNotFound,
            `Unknown tool: ${request.params.name}`
          );
      }
    });
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error("Design Copier MCP server running on stdio");
  }

  private getTailwindConfig() {
    // Try to load the project's tailwind config
    const configPath = path.resolve("./tailwind.config.js");

    try {
      if (fs.existsSync(configPath)) {
        // If the config exists, require it
        return configPath;
      }
    } catch (error) {
      console.warn(`Could not load tailwind config from ${configPath}:`, error);
    }

    // Return default config if project config not found
    return {
      content: [],
      theme: {
        extend: {},
      },
      plugins: [],
    };
  }
}

const server = new DesignCopierServer();
server.run().catch(console.error);
