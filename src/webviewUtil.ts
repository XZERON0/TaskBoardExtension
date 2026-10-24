import * as vscode from 'vscode';
import { randomBytes } from 'crypto';

export function mediaUri(ctx: vscode.ExtensionContext, webview: vscode.Webview, file: string): vscode.Uri {
  return webview.asWebviewUri(vscode.Uri.joinPath(ctx.extensionUri, 'media', file));
}

export function webviewOptions(ctx: vscode.ExtensionContext): vscode.WebviewPanelOptions & vscode.WebviewOptions {
  return { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(ctx.extensionUri, 'media')] };
}

/** JSON that is safe to embed inside a <script> tag. */
export function jsonForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

export function page(
  ctx: vscode.ExtensionContext,
  webview: vscode.Webview,
  opts: { title: string; script: string; data: Record<string, unknown>; body: string }
): string {
  const nonce = randomBytes(16).toString('hex');
  const csp = [
    `default-src 'none'`,
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `script-src 'nonce-${nonce}'`,
  ].join('; ');
  const data = Object.entries(opts.data)
    .map(([k, v]) => `window.${k} = ${jsonForScript(v)};`)
    .join('\n');
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${opts.title}</title>
  <link rel="stylesheet" href="${mediaUri(ctx, webview, 'webview.css')}">
</head>
<body>
${opts.body}
<script nonce="${nonce}">${data}</script>
<script nonce="${nonce}" src="${mediaUri(ctx, webview, opts.script)}"></script>
</body>
</html>`;
}
