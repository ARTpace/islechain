"""Real SDK server for the MCP integration test; no project files are modified."""
import base64

from mcp.server.fastmcp import Context, FastMCP
from mcp.types import ImageContent, TextContent, ToolAnnotations

app = FastMCP('art-canvas-test')

# 1x1 transparent PNG.
PNG = base64.b64decode(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==')


@app.tool()
def add(left: int, right: int) -> int:
    """Add two integers."""
    return left + right


@app.tool()
def private_tool() -> str:
    """Must not be exposed unless explicitly enabled."""
    return 'not-authorized'


@app.tool(annotations=ToolAnnotations(readOnlyHint=True))
def peek() -> str:
    """Read-only tool; it never needs an approval."""
    return 'peeked'


@app.tool(annotations=ToolAnnotations(readOnlyHint=False, destructiveHint=True))
def smash() -> str:
    """Destructive tool; it needs an approval before it runs."""
    return 'smashed'


@app.tool()
def picture() -> ImageContent:
    """Returns an image so the client can attach it to the model context."""
    return ImageContent(type='image', data=base64.b64encode(PNG).decode(), mimeType='image/png')


@app.tool()
async def slow(ctx: Context, steps: int = 3) -> str:
    """Reports progress notifications while it runs."""
    for step in range(max(1, steps)):
        await ctx.report_progress(step, max(1, steps), f'第 {step} 步')
    return 'done'


@app.resource('test://memo')
def memo() -> str:
    """A text resource."""
    return '备忘录内容'


@app.prompt()
def greet(topic: str) -> str:
    """A prompt template."""
    return f'请围绕 {topic} 生成一段描述'


if __name__ == '__main__':
    app.run(transport='stdio')
