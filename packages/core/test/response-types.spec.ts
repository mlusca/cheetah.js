import { describe, expect, test } from "bun:test";
import { Controller, Get, Post, Body, Param, Query, Ctx, Context } from "../src";
import { withTestApp } from "../src/testing/TestHarness";

/**
 * Comprehensive test suite for controller response types.
 * 
 * Tests various response formats:
 * - JSON responses (objects, arrays, nested structures)
 * - Text responses (plain text, HTML)
 * - Binary responses (ArrayBuffer, Uint8Array, Blob)
 * - Stream responses (ReadableStream)
 * - File-like responses (images, PDFs, etc.)
 * - Custom Response objects with headers and status codes
 * - Async responses
 * - Null/undefined responses
 */

describe("Controller Response Types", () => {
    // ====================
    // JSON RESPONSES
    // ====================
    describe("JSON Responses", () => {
        @Controller("/json")
        class JsonController {
            @Get("/object")
            returnObject() {
                return { message: "Hello World", count: 42 };
            }

            @Get("/array")
            returnArray() {
                return [1, 2, 3, 4, 5];
            }

            @Get("/nested")
            returnNested() {
                return {
                    user: {
                        id: 1,
                        name: "John",
                        profile: {
                            email: "john@example.com",
                            settings: {
                                theme: "dark",
                                notifications: true
                            }
                        }
                    },
                    tags: ["admin", "user"]
                };
            }

            @Get("/array-of-objects")
            returnArrayOfObjects() {
                return [
                    { id: 1, name: "Alice" },
                    { id: 2, name: "Bob" },
                    { id: 3, name: "Charlie" }
                ];
            }

            @Get("/number")
            returnNumber() {
                return 42;
            }

            @Get("/boolean")
            returnBoolean() {
                return true;
            }

            @Get("/null")
            returnNull() {
                return null;
            }

            @Get("/empty-object")
            returnEmptyObject() {
                return {};
            }

            @Get("/empty-array")
            returnEmptyArray() {
                return [];
            }

            @Get("/special-chars")
            returnSpecialChars() {
                return {
                    unicode: "Hello 世界 🌍",
                    html: "<script>alert('xss')</script>",
                    quotes: 'He said "Hello" and \'Goodbye\''
                };
            }

            @Get("/large")
            returnLarge() {
                const items = [];
                for (let i = 0; i < 1000; i++) {
                    items.push({ id: i, value: `item-${i}` });
                }
                return { items, total: items.length };
            }

            @Post("/echo")
            echoJson(@Body() body: any) {
                return { received: body, timestamp: Date.now() };
            }
        }

        test("returns simple JSON object", async () => {
            await withTestApp(
                async (harness) => {
                    const response = await harness.get("/json/object");
                    expect(response.status).toBe(200);
                    expect(response.headers.get("content-type")).toContain("application/json");
                    expect(await response.json()).toEqual({ message: "Hello World", count: 42 });
                },
                { controllers: [JsonController], listen: true }
            );
        });

        test("returns JSON array", async () => {
            await withTestApp(
                async (harness) => {
                    const response = await harness.get("/json/array");
                    expect(response.status).toBe(200);
                    expect(await response.json()).toEqual([1, 2, 3, 4, 5]);
                },
                { controllers: [JsonController], listen: true }
            );
        });

        test("returns deeply nested JSON structure", async () => {
            await withTestApp(
                async (harness) => {
                    const response = await harness.get("/json/nested");
                    expect(response.status).toBe(200);
                    const data = await response.json();
                    expect(data.user.profile.settings.theme).toBe("dark");
                    expect(data.tags).toContain("admin");
                },
                { controllers: [JsonController], listen: true }
            );
        });

        test("returns array of objects", async () => {
            await withTestApp(
                async (harness) => {
                    const response = await harness.get("/json/array-of-objects");
                    expect(response.status).toBe(200);
                    const data = await response.json();
                    expect(data).toHaveLength(3);
                    expect(data[1].name).toBe("Bob");
                },
                { controllers: [JsonController], listen: true }
            );
        });

        test("returns raw number as JSON", async () => {
            await withTestApp(
                async (harness) => {
                    const response = await harness.get("/json/number");
                    expect(response.status).toBe(200);
                    expect(await response.json()).toBe(42);
                },
                { controllers: [JsonController], listen: true }
            );
        });

        test("returns boolean as JSON", async () => {
            await withTestApp(
                async (harness) => {
                    const response = await harness.get("/json/boolean");
                    expect(response.status).toBe(200);
                    expect(await response.json()).toBe(true);
                },
                { controllers: [JsonController], listen: true }
            );
        });

        test("returns null as JSON", async () => {
            await withTestApp(
                async (harness) => {
                    const response = await harness.get("/json/null");
                    expect(response.status).toBe(200);
                    expect(await response.json()).toBeNull();
                },
                { controllers: [JsonController], listen: true }
            );
        });

        test("returns empty object", async () => {
            await withTestApp(
                async (harness) => {
                    const response = await harness.get("/json/empty-object");
                    expect(response.status).toBe(200);
                    expect(await response.json()).toEqual({});
                },
                { controllers: [JsonController], listen: true }
            );
        });

        test("returns empty array", async () => {
            await withTestApp(
                async (harness) => {
                    const response = await harness.get("/json/empty-array");
                    expect(response.status).toBe(200);
                    expect(await response.json()).toEqual([]);
                },
                { controllers: [JsonController], listen: true }
            );
        });

        test("handles special characters in JSON", async () => {
            await withTestApp(
                async (harness) => {
                    const response = await harness.get("/json/special-chars");
                    expect(response.status).toBe(200);
                    const data = await response.json();
                    expect(data.unicode).toBe("Hello 世界 🌍");
                    expect(data.html).toBe("<script>alert('xss')</script>");
                },
                { controllers: [JsonController], listen: true }
            );
        });

        test("handles large JSON payload", async () => {
            await withTestApp(
                async (harness) => {
                    const response = await harness.get("/json/large");
                    expect(response.status).toBe(200);
                    const data = await response.json();
                    expect(data.total).toBe(1000);
                    expect(data.items).toHaveLength(1000);
                },
                { controllers: [JsonController], listen: true }
            );
        });

        test("echoes posted JSON body", async () => {
            await withTestApp(
                async (harness) => {
                    const payload = { name: "Test", values: [1, 2, 3] };
                    const response = await harness.post("/json/echo", payload);
                    expect(response.status).toBe(200);
                    const data = await response.json();
                    expect(data.received).toEqual(payload);
                    expect(data.timestamp).toBeGreaterThan(0);
                },
                { controllers: [JsonController], listen: true }
            );
        });
    });

    // ====================
    // TEXT RESPONSES
    // ====================
    describe("Text Responses", () => {
        @Controller("/text")
        class TextController {
            @Get("/plain")
            returnPlainText() {
                return "Hello, World!";
            }

            @Get("/multiline")
            returnMultiline() {
                return `Line 1
Line 2
Line 3`;
            }

            @Get("/empty")
            returnEmpty() {
                return "";
            }

            @Get("/unicode")
            returnUnicode() {
                return "Hello 世界 🌍 مرحبا";
            }

            @Get("/html-via-response")
            returnHtmlViaResponse(@Ctx() ctx: Context) {
                return ctx.html("<h1>Hello World</h1><p>This is HTML</p>");
            }

            @Get("/text-via-response")
            returnTextViaResponse(@Ctx() ctx: Context) {
                return ctx.text("Plain text via context");
            }

            @Get("/custom-text")
            returnCustomText() {
                return new Response("Custom text content", {
                    headers: { "Content-Type": "text/plain; charset=utf-8" }
                });
            }
        }

        test("returns plain text string", async () => {
            await withTestApp(
                async (harness) => {
                    const response = await harness.get("/text/plain");
                    expect(response.status).toBe(200);
                    expect(response.headers.get("content-type")).toContain("text/plain");
                    expect(await response.text()).toBe("Hello, World!");
                },
                { controllers: [TextController], listen: true }
            );
        });

        test("returns multiline text", async () => {
            await withTestApp(
                async (harness) => {
                    const response = await harness.get("/text/multiline");
                    expect(response.status).toBe(200);
                    const text = await response.text();
                    expect(text).toContain("Line 1");
                    expect(text).toContain("Line 2");
                    expect(text).toContain("Line 3");
                },
                { controllers: [TextController], listen: true }
            );
        });

        test("returns empty string", async () => {
            await withTestApp(
                async (harness) => {
                    const response = await harness.get("/text/empty");
                    expect(response.status).toBe(200);
                    expect(await response.text()).toBe("");
                },
                { controllers: [TextController], listen: true }
            );
        });

        test("returns unicode text", async () => {
            await withTestApp(
                async (harness) => {
                    const response = await harness.get("/text/unicode");
                    expect(response.status).toBe(200);
                    expect(await response.text()).toBe("Hello 世界 🌍 مرحبا");
                },
                { controllers: [TextController], listen: true }
            );
        });

        test("returns HTML via context.html()", async () => {
            await withTestApp(
                async (harness) => {
                    const response = await harness.get("/text/html-via-response");
                    expect(response.status).toBe(200);
                    expect(response.headers.get("content-type")).toContain("text/html");
                    const html = await response.text();
                    expect(html).toContain("<h1>Hello World</h1>");
                },
                { controllers: [TextController], listen: true }
            );
        });

        test("returns text via context.text()", async () => {
            await withTestApp(
                async (harness) => {
                    const response = await harness.get("/text/text-via-response");
                    expect(response.status).toBe(200);
                    expect(response.headers.get("content-type")).toContain("text/plain");
                    expect(await response.text()).toBe("Plain text via context");
                },
                { controllers: [TextController], listen: true }
            );
        });

        test("returns custom text with Response object", async () => {
            await withTestApp(
                async (harness) => {
                    const response = await harness.get("/text/custom-text");
                    expect(response.status).toBe(200);
                    expect(response.headers.get("content-type")).toContain("text/plain");
                    expect(await response.text()).toBe("Custom text content");
                },
                { controllers: [TextController], listen: true }
            );
        });
    });

    // ====================
    // BINARY RESPONSES
    // ====================
    describe("Binary Responses", () => {
        @Controller("/binary")
        class BinaryController {
            @Get("/arraybuffer")
            returnArrayBuffer() {
                const buffer = new ArrayBuffer(8);
                const view = new Uint8Array(buffer);
                for (let i = 0; i < 8; i++) {
                    view[i] = i * 10;
                }
                return new Response(buffer, {
                    headers: { "Content-Type": "application/octet-stream" }
                });
            }

            @Get("/uint8array")
            returnUint8Array() {
                const data = new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f]); // "Hello"
                return new Response(data, {
                    headers: { "Content-Type": "application/octet-stream" }
                });
            }

            @Get("/blob")
            returnBlob() {
                const blob = new Blob(["Hello from Blob!"], { type: "text/plain" });
                return new Response(blob);
            }

            @Get("/image-png")
            returnPngImage() {
                // Minimal valid PNG (1x1 transparent pixel)
                const pngData = new Uint8Array([
                    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG signature
                    0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, // IHDR chunk
                    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
                    0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
                    0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, // IDAT chunk
                    0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
                    0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00,
                    0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, // IEND chunk
                    0x42, 0x60, 0x82
                ]);
                return new Response(pngData, {
                    headers: { "Content-Type": "image/png" }
                });
            }

            @Get("/image-svg")
            returnSvgImage() {
                const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
                    <circle cx="50" cy="50" r="40" fill="red"/>
                </svg>`;
                return new Response(svg, {
                    headers: { "Content-Type": "image/svg+xml" }
                });
            }

            @Get("/pdf")
            returnPdf() {
                // Minimal valid PDF
                const pdf = `%PDF-1.0
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >> endobj
xref
0 4
trailer << /Size 4 /Root 1 0 R >>
startxref
0
%%EOF`;
                return new Response(pdf, {
                    headers: { "Content-Type": "application/pdf" }
                });
            }

            @Get("/download")
            returnDownload() {
                const data = "File content to download";
                return new Response(data, {
                    headers: {
                        "Content-Type": "application/octet-stream",
                        "Content-Disposition": "attachment; filename=\"download.txt\""
                    }
                });
            }

            @Get("/large-binary")
            returnLargeBinary() {
                // 1MB of binary data
                const size = 1024 * 1024;
                const data = new Uint8Array(size);
                for (let i = 0; i < size; i++) {
                    data[i] = i % 256;
                }
                return new Response(data, {
                    headers: {
                        "Content-Type": "application/octet-stream",
                        "Content-Length": String(size)
                    }
                });
            }
        }

        test("returns ArrayBuffer response", async () => {
            await withTestApp(
                async (harness) => {
                    const response = await harness.get("/binary/arraybuffer");
                    expect(response.status).toBe(200);
                    expect(response.headers.get("content-type")).toContain("application/octet-stream");
                    const buffer = await response.arrayBuffer();
                    const view = new Uint8Array(buffer);
                    expect(view[0]).toBe(0);
                    expect(view[1]).toBe(10);
                    expect(view[7]).toBe(70);
                },
                { controllers: [BinaryController], listen: true }
            );
        });

        test("returns Uint8Array response", async () => {
            await withTestApp(
                async (harness) => {
                    const response = await harness.get("/binary/uint8array");
                    expect(response.status).toBe(200);
                    const text = await response.text();
                    expect(text).toBe("Hello");
                },
                { controllers: [BinaryController], listen: true }
            );
        });

        test("returns Blob response", async () => {
            await withTestApp(
                async (harness) => {
                    const response = await harness.get("/binary/blob");
                    expect(response.status).toBe(200);
                    expect(await response.text()).toBe("Hello from Blob!");
                },
                { controllers: [BinaryController], listen: true }
            );
        });

        test("returns PNG image", async () => {
            await withTestApp(
                async (harness) => {
                    const response = await harness.get("/binary/image-png");
                    expect(response.status).toBe(200);
                    expect(response.headers.get("content-type")).toBe("image/png");
                    const buffer = await response.arrayBuffer();
                    const view = new Uint8Array(buffer);
                    // Check PNG magic bytes
                    expect(view[0]).toBe(0x89);
                    expect(view[1]).toBe(0x50); // 'P'
                    expect(view[2]).toBe(0x4e); // 'N'
                    expect(view[3]).toBe(0x47); // 'G'
                },
                { controllers: [BinaryController], listen: true }
            );
        });

        test("returns SVG image", async () => {
            await withTestApp(
                async (harness) => {
                    const response = await harness.get("/binary/image-svg");
                    expect(response.status).toBe(200);
                    expect(response.headers.get("content-type")).toBe("image/svg+xml");
                    const svg = await response.text();
                    expect(svg).toContain("<svg");
                    expect(svg).toContain("<circle");
                },
                { controllers: [BinaryController], listen: true }
            );
        });

        test("returns PDF document", async () => {
            await withTestApp(
                async (harness) => {
                    const response = await harness.get("/binary/pdf");
                    expect(response.status).toBe(200);
                    expect(response.headers.get("content-type")).toBe("application/pdf");
                    const text = await response.text();
                    expect(text).toContain("%PDF-1.0");
                },
                { controllers: [BinaryController], listen: true }
            );
        });

        test("returns file download with Content-Disposition", async () => {
            await withTestApp(
                async (harness) => {
                    const response = await harness.get("/binary/download");
                    expect(response.status).toBe(200);
                    expect(response.headers.get("content-disposition")).toContain("attachment");
                    expect(response.headers.get("content-disposition")).toContain("download.txt");
                },
                { controllers: [BinaryController], listen: true }
            );
        });

        test("handles large binary response", async () => {
            await withTestApp(
                async (harness) => {
                    const response = await harness.get("/binary/large-binary");
                    expect(response.status).toBe(200);
                    const buffer = await response.arrayBuffer();
                    expect(buffer.byteLength).toBe(1024 * 1024);
                    const view = new Uint8Array(buffer);
                    expect(view[0]).toBe(0);
                    expect(view[255]).toBe(255);
                    expect(view[256]).toBe(0);
                },
                { controllers: [BinaryController], listen: true }
            );
        });
    });

    // ====================
    // STREAM RESPONSES
    // ====================
    describe("Stream Responses", () => {
        @Controller("/stream")
        class StreamController {
            @Get("/readable")
            returnReadableStream() {
                const encoder = new TextEncoder();
                const stream = new ReadableStream({
                    start(controller) {
                        controller.enqueue(encoder.encode("chunk1"));
                        controller.enqueue(encoder.encode("chunk2"));
                        controller.enqueue(encoder.encode("chunk3"));
                        controller.close();
                    }
                });

                return new Response(stream, {
                    headers: { "Content-Type": "text/plain" }
                });
            }

            @Get("/delayed")
            returnDelayedStream() {
                const encoder = new TextEncoder();
                let count = 0;

                const stream = new ReadableStream({
                    async pull(controller) {
                        if (count < 3) {
                            await new Promise(resolve => setTimeout(resolve, 10));
                            controller.enqueue(encoder.encode(`delayed-${count}`));
                            count++;
                        } else {
                            controller.close();
                        }
                    }
                });

                return new Response(stream, {
                    headers: { "Content-Type": "text/plain" }
                });
            }

            @Get("/json-stream")
            returnJsonStream() {
                const encoder = new TextEncoder();
                const items = [
                    JSON.stringify({ id: 1, name: "first" }),
                    JSON.stringify({ id: 2, name: "second" }),
                    JSON.stringify({ id: 3, name: "third" })
                ];
                let index = 0;

                const stream = new ReadableStream({
                    pull(controller) {
                        if (index < items.length) {
                            controller.enqueue(encoder.encode(items[index] + "\n"));
                            index++;
                        } else {
                            controller.close();
                        }
                    }
                });

                return new Response(stream, {
                    headers: { "Content-Type": "application/x-ndjson" }
                });
            }

            @Get("/sse")
            returnServerSentEvents() {
                const encoder = new TextEncoder();
                let eventId = 0;

                const stream = new ReadableStream({
                    async start(controller) {
                        for (let i = 0; i < 3; i++) {
                            const event = `id: ${eventId++}\ndata: ${JSON.stringify({ message: `event-${i}` })}\n\n`;
                            controller.enqueue(encoder.encode(event));
                        }
                        controller.close();
                    }
                });

                return new Response(stream, {
                    headers: {
                        "Content-Type": "text/event-stream",
                        "Cache-Control": "no-cache",
                        "Connection": "keep-alive"
                    }
                });
            }

            @Get("/binary-stream")
            returnBinaryStream() {
                let offset = 0;
                const totalSize = 1000;

                const stream = new ReadableStream({
                    pull(controller) {
                        if (offset < totalSize) {
                            const chunkSize = Math.min(100, totalSize - offset);
                            const chunk = new Uint8Array(chunkSize);
                            for (let i = 0; i < chunkSize; i++) {
                                chunk[i] = (offset + i) % 256;
                            }
                            controller.enqueue(chunk);
                            offset += chunkSize;
                        } else {
                            controller.close();
                        }
                    }
                });

                return new Response(stream, {
                    headers: { "Content-Type": "application/octet-stream" }
                });
            }
        }

        test("returns ReadableStream response", async () => {
            await withTestApp(
                async (harness) => {
                    const response = await harness.get("/stream/readable");
                    expect(response.status).toBe(200);
                    const text = await response.text();
                    expect(text).toBe("chunk1chunk2chunk3");
                },
                { controllers: [StreamController], listen: true }
            );
        });

        test("returns delayed stream response", async () => {
            await withTestApp(
                async (harness) => {
                    const response = await harness.get("/stream/delayed");
                    expect(response.status).toBe(200);
                    const text = await response.text();
                    expect(text).toBe("delayed-0delayed-1delayed-2");
                },
                { controllers: [StreamController], listen: true }
            );
        });

        test("returns NDJSON stream", async () => {
            await withTestApp(
                async (harness) => {
                    const response = await harness.get("/stream/json-stream");
                    expect(response.status).toBe(200);
                    expect(response.headers.get("content-type")).toBe("application/x-ndjson");
                    const text = await response.text();
                    const lines = text.trim().split("\n");
                    expect(lines).toHaveLength(3);
                    expect(JSON.parse(lines[0])).toEqual({ id: 1, name: "first" });
                },
                { controllers: [StreamController], listen: true }
            );
        });

        test("returns Server-Sent Events stream", async () => {
            await withTestApp(
                async (harness) => {
                    const response = await harness.get("/stream/sse");
                    expect(response.status).toBe(200);
                    expect(response.headers.get("content-type")).toBe("text/event-stream");
                    const text = await response.text();
                    expect(text).toContain("id: 0");
                    expect(text).toContain("data:");
                    expect(text).toContain("event-0");
                },
                { controllers: [StreamController], listen: true }
            );
        });

        test("returns binary stream response", async () => {
            await withTestApp(
                async (harness) => {
                    const response = await harness.get("/stream/binary-stream");
                    expect(response.status).toBe(200);
                    const buffer = await response.arrayBuffer();
                    expect(buffer.byteLength).toBe(1000);
                    const view = new Uint8Array(buffer);
                    expect(view[0]).toBe(0);
                    expect(view[255]).toBe(255);
                    expect(view[256]).toBe(0);
                },
                { controllers: [StreamController], listen: true }
            );
        });
    });

    // ====================
    // CUSTOM RESPONSE OBJECTS
    // ====================
    describe("Custom Response Objects", () => {
        @Controller("/custom")
        class CustomResponseController {
            @Get("/status-201")
            returnCreated() {
                return new Response(JSON.stringify({ created: true }), {
                    status: 201,
                    headers: { "Content-Type": "application/json" }
                });
            }

            @Get("/status-204")
            returnNoContent() {
                return new Response(null, { status: 204 });
            }

            @Get("/status-301")
            returnPermanentRedirect(@Ctx() ctx: Context) {
                return ctx.redirect("https://example.com", 301);
            }

            @Get("/status-302")
            returnTemporaryRedirect(@Ctx() ctx: Context) {
                return ctx.redirect("https://example.com/temp");
            }

            @Get("/custom-headers")
            returnCustomHeaders() {
                return new Response("OK", {
                    headers: {
                        "X-Custom-Header": "custom-value",
                        "X-Request-Id": "12345",
                        "Cache-Control": "max-age=3600",
                        "ETag": '"abc123"'
                    }
                });
            }

            @Get("/status-via-context/:code")
            returnStatusViaContext(@Ctx() ctx: Context, @Param("code") code: string) {
                ctx.status = parseInt(code, 10);
                return ctx.json({ status: ctx.status });
            }

            @Get("/error-400")
            returnBadRequest() {
                return new Response(JSON.stringify({ error: "Bad Request" }), {
                    status: 400,
                    headers: { "Content-Type": "application/json" }
                });
            }

            @Get("/error-404")
            returnNotFound() {
                return new Response(JSON.stringify({ error: "Not Found" }), {
                    status: 404,
                    headers: { "Content-Type": "application/json" }
                });
            }

            @Get("/error-500")
            returnInternalError() {
                return new Response(JSON.stringify({ error: "Internal Server Error" }), {
                    status: 500,
                    headers: { "Content-Type": "application/json" }
                });
            }

            @Get("/json-via-context")
            returnJsonViaContext(@Ctx() ctx: Context) {
                return ctx.json({ method: "context.json", success: true }, 200);
            }

            @Get("/json-status-created")
            returnJsonCreated(@Ctx() ctx: Context) {
                return ctx.json({ created: true }, 201);
            }
        }

        test("returns 201 Created status", async () => {
            await withTestApp(
                async (harness) => {
                    const response = await harness.get("/custom/status-201");
                    expect(response.status).toBe(201);
                    expect(await response.json()).toEqual({ created: true });
                },
                { controllers: [CustomResponseController], listen: true }
            );
        });

        test("returns 204 No Content", async () => {
            await withTestApp(
                async (harness) => {
                    const response = await harness.get("/custom/status-204");
                    expect(response.status).toBe(204);
                    expect(await response.text()).toBe("");
                },
                { controllers: [CustomResponseController], listen: true }
            );
        });

        test("returns 301 Permanent Redirect", async () => {
            await withTestApp(
                async (harness) => {
                    const response = await harness.request("/custom/status-301", {
                        method: "GET",
                        redirect: "manual"
                    });
                    expect(response.status).toBe(301);
                    expect(response.headers.get("location")).toBe("https://example.com/");
                },
                { controllers: [CustomResponseController], listen: true }
            );
        });

        test("returns 302 Temporary Redirect", async () => {
            await withTestApp(
                async (harness) => {
                    const response = await harness.request("/custom/status-302", {
                        method: "GET",
                        redirect: "manual"
                    });
                    expect(response.status).toBe(302);
                    expect(response.headers.get("location")).toBe("https://example.com/temp");
                },
                { controllers: [CustomResponseController], listen: true }
            );
        });

        test("returns custom headers", async () => {
            await withTestApp(
                async (harness) => {
                    const response = await harness.get("/custom/custom-headers");
                    expect(response.status).toBe(200);
                    expect(response.headers.get("x-custom-header")).toBe("custom-value");
                    expect(response.headers.get("x-request-id")).toBe("12345");
                    expect(response.headers.get("cache-control")).toBe("max-age=3600");
                    expect(response.headers.get("etag")).toBe('"abc123"');
                },
                { controllers: [CustomResponseController], listen: true }
            );
        });

        test("returns dynamic status via context", async () => {
            await withTestApp(
                async (harness) => {
                    const response = await harness.get("/custom/status-via-context/418");
                    expect(response.status).toBe(418);
                    expect(await response.json()).toEqual({ status: 418 });
                },
                { controllers: [CustomResponseController], listen: true }
            );
        });

        test("returns 400 Bad Request", async () => {
            await withTestApp(
                async (harness) => {
                    const response = await harness.get("/custom/error-400");
                    expect(response.status).toBe(400);
                    expect(await response.json()).toEqual({ error: "Bad Request" });
                },
                { controllers: [CustomResponseController], listen: true }
            );
        });

        test("returns 404 Not Found", async () => {
            await withTestApp(
                async (harness) => {
                    const response = await harness.get("/custom/error-404");
                    expect(response.status).toBe(404);
                    expect(await response.json()).toEqual({ error: "Not Found" });
                },
                { controllers: [CustomResponseController], listen: true }
            );
        });

        test("returns 500 Internal Server Error", async () => {
            await withTestApp(
                async (harness) => {
                    const response = await harness.get("/custom/error-500");
                    expect(response.status).toBe(500);
                    expect(await response.json()).toEqual({ error: "Internal Server Error" });
                },
                { controllers: [CustomResponseController], listen: true }
            );
        });

        test("returns JSON via context.json()", async () => {
            await withTestApp(
                async (harness) => {
                    const response = await harness.get("/custom/json-via-context");
                    expect(response.status).toBe(200);
                    expect(await response.json()).toEqual({ method: "context.json", success: true });
                },
                { controllers: [CustomResponseController], listen: true }
            );
        });

        test("returns JSON with custom status via context.json()", async () => {
            await withTestApp(
                async (harness) => {
                    const response = await harness.get("/custom/json-status-created");
                    expect(response.status).toBe(201);
                    expect(await response.json()).toEqual({ created: true });
                },
                { controllers: [CustomResponseController], listen: true }
            );
        });
    });

    // ====================
    // ASYNC RESPONSES
    // ====================
    describe("Async Responses", () => {
        @Controller("/async")
        class AsyncController {
            @Get("/delayed")
            async returnDelayed() {
                await new Promise(resolve => setTimeout(resolve, 50));
                return { message: "delayed response" };
            }

            @Get("/fetch-simulation")
            async simulateFetch() {
                await new Promise(resolve => setTimeout(resolve, 10));
                return {
                    data: [1, 2, 3],
                    fetched: true
                };
            }

            @Get("/parallel")
            async parallelOperations() {
                const [a, b, c] = await Promise.all([
                    Promise.resolve(1),
                    Promise.resolve(2),
                    Promise.resolve(3)
                ]);
                return { sum: a + b + c };
            }

            @Get("/sequential")
            async sequentialOperations() {
                const results: number[] = [];
                for (let i = 0; i < 3; i++) {
                    await new Promise(resolve => setTimeout(resolve, 5));
                    results.push(i);
                }
                return { results };
            }

            @Get("/async-text")
            async asyncText() {
                await new Promise(resolve => setTimeout(resolve, 10));
                return "async text response";
            }

            @Get("/async-stream")
            async asyncStream() {
                await new Promise(resolve => setTimeout(resolve, 10));

                const encoder = new TextEncoder();
                const stream = new ReadableStream({
                    start(controller) {
                        controller.enqueue(encoder.encode("async-stream-data"));
                        controller.close();
                    }
                });

                return new Response(stream, {
                    headers: { "Content-Type": "text/plain" }
                });
            }
        }

        test("returns delayed async response", async () => {
            await withTestApp(
                async (harness) => {
                    const start = Date.now();
                    const response = await harness.get("/async/delayed");
                    const elapsed = Date.now() - start;

                    expect(response.status).toBe(200);
                    expect(elapsed).toBeGreaterThanOrEqual(40); // Allow some tolerance
                    expect(await response.json()).toEqual({ message: "delayed response" });
                },
                { controllers: [AsyncController], listen: true }
            );
        });

        test("returns async fetch simulation", async () => {
            await withTestApp(
                async (harness) => {
                    const response = await harness.get("/async/fetch-simulation");
                    expect(response.status).toBe(200);
                    expect(await response.json()).toEqual({ data: [1, 2, 3], fetched: true });
                },
                { controllers: [AsyncController], listen: true }
            );
        });

        test("handles parallel async operations", async () => {
            await withTestApp(
                async (harness) => {
                    const response = await harness.get("/async/parallel");
                    expect(response.status).toBe(200);
                    expect(await response.json()).toEqual({ sum: 6 });
                },
                { controllers: [AsyncController], listen: true }
            );
        });

        test("handles sequential async operations", async () => {
            await withTestApp(
                async (harness) => {
                    const response = await harness.get("/async/sequential");
                    expect(response.status).toBe(200);
                    expect(await response.json()).toEqual({ results: [0, 1, 2] });
                },
                { controllers: [AsyncController], listen: true }
            );
        });

        test("returns async text response", async () => {
            await withTestApp(
                async (harness) => {
                    const response = await harness.get("/async/async-text");
                    expect(response.status).toBe(200);
                    expect(await response.text()).toBe("async text response");
                },
                { controllers: [AsyncController], listen: true }
            );
        });

        test("returns async stream response", async () => {
            await withTestApp(
                async (harness) => {
                    const response = await harness.get("/async/async-stream");
                    expect(response.status).toBe(200);
                    expect(await response.text()).toBe("async-stream-data");
                },
                { controllers: [AsyncController], listen: true }
            );
        });
    });

    // ====================
    // EDGE CASES & SPECIAL SCENARIOS
    // ====================
    describe("Edge Cases", () => {
        @Controller("/edge")
        class EdgeCaseController {
            @Get("/undefined")
            returnUndefined() {
                return undefined;
            }

            @Get("/void")
            returnVoid(): void {
                // Intentionally return nothing
            }

            @Get("/promise-undefined")
            async returnPromiseUndefined() {
                await Promise.resolve();
                return undefined;
            }

            @Get("/very-large-json")
            returnVeryLargeJson() {
                const obj: any = {};
                for (let i = 0; i < 100; i++) {
                    obj[`key${i}`] = {
                        id: i,
                        name: `name-${i}`,
                        values: Array.from({ length: 100 }, (_, j) => j * i)
                    };
                }
                return obj;
            }

            @Get("/circular-safe")
            returnCircularSafe() {
                // Return a safe non-circular object
                const obj = { a: 1, b: { c: 2 } };
                return obj;
            }

            @Get("/date")
            returnDate() {
                const date = new Date("2025-01-09T12:00:00.000Z");
                return { date: date.toISOString(), timestamp: date.getTime() };
            }

            @Get("/regexp")
            returnRegExpAsString() {
                return { pattern: "/test/gi", flags: "gi" };
            }

            @Get("/symbol-removed")
            returnSymbolRemoved() {
                const obj: any = { visible: "yes" };
                obj[Symbol("hidden")] = "hidden value";
                return obj;
            }

            @Get("/bigint")
            returnBigIntAsString() {
                // BigInt cannot be serialized directly to JSON
                const big = 9007199254740991n;
                return { value: big.toString(), type: "bigint" };
            }

            @Get("/infinity")
            returnInfinity() {
                // Infinity becomes null in JSON
                return {
                    positive: null, // Would be Infinity
                    negative: null, // Would be -Infinity
                    note: "Infinity serializes as null"
                };
            }

            @Get("/nan")
            returnNaN() {
                // NaN becomes null in JSON
                return {
                    value: null, // Would be NaN
                    note: "NaN serializes as null"
                };
            }

            @Get("/typed-array")
            returnTypedArray() {
                const arr = new Int32Array([1, 2, 3, 4, 5]);
                return new Response(arr.buffer, {
                    headers: { "Content-Type": "application/octet-stream" }
                });
            }
        }

        test("handles undefined return value", async () => {
            await withTestApp(
                async (harness) => {
                    const response = await harness.get("/edge/undefined");
                    expect(response.status).toBe(204);
                    expect(await response.text()).toBe("");
                },
                { controllers: [EdgeCaseController], listen: true }
            );
        });

        test("handles void return value", async () => {
            await withTestApp(
                async (harness) => {
                    const response = await harness.get("/edge/void");
                    expect(response.status).toBe(204);
                    expect(await response.text()).toBe("");
                },
                { controllers: [EdgeCaseController], listen: true }
            );
        });

        test("handles async undefined return", async () => {
            await withTestApp(
                async (harness) => {
                    const response = await harness.get("/edge/promise-undefined");
                    expect(response.status).toBe(204);
                    expect(await response.text()).toBe("");
                },
                { controllers: [EdgeCaseController], listen: true }
            );
        });

        test("handles very large JSON response", async () => {
            await withTestApp(
                async (harness) => {
                    const response = await harness.get("/edge/very-large-json");
                    expect(response.status).toBe(200);
                    const data = await response.json();
                    expect(Object.keys(data)).toHaveLength(100);
                    expect(data.key0.values).toHaveLength(100);
                },
                { controllers: [EdgeCaseController], listen: true }
            );
        });

        test("handles nested objects safely", async () => {
            await withTestApp(
                async (harness) => {
                    const response = await harness.get("/edge/circular-safe");
                    expect(response.status).toBe(200);
                    expect(await response.json()).toEqual({ a: 1, b: { c: 2 } });
                },
                { controllers: [EdgeCaseController], listen: true }
            );
        });

        test("handles date serialization", async () => {
            await withTestApp(
                async (harness) => {
                    const response = await harness.get("/edge/date");
                    expect(response.status).toBe(200);
                    const data = await response.json();
                    expect(data.date).toBe("2025-01-09T12:00:00.000Z");
                    expect(data.timestamp).toBe(1736424000000);
                },
                { controllers: [EdgeCaseController], listen: true }
            );
        });

        test("handles regexp as object", async () => {
            await withTestApp(
                async (harness) => {
                    const response = await harness.get("/edge/regexp");
                    expect(response.status).toBe(200);
                    const data = await response.json();
                    expect(data.pattern).toBe("/test/gi");
                    expect(data.flags).toBe("gi");
                },
                { controllers: [EdgeCaseController], listen: true }
            );
        });

        test("symbols are removed during serialization", async () => {
            await withTestApp(
                async (harness) => {
                    const response = await harness.get("/edge/symbol-removed");
                    expect(response.status).toBe(200);
                    const data = await response.json();
                    expect(data.visible).toBe("yes");
                    expect(Object.keys(data)).toEqual(["visible"]);
                },
                { controllers: [EdgeCaseController], listen: true }
            );
        });

        test("handles bigint as string", async () => {
            await withTestApp(
                async (harness) => {
                    const response = await harness.get("/edge/bigint");
                    expect(response.status).toBe(200);
                    const data = await response.json();
                    expect(data.value).toBe("9007199254740991");
                    expect(data.type).toBe("bigint");
                },
                { controllers: [EdgeCaseController], listen: true }
            );
        });

        test("handles typed array buffer", async () => {
            await withTestApp(
                async (harness) => {
                    const response = await harness.get("/edge/typed-array");
                    expect(response.status).toBe(200);
                    expect(response.headers.get("content-type")).toContain("application/octet-stream");
                    const buffer = await response.arrayBuffer();
                    const view = new Int32Array(buffer);
                    expect(view[0]).toBe(1);
                    expect(view[4]).toBe(5);
                },
                { controllers: [EdgeCaseController], listen: true }
            );
        });
    });

    // ====================
    // CONTENT NEGOTIATION
    // ====================
    describe("Content Negotiation", () => {
        @Controller("/content")
        class ContentController {
            @Get("/accept/:format")
            respondByFormat(@Param("format") format: string) {
                switch (format) {
                    case "json":
                        return new Response(JSON.stringify({ format: "json" }), {
                            headers: { "Content-Type": "application/json" }
                        });
                    case "xml":
                        return new Response("<root><format>xml</format></root>", {
                            headers: { "Content-Type": "application/xml" }
                        });
                    case "text":
                        return new Response("format: text", {
                            headers: { "Content-Type": "text/plain" }
                        });
                    case "html":
                        return new Response("<html><body>format: html</body></html>", {
                            headers: { "Content-Type": "text/html" }
                        });
                    default:
                        return new Response("Unknown format", { status: 400 });
                }
            }

            @Get("/charset")
            returnWithCharset() {
                return new Response("UTF-8 Content: 日本語", {
                    headers: { "Content-Type": "text/plain; charset=utf-8" }
                });
            }

            @Get("/multiple-headers")
            returnMultipleHeaders() {
                const headers = new Headers();
                headers.append("Set-Cookie", "session=abc123; HttpOnly");
                headers.append("Set-Cookie", "user=john; HttpOnly");
                headers.set("Content-Type", "application/json");

                return new Response(JSON.stringify({ success: true }), { headers });
            }
        }

        test("returns JSON format", async () => {
            await withTestApp(
                async (harness) => {
                    const response = await harness.get("/content/accept/json");
                    expect(response.status).toBe(200);
                    expect(response.headers.get("content-type")).toBe("application/json");
                    expect(await response.json()).toEqual({ format: "json" });
                },
                { controllers: [ContentController], listen: true }
            );
        });

        test("returns XML format", async () => {
            await withTestApp(
                async (harness) => {
                    const response = await harness.get("/content/accept/xml");
                    expect(response.status).toBe(200);
                    expect(response.headers.get("content-type")).toBe("application/xml");
                    expect(await response.text()).toBe("<root><format>xml</format></root>");
                },
                { controllers: [ContentController], listen: true }
            );
        });

        test("returns text format", async () => {
            await withTestApp(
                async (harness) => {
                    const response = await harness.get("/content/accept/text");
                    expect(response.status).toBe(200);
                    expect(response.headers.get("content-type")).toBe("text/plain");
                    expect(await response.text()).toBe("format: text");
                },
                { controllers: [ContentController], listen: true }
            );
        });

        test("returns HTML format", async () => {
            await withTestApp(
                async (harness) => {
                    const response = await harness.get("/content/accept/html");
                    expect(response.status).toBe(200);
                    expect(response.headers.get("content-type")).toBe("text/html");
                    expect(await response.text()).toContain("format: html");
                },
                { controllers: [ContentController], listen: true }
            );
        });

        test("returns 400 for unknown format", async () => {
            await withTestApp(
                async (harness) => {
                    const response = await harness.get("/content/accept/unknown");
                    expect(response.status).toBe(400);
                },
                { controllers: [ContentController], listen: true }
            );
        });

        test("returns content with charset", async () => {
            await withTestApp(
                async (harness) => {
                    const response = await harness.get("/content/charset");
                    expect(response.status).toBe(200);
                    expect(response.headers.get("content-type")).toContain("utf-8");
                    expect(await response.text()).toBe("UTF-8 Content: 日本語");
                },
                { controllers: [ContentController], listen: true }
            );
        });

        test("handles multiple Set-Cookie headers", async () => {
            await withTestApp(
                async (harness) => {
                    const response = await harness.get("/content/multiple-headers");
                    expect(response.status).toBe(200);
                    const setCookie = response.headers.getSetCookie();
                    expect(setCookie.length).toBeGreaterThanOrEqual(1);
                },
                { controllers: [ContentController], listen: true }
            );
        });
    });
});
