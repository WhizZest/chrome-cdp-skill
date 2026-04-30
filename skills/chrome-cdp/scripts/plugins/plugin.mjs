#!/usr/bin/env node

import { readdirSync, readFileSync, existsSync } from 'fs';
import { join, resolve, dirname, sep } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const pluginsDir = __dirname;

function printHelp() {
    console.log(`
插件管理工具

用法:
  node plugins/plugin.mjs --help          显示所有可用插件
  node plugins/plugin.mjs --list          显示所有可用插件（同--help）
  node plugins/plugin.mjs <plugin-name>   显示指定插件的详细信息

选项:
  --help          显示所有可用插件
  --list          显示所有可用插件
  <plugin-name>   显示指定插件的详细信息

说明:
  扫描 plugins/ 目录下的所有子文件夹，查找有效的info.json文件
  显示插件名称、描述和相对路径
`);
}

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

function listPlugins() {
    if (!existsSync(pluginsDir)) {
        console.log('未找到任何有效插件（plugins/ 目录不存在）');
        return;
    }

    const entries = readdirSync(pluginsDir, { withFileTypes: true });
    
    const plugins = [];
    
    for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        
        const pluginDir = join(pluginsDir, entry.name);
        const infoPath = join(pluginDir, 'info.json');
        
        if (!existsSync(infoPath)) continue;
        
        if (!isValidInfoJson(infoPath)) {
            console.error(`警告: ${entry.name}/info.json 格式无效，跳过`);
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
            console.error(`警告: 读取 ${entry.name}/info.json 失败: ${error.message}`);
        }
    }
    
    if (plugins.length === 0) {
        console.log('未找到任何有效插件');
        return;
    }
    
    console.log('\n可用插件列表:\n');
    console.log('相对路径'.padEnd(28) + '描述');
    console.log('─'.repeat(80));
    
    for (const plugin of plugins) {
        console.log(
            plugin.relativePath.padEnd(28) + 
            plugin.description
        );
    }
    
    console.log('\n总计: ' + plugins.length + ' 个插件');
}

function showPluginDetail(pluginName) {
    if (pluginName.includes('/') || pluginName.includes('\\') || pluginName === '.' || pluginName === '..') {
        console.error(`错误: 无效的插件名称 "${pluginName}"`);
        process.exit(1);
    }

    const pluginDir = resolve(pluginsDir, pluginName);
    
    if (!pluginDir.startsWith(pluginsDir + sep)) {
        console.error(`错误: 无效的插件名称 "${pluginName}"`);
        process.exit(1);
    }

    const infoPath = join(pluginDir, 'info.json');
    
    if (!existsSync(infoPath)) {
        console.error(`错误: 插件 "${pluginName}" 不存在或缺少info.json文件`);
        process.exit(1);
    }
    
    if (!isValidInfoJson(infoPath)) {
        console.error(`错误: 插件 "${pluginName}" 的info.json格式无效`);
        process.exit(1);
    }
    
    try {
        const content = readFileSync(infoPath, 'utf8');
        const info = JSON.parse(content);
        
        console.log('\n插件详细信息:\n');
        console.log('─'.repeat(60));
        console.log(`插件描述: ${info.description}`);
        
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
            console.log('\n功能列表:\n');
            for (const feature of info.features) {
                const scriptExists = actualScripts.includes(feature.script);
                const status = scriptExists ? '' : ' [文件不存在]';
                console.log(`    脚本: ${feature.script}${status}`);
                console.log(`    描述: ${feature.description}`);
                console.log(`    用法: ${feature.usage}`);
                console.log();
            }
        }
        
        if (unregisteredScripts.length > 0) {
            console.log('─'.repeat(60));
            console.log('\n⚠️  警告: 发现未在info.json中注册的脚本:\n');
            for (const script of unregisteredScripts) {
                console.log(`    - ${script}`);
            }
            console.log('\n请在info.json的features数组中添加这些脚本的元数据。');
        }
        
        console.log('─'.repeat(60));
        console.log('\n提示: 所有脚本都支持 -h, --help 参数查看详细用法');
    } catch (error) {
        console.error(`错误: 读取插件信息失败: ${error.message}`);
        process.exit(1);
    }
}

const args = process.argv.slice(2);

if (args.length === 0 || args[0] === '--help' || args[0] === '--list') {
    printHelp();
    listPlugins();
} else {
    showPluginDetail(args[0]);
}
