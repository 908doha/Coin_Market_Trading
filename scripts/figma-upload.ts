/**
 * Figma Design System Upload Script
 * ──────────────────────────────────────────────────────────────────────────
 * Uploads design tokens to Figma as Variables (color, number, string).
 * Uses the Figma Variables REST API (requires Professional plan or above).
 *
 * Usage:
 *   FIGMA_TOKEN=<your-token> FIGMA_FILE_KEY=<file-key> npm run figma:upload
 *
 * How to get credentials:
 *   - FIGMA_TOKEN: Figma → Settings → Personal access tokens → Generate new token
 *   - FIGMA_FILE_KEY: From your Figma file URL:
 *       https://www.figma.com/file/<FILE_KEY>/...
 * ──────────────────────────────────────────────────────────────────────────
 */

import https from 'https';

// ─── Config ──────────────────────────────────────────────────────────────────

const FIGMA_TOKEN   = process.env.FIGMA_TOKEN   ?? '';
const FIGMA_FILE_KEY = process.env.FIGMA_FILE_KEY ?? '';

if (!FIGMA_TOKEN || !FIGMA_FILE_KEY) {
  console.error(
    '\n❌  Missing env vars.\n' +
    '    Set FIGMA_TOKEN and FIGMA_FILE_KEY before running:\n\n' +
    '    FIGMA_TOKEN=xxx FIGMA_FILE_KEY=yyy npm run figma:upload\n'
  );
  process.exit(1);
}

// ─── Figma API helpers ────────────────────────────────────────────────────────

function figmaRequest<T>(
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : undefined;
    const options: https.RequestOptions = {
      hostname: 'api.figma.com',
      path,
      method,
      headers: {
        'X-Figma-Token': FIGMA_TOKEN,
        'Content-Type':  'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    };

    const req = https.request(options, (res) => {
      let raw = '';
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(raw);
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`Figma API ${res.statusCode}: ${raw}`));
          } else {
            resolve(parsed as T);
          }
        } catch {
          reject(new Error(`Failed to parse response: ${raw}`));
        }
      });
    });

    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

// ─── Token definitions ────────────────────────────────────────────────────────

interface FigmaVariableCollection {
  id:           string;
  name:         string;
  variableIds:  string[];
}

interface FigmaVariableCreatePayload {
  variableCollections?: Array<{
    action: 'CREATE';
    id:     string;
    name:   string;
    initialModeId: string;
  }>;
  variableModeUpdates?: Array<{
    action:     'UPDATE';
    id:         string;
    variableCollectionId: string;
    name:       string;
  }>;
  variables?: Array<{
    action:      'CREATE';
    id:          string;
    name:        string;
    variableCollectionId: string;
    resolvedType: 'COLOR' | 'FLOAT' | 'STRING' | 'BOOLEAN';
    description?: string;
  }>;
  variableModeValues?: Array<{
    variableId:   string;
    modeId:       string;
    value:        unknown;
  }>;
}

// Hex → Figma RGBA (0–1 range)
function hexToFigmaColor(hex: string): { r: number; g: number; b: number; a: number } {
  const h = hex.replace('#', '');
  const bigint = parseInt(h, 16);
  return {
    r: ((bigint >> 16) & 255) / 255,
    g: ((bigint >> 8)  & 255) / 255,
    b: (bigint         & 255) / 255,
    a: 1,
  };
}

// ─── Main upload logic ────────────────────────────────────────────────────────

let idCounter = 0;
const tempId = () => `temp-${++idCounter}`;

async function uploadDesignSystem() {
  console.log('\n🎨  Coin Market Trading — Figma Design System Upload');
  console.log('═'.repeat(55));

  // ── Step 1: Get existing file data ──────────────────────────
  console.log('\n📁  Fetching file info...');
  const fileData = await figmaRequest<{ name: string }>('GET', `/v1/files/${FIGMA_FILE_KEY}?depth=1`);
  console.log(`    File: "${fileData.name}"`);

  // ── Step 2: Build variable payload ──────────────────────────
  const payload: FigmaVariableCreatePayload = {
    variableCollections: [],
    variableModeUpdates: [],
    variables:           [],
    variableModeValues:  [],
  };

  // ── Colors Collection ────────────────────────────────────────
  const colorCollId  = tempId();
  const colorModeId  = tempId();

  payload.variableCollections!.push({
    action:        'CREATE',
    id:            colorCollId,
    name:          '🎨 Colors',
    initialModeId: colorModeId,
  });
  payload.variableModeUpdates!.push({
    action:                'UPDATE',
    id:                    colorModeId,
    variableCollectionId:  colorCollId,
    name:                  'Default',
  });

  const colorTokens: Array<{ name: string; value: string; description?: string }> = [
    // Primary
    { name: 'primary/default',    value: '#000000', description: 'Brand primary' },
    { name: 'primary/subtle',     value: '#1A1A1A' },
    { name: 'primary/muted',      value: '#2E2E2E' },
    { name: 'primary/foreground', value: '#FFFFFF' },
    // Grays
    { name: 'gray/950', value: '#0A0A0A' },
    { name: 'gray/900', value: '#1A1A1A' },
    { name: 'gray/800', value: '#2E2E2E' },
    { name: 'gray/700', value: '#404040' },
    { name: 'gray/600', value: '#525252' },
    { name: 'gray/500', value: '#737373' },
    { name: 'gray/400', value: '#A3A3A3' },
    { name: 'gray/300', value: '#C4C4C4' },
    { name: 'gray/200', value: '#D9D9D9' },
    { name: 'gray/100', value: '#EBEBEB' },
    { name: 'gray/50',  value: '#F5F5F5' },
    { name: 'gray/25',  value: '#FAFAFA' },
    // Backgrounds
    { name: 'bg/default',  value: '#FFFFFF' },
    { name: 'bg/subtle',   value: '#FAFAFA' },
    { name: 'bg/elevated', value: '#F5F5F5' },
    { name: 'bg/inverse',  value: '#000000' },
    // Text
    { name: 'text/primary',     value: '#000000' },
    { name: 'text/secondary',   value: '#404040' },
    { name: 'text/tertiary',    value: '#737373' },
    { name: 'text/disabled',    value: '#A3A3A3' },
    { name: 'text/inverse',     value: '#FFFFFF' },
    { name: 'text/hint',        value: '#A3A3A3' },
    // Borders
    { name: 'border/default',  value: '#EBEBEB' },
    { name: 'border/strong',   value: '#D9D9D9' },
    { name: 'border/focus',    value: '#000000' },
    // Semantic
    { name: 'positive/default',    value: '#1AC24E', description: 'Success green' },
    { name: 'positive/subtle',     value: '#EDFBF3' },
    { name: 'positive/text',       value: '#0D9E45' },
    { name: 'negative/default',    value: '#FF4747', description: 'Error red' },
    { name: 'negative/subtle',     value: '#FFF0F0' },
    { name: 'negative/text',       value: '#D93025' },
    { name: 'cautious/default',    value: '#FF8A00', description: 'Warning orange' },
    { name: 'cautious/subtle',     value: '#FFF8E8' },
    { name: 'cautious/text',       value: '#D97706' },
    { name: 'informative/default', value: '#246CF9', description: 'Info blue' },
    { name: 'informative/subtle',  value: '#EEF5FF' },
    { name: 'informative/text',    value: '#1741C4' },
    // Market (Korean convention)
    { name: 'market/rise',    value: '#FF4747', description: 'Korean: red = up' },
    { name: 'market/fall',    value: '#246CF9', description: 'Korean: blue = down' },
    { name: 'market/neutral', value: '#737373' },
  ];

  for (const token of colorTokens) {
    const varId = tempId();
    payload.variables!.push({
      action:                'CREATE',
      id:                    varId,
      name:                  token.name,
      variableCollectionId:  colorCollId,
      resolvedType:          'COLOR',
      description:           token.description,
    });
    payload.variableModeValues!.push({
      variableId: varId,
      modeId:     colorModeId,
      value:      hexToFigmaColor(token.value),
    });
  }

  // ── Spacing Collection ───────────────────────────────────────
  const spacingCollId = tempId();
  const spacingModeId = tempId();

  payload.variableCollections!.push({
    action:        'CREATE',
    id:            spacingCollId,
    name:          '📐 Spacing',
    initialModeId: spacingModeId,
  });
  payload.variableModeUpdates!.push({
    action:               'UPDATE',
    id:                   spacingModeId,
    variableCollectionId: spacingCollId,
    name:                 'Default',
  });

  const spacingTokens: Array<{ name: string; value: number }> = [
    { name: 'spacing/0',    value: 0   },
    { name: 'spacing/0.5',  value: 2   },
    { name: 'spacing/1',    value: 4   },
    { name: 'spacing/1.5',  value: 6   },
    { name: 'spacing/2',    value: 8   },
    { name: 'spacing/2.5',  value: 10  },
    { name: 'spacing/3',    value: 12  },
    { name: 'spacing/3.5',  value: 14  },
    { name: 'spacing/4',    value: 16  },
    { name: 'spacing/5',    value: 20  },
    { name: 'spacing/6',    value: 24  },
    { name: 'spacing/7',    value: 28  },
    { name: 'spacing/8',    value: 32  },
    { name: 'spacing/10',   value: 40  },
    { name: 'spacing/12',   value: 48  },
    { name: 'spacing/14',   value: 56  },
    { name: 'spacing/16',   value: 64  },
    { name: 'spacing/20',   value: 80  },
  ];

  for (const token of spacingTokens) {
    const varId = tempId();
    payload.variables!.push({
      action:               'CREATE',
      id:                   varId,
      name:                 token.name,
      variableCollectionId: spacingCollId,
      resolvedType:         'FLOAT',
    });
    payload.variableModeValues!.push({
      variableId: varId,
      modeId:     spacingModeId,
      value:      token.value,
    });
  }

  // ── Border Radius Collection ─────────────────────────────────
  const radiusCollId = tempId();
  const radiusModeId = tempId();

  payload.variableCollections!.push({
    action:        'CREATE',
    id:            radiusCollId,
    name:          '🔘 Border Radius',
    initialModeId: radiusModeId,
  });
  payload.variableModeUpdates!.push({
    action:               'UPDATE',
    id:                   radiusModeId,
    variableCollectionId: radiusCollId,
    name:                 'Default',
  });

  const radiusTokens: Array<{ name: string; value: number }> = [
    { name: 'radius/none',  value: 0    },
    { name: 'radius/xs',    value: 4    },
    { name: 'radius/sm',    value: 8    },
    { name: 'radius/md',    value: 12   },
    { name: 'radius/lg',    value: 16   },
    { name: 'radius/xl',    value: 20   },
    { name: 'radius/2xl',   value: 24   },
    { name: 'radius/3xl',   value: 28   },
    { name: 'radius/4xl',   value: 32   },
    { name: 'radius/full',  value: 9999 },
  ];

  for (const token of radiusTokens) {
    const varId = tempId();
    payload.variables!.push({
      action:               'CREATE',
      id:                   varId,
      name:                 token.name,
      variableCollectionId: radiusCollId,
      resolvedType:         'FLOAT',
    });
    payload.variableModeValues!.push({
      variableId: varId,
      modeId:     radiusModeId,
      value:      token.value,
    });
  }

  // ── Typography Collection (font sizes as numbers) ────────────
  const typoCollId = tempId();
  const typoModeId = tempId();

  payload.variableCollections!.push({
    action:        'CREATE',
    id:            typoCollId,
    name:          '✏️  Typography',
    initialModeId: typoModeId,
  });
  payload.variableModeUpdates!.push({
    action:               'UPDATE',
    id:                   typoModeId,
    variableCollectionId: typoCollId,
    name:                 'Default',
  });

  const fontSizeTokens: Array<{ name: string; value: number }> = [
    { name: 'fontSize/caption2',      value: 11 },
    { name: 'fontSize/caption1',      value: 12 },
    { name: 'fontSize/label2',        value: 13 },
    { name: 'fontSize/label1',        value: 14 },
    { name: 'fontSize/body2',         value: 15 },
    { name: 'fontSize/body1',         value: 16 },
    { name: 'fontSize/heading3',      value: 17 },
    { name: 'fontSize/heading2',      value: 18 },
    { name: 'fontSize/heading1',      value: 20 },
    { name: 'fontSize/title3',        value: 22 },
    { name: 'fontSize/title2',        value: 24 },
    { name: 'fontSize/title1',        value: 28 },
    { name: 'fontSize/display1',      value: 32 },
    { name: 'fontSize/display2',      value: 36 },
    { name: 'fontWeight/regular',     value: 400 },
    { name: 'fontWeight/medium',      value: 500 },
    { name: 'fontWeight/semiBold',    value: 600 },
    { name: 'fontWeight/bold',        value: 700 },
  ];

  for (const token of fontSizeTokens) {
    const varId = tempId();
    payload.variables!.push({
      action:               'CREATE',
      id:                   varId,
      name:                 token.name,
      variableCollectionId: typoCollId,
      resolvedType:         'FLOAT',
    });
    payload.variableModeValues!.push({
      variableId: varId,
      modeId:     typoModeId,
      value:      token.value,
    });
  }

  // ── Step 3: POST to Figma ────────────────────────────────────
  console.log(
    `\n📤  Uploading...\n` +
    `    Collections: ${payload.variableCollections!.length}\n` +
    `    Variables:   ${payload.variables!.length}\n`
  );

  try {
    const result = await figmaRequest<{ status: number; error?: string }>(
      'POST',
      `/v1/files/${FIGMA_FILE_KEY}/variables`,
      payload,
    );

    if (result.error) {
      console.error(`\n❌  Figma API error: ${result.error}`);
      process.exit(1);
    }

    console.log('✅  Upload complete!\n');
    console.log('    Open your Figma file → Local variables panel to see:');
    console.log('    🎨 Colors · 📐 Spacing · 🔘 Border Radius · ✏️  Typography\n');
    console.log(`    https://www.figma.com/file/${FIGMA_FILE_KEY}\n`);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`\n❌  Upload failed: ${message}`);
    if (message.includes('403')) {
      console.error(
        '\n    ⚠️  403 Forbidden — Figma Variables API requires Professional plan.\n' +
        '    Alternative: Import design-tokens.json via Token Studio plugin.\n' +
        '    Plugin: https://www.figma.com/community/plugin/843461159747178978\n'
      );
    }
    process.exit(1);
  }
}

uploadDesignSystem();
