import { readdirSync, readFileSync, existsSync } from 'fs';
import { join, resolve, sep, extname } from 'path';

function isValidInfoJson(infoPath) {
  try {
    const content = readFileSync(infoPath, 'utf8');
    const info = JSON.parse(content);

    if (!info || typeof info.description !== 'string' || !Array.isArray(info.features)) {
      return false;
    }

    for (const feature of info.features) {
      if (typeof feature.entry !== 'string' || !feature.entry.trim() ||
          typeof feature.description !== 'string' || !feature.description.trim() ||
          typeof feature.usage !== 'string' || !feature.usage.trim()) {
        return false;
      }
    }

    return true;
  } catch (error) {
    return false;
  }
}

export function getEntryType(feature) {
  if (feature.type === 'doc') return 'doc';
  if (feature.type === 'script') return 'script';
  const ext = extname(feature.entry || '');
  if (ext === '.md') return 'doc';
  return 'script';
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

    const actualFiles = new Set();
    const entries = readdirSync(pluginDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile()) {
        actualFiles.add(entry.name);
      }
    }

    const registeredEntries = new Set(
      (info.features || []).map(f => f.entry.startsWith('./') ? f.entry.slice(2) : f.entry)
    );

    const unregisteredEntries = [...actualFiles].filter(s => s.endsWith('.mjs') && s !== 'index.mjs' && !registeredEntries.has(s));

    if (info.features && info.features.length > 0) {
      lines.push('\nFeatures:\n');
      for (const feature of info.features) {
        const entryType = getEntryType(feature);
        const label = entryType === 'doc' ? 'Doc' : 'Script';
        const usageLabel = entryType === 'doc' ? 'Reference' : 'Usage';
        const fileExists = actualFiles.has(feature.entry) || existsSync(join(pluginDir, feature.entry));
        const status = fileExists ? '' : ' [file not found]';
        lines.push(`    ${label}: ${feature.entry}${status}`);
        lines.push(`    Description: ${feature.description}`);
        lines.push(`    ${usageLabel}: ${feature.usage}`);
        lines.push('');
      }
    }

    if (unregisteredEntries.length > 0) {
      lines.push('\u2500'.repeat(60));
      lines.push('\nWarning: unregistered entries found:\n');
      for (const ent of unregisteredEntries) {
        lines.push(`    - ${ent}`);
      }
      lines.push('\nPlease add metadata for these entries in the info.json features array.');
    }

    lines.push('\u2500'.repeat(60));
    lines.push('\nTip: all scripts support -h, --help for detailed usage');

    return { output: lines.join('\n') };
  } catch (error) {
    return { error: `Failed to read plugin info: ${error.message}` };
  }
}