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
        return { plugins: [], error: '未找到任何有效插件（plugins/ 目录不存在）' };
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
            warnings.push(`${entry.name}/info.json 格式无效，跳过`);
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
            warnings.push(`${entry.name}/info.json 读取失败: ${error.message}`);
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
            lines.push(`警告: ${w}`);
        }
        lines.push('');
    }

    if (plugins.length === 0) {
        lines.push('未找到任何有效插件');
        return lines.join('\n');
    }

    lines.push('\n可用插件列表:\n');
    lines.push('相对路径'.padEnd(28) + '描述');
    lines.push('─'.repeat(80));

    for (const plugin of plugins) {
        lines.push(plugin.relativePath.padEnd(28) + plugin.description);
    }

    lines.push('\n总计: ' + plugins.length + ' 个插件');
    return lines.join('\n');
}

export function showPluginDetail(pluginsDir, pluginName) {
    if (pluginName.includes('/') || pluginName.includes('\\') || pluginName === '.' || pluginName === '..') {
        return { error: `无效的插件名称 "${pluginName}"` };
    }

    const pluginDir = resolve(pluginsDir, pluginName);

    if (!pluginDir.startsWith(pluginsDir + sep)) {
        return { error: `无效的插件名称 "${pluginName}"` };
    }

    const infoPath = join(pluginDir, 'info.json');

    if (!existsSync(infoPath)) {
        return { error: `插件 "${pluginName}" 不存在或缺少info.json文件` };
    }

    if (!isValidInfoJson(infoPath)) {
        return { error: `插件 "${pluginName}" 的info.json格式无效` };
    }

    try {
        const content = readFileSync(infoPath, 'utf8');
        const info = JSON.parse(content);

        const lines = ['\n插件详细信息:\n'];
        lines.push('─'.repeat(60));
        lines.push(`插件描述: ${info.description}`);

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
            lines.push('\n功能列表:\n');
            for (const feature of info.features) {
                const scriptExists = actualScripts.includes(feature.script);
                const status = scriptExists ? '' : ' [文件不存在]';
                lines.push(`    脚本: ${feature.script}${status}`);
                lines.push(`    描述: ${feature.description}`);
                lines.push(`    用法: ${feature.usage}`);
                lines.push('');
            }
        }

        if (unregisteredScripts.length > 0) {
            lines.push('─'.repeat(60));
            lines.push('\n⚠️  警告: 发现未在info.json中注册的脚本:\n');
            for (const script of unregisteredScripts) {
                lines.push(`    - ${script}`);
            }
            lines.push('\n请在info.json的features数组中添加这些脚本的元数据。');
        }

        lines.push('─'.repeat(60));
        lines.push('\n提示: 所有脚本都支持 -h, --help 参数查看详细用法');

        return { output: lines.join('\n') };
    } catch (error) {
        return { error: `读取插件信息失败: ${error.message}` };
    }
}