import { readdirSync, readFileSync, existsSync } from 'fs';
import { join, resolve, sep } from 'path';

function isValidInfoJson(infoPath) {
  try {
    const content = readFileSync(infoPath, 'utf8');
    const info = JSON.parse(content);

    if (!info || typeof info.description !== 'string' || !Array.isArray(info.features)) {
      return false;
    }

    for (const feature of info.features) {
      if (typeof feature.script !== 'string' ||
          typeof feature.description !== 'string' ||
          typeof feature.usage !== 'string') {
        return false;
      }
    }

    return true;
  } catch (error) {
    return false;
  }
}

export function listPlugins(pluginsDir) {
  if (!existsSync(pluginsDir)) {
    return { plugins: [], error: 'No valid plugins found (plugins/ directory does not exist)' };
  }

  const entries = readdirSync(pluginsDir, { withFileTypes: true });

  const plugins = [];
  const warnings = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const pluginDir = join(pluginsDir, entry.name);
    const infoPath = join(pluginDir, 'info.json');

    if (!existsSync(infoPath)) continue;

    if (!isValidInfoJson(infoPath)) {
      warnings.push(`${entry.name}/info.json format is invalid, skipping`);
      continue;
    }

    try {
      const content = readFileSync(infoPath, 'utf8');
      const info = JSON.parse(content);

      plugins.push({
        name: entry.name,
        description: info.description,
        relativePath: `plugins/${entry.name}`,
        features: info.features
      });
    } catch (error) {
      warnings.push(`Failed to read ${entry.name}/info.json: ${error.message}`);
    }
  }

  return { plugins, warnings };
}

export function formatPluginList(pluginsDir) {
  const { plugins, warnings, error } = listPlugins(pluginsDir);

  if (error) return error;

  const lines = [];

  if (warnings && warnings.length > 0) {
    for (const w of warnings) {
      lines.push(`Warning: ${w}`);
    }
    lines.push('');
  }

  if (plugins.length === 0) {
    lines.push('No valid plugins found');
    return lines.join('\n');
  }

  lines.push('\nAvailable Plugins:\n');
  lines.push('Relative Path'.padEnd(28) + 'Description');
  lines.push('\u2500'.repeat(80));

  for (const plugin of plugins) {
    lines.push(plugin.relativePath.padEnd(28) + plugin.description);
  }

  lines.push('\nTotal: ' + plugins.length + ' plugin(s)');
  return lines.join('\n');
}

export function showPluginDetail(pluginsDir, pluginName) {
  if (pluginName.includes('/') || pluginName.includes('\\') || pluginName === '.' || pluginName === '..') {
    return { error: `Invalid plugin name "${pluginName}"` };
  }

  const pluginDir = resolve(pluginsDir, pluginName);

  if (!pluginDir.startsWith(pluginsDir + sep)) {
    return { error: `Invalid plugin name "${pluginName}"` };
  }

  const infoPath = join(pluginDir, 'info.json');

  if (!existsSync(infoPath)) {
    return { error: `Plugin "${pluginName}" does not exist or is missing info.json` };
  }

  if (!isValidInfoJson(infoPath)) {
    return { error: `Plugin "${pluginName}" has an invalid info.json format` };
  }

  try {
    const content = readFileSync(infoPath, 'utf8');
    const info = JSON.parse(content);

    const lines = ['\nPlugin Details:\n'];
    lines.push('\u2500'.repeat(60));
    lines.push(`Description: ${info.description}`);

    const actualScripts = [];
    const entries = readdirSync(pluginDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.mjs') && entry.name !== 'index.mjs') {
        actualScripts.push(entry.name);
      }
    }

    const registeredScripts = new Set(
      (info.features || []).map(f => f.script)
    );

    const unregisteredScripts = actualScripts.filter(s => !registeredScripts.has(s));

    if (info.features && info.features.length > 0) {
      lines.push('\nFeatures:\n');
      for (const feature of info.features) {
        const scriptExists = actualScripts.includes(feature.script);
        const status = scriptExists ? '' : ' [file not found]';
        lines.push(`    Script: ${feature.script}${status}`);
        lines.push(`    Description: ${feature.description}`);
        lines.push(`    Usage: ${feature.usage}`);
        lines.push('');
      }
    }

    if (unregisteredScripts.length > 0) {
      lines.push('\u2500'.repeat(60));
      lines.push('\nWarning: unregistered scripts found:\n');
      for (const script of unregisteredScripts) {
        lines.push(`    - ${script}`);
      }
      lines.push('\nPlease add metadata for these scripts in the info.json features array.');
    }

    lines.push('\u2500'.repeat(60));
    lines.push('\nTip: all scripts support -h, --help for detailed usage');

    return { output: lines.join('\n') };
  } catch (error) {
    return { error: `Failed to read plugin info: ${error.message}` };
  }
}